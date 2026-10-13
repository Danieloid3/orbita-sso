# Tutorial: integrar una app con Órbita

## 1. Qué vas a necesitar

- Un backend Node.js 22+, ESM, o un servidor Node que maneje `Request`/`Response`.
- Una app registrada en Órbita. El administrador entrega URL base del backend, client ID y secreto.
- URL pública estable para las rutas de autenticación y una base compartida para estado/sesiones.
- El catálogo de roles propio de tu app. Órbita lo recibirá automáticamente del SDK.

Usa registros y secretos separados para desarrollo, staging y producción. El secreto pertenece al servidor: nunca una variable `VITE_*`, `NEXT_PUBLIC_*`, HTML o JavaScript enviado al navegador.

## 2. Registrar la app en Órbita

Solicita al administrador:

1. Crear/habilitar la aplicación y su cliente SSO.
2. Registrar el callback exacto, por ejemplo `https://app.example/auth/orbita/callback`.
3. Configurar la URL de la tarjeta como `https://app.example/auth/orbita/login`.
4. Entregar `client_id`, secreto y URL base del **backend** de Órbita.
5. Si quieres logout central, registrar `post_logout_uri`, por ejemplo `https://app.example/login`.

Tras arrancar el servidor, el catálogo aparecerá en Órbita. El administrador puede asignar roles a usuarios. Una app no puede asignarse automáticamente el rol administrador ni usar roles globales de Órbita como permisos internos.

No hay autorregistro de clientes usando el secreto: recibir el secreto presupone que el registro ya existe. Tampoco se cambian redirect URIs ni políticas administrativas desde la librería.

## 3. Configurar el servidor

```env
APP_URL=https://app.example
ORBITA_SSO_BASE_URL=https://backend-orbita.example
ORBITA_SSO_CLIENT_ID=mi-app-produccion
ORBITA_SSO_CLIENT_SECRET=valor-entregado-por-orbita
DATABASE_URL=conexion-de-tu-base
```

`APP_URL` es el origen público que sirve las rutas SSO. Si las rutas viven en `https://api.app.example`, ese es `APP_URL`; el destino tras login puede ser otro frontend HTTPS fijo usando `successRedirect`.

Instala `orbita-sso`, y `express`/`pg` si usas esos adaptadores. Copia [el servidor de ejemplo](../examples/express/server.mjs) o el bloque del README. Para TypeScript, las interfaces se exportan desde `orbita-sso`; tipos del driver PostgreSQL pertenecen a `@types/pg`.

## 4. Preparar el store

Aplica `node_modules/orbita-sso/sql/postgres.sql` con la herramienta de migraciones de tu app. La librería no ejecuta DDL al iniciar. Las tablas guardan estados de login y sesiones; no modifican tu tabla `users`.

Todos los procesos y réplicas del mismo cliente deben compartir el store y el mismo namespace, habitualmente el client ID. Distintos ambientes deben tener registros y bases separados. El JWT central está dentro del payload de la sesión: limita acceso a estas tablas, protege backups y usa cifrado de almacenamiento. Si tu política exige cifrado de campo, implementa un `SessionStore` que cifre `providerToken`.

Programa limpieza de filas expiradas, por ejemplo cada hora con las consultas al final del SQL. Las lecturas ya rechazan registros vencidos aunque no se hayan limpiado.

En desarrollo local puedes usar `MemoryStateStore` y `MemorySessionStore` con `development: true`. Ese modo solo permite HTTP en `localhost`, `127.0.0.1` o `::1`, y no está destinado a producción. En producción la librería rechaza sus stores en memoria.

## 5. Cargar roles automáticamente

```js
const roles = [
  { key: 'admin', displayName: 'Administrador', description: 'Administración de la app' },
  { key: 'staff', displayName: 'Staff', description: 'Operación diaria' },
];
// Si tu app guarda un catálogo en DB, consulta y transforma sus filas a este formato.
```

Pasa `roles` a `createOrbitaSso` y ejecuta `await sso.initialize()` antes de escuchar tráfico. La librería envía el catálogo completo una vez por instancia. Si falla discovery o sincronización, la inicialización falla: no ignores el error.

Si un pipeline controla el catálogo durante rolling deployments, configura `syncRolesOnInitialize: false` y ejecuta `await sso.client.syncRoles()` desde la fase de despliegue. Varias versiones con catálogos diferentes pueden desactivar roles mutuamente; evita sincronizar desde ambas simultáneamente. No uses una lista vacía como forma de «omitir»: una lista vacía significa desactivar todo el catálogo sincronizado.

## 6. Conectar usuarios locales, si existen

Para una nueva app sin cuentas locales, el SDK entrega `{ id: identity.subject, email, name }`. No crea filas de negocio. Usa `subject` como referencia estable a Órbita.

Para una app con tabla de usuarios:

```js
import { OrbitaError } from 'orbita-sso';

async function resolveUser(identity) {
  // users es TU repositorio. Este bloque muestra su contrato; no lo exporta el SDK.
  const linked = await users.findByOrbitaId(identity.subject);
  if (linked) {
    if (!linked.active) throw new OrbitaError('access_denied', 403);
    await users.synchronizeProfile(linked.id, identity);
    return { id: String(linked.id), name: identity.name, email: identity.email };
  }
  if (await users.existsByNormalizedEmail(identity.email)) {
    throw new OrbitaError('account_conflict', 409);
  }
  const created = await users.createFromOrbita(identity); // Transacción + ID de Órbita único.
  return { id: String(created.id), name: identity.name, email: identity.email };
}
// createOrbitaSso({ ...config, resolveUser });
```

Comprueba también conflictos cuando el correo de una identidad ya vinculada cambia y pertenece a otra cuenta. El SDK no toma decisiones de vinculación por ti. Devuelve una proyección pública de usuario: sin password hashes, documentos privados, refresh tokens ni objetos ORM completos. `GET /session` devuelve exactamente esa proyección.

Para adoptar cuentas existentes y conservar sus IDs, consulta [MIGRATION.md](MIGRATION.md). Es un adaptador explícito, desactivado por defecto.

## 7. Conectar la interfaz

Añade un enlace a `/auth/orbita/login`; desde Órbita, la tarjeta también inicia la misma ruta. Tras el callback, se redirige a `successRedirect` (por defecto `/`).

Para leer el usuario:

```js
const response = await fetch('/auth/orbita/session', { credentials: 'include' });
if (response.status === 401) window.location.assign('/login');
if (response.status === 503) throw new Error('No se puede verificar tu sesión ahora');
const session = await response.json();
```

El backend protege rutas con `await sso.getSession(request)` y comprueba `session.identity.roles`. Ocultar un botón no reemplaza la autorización del servidor. `getSession` devuelve `null` si no hay sesión, expiró o fue revocada; puede lanzar `OrbitaError` ante una dependencia caída. Nunca conviertas ese error en autorización.

Para logout:

```js
const current = await fetch('/auth/orbita/session', { credentials: 'include' });
if (!current.ok) throw new Error('No se pudo verificar la sesión');
const { csrfToken } = await current.json();
const response = await fetch('/auth/orbita/logout', {
  method: 'POST', credentials: 'include',
  headers: { 'x-orbita-csrf': csrfToken },
});
if (!response.ok) throw new Error('No se pudo cerrar la sesión');
const { logoutUrl, centralLogoutError } = await response.json();
if (centralLogoutError) console.info('Se cerró la sesión local; no se pudo cerrar Órbita');
window.location.assign(logoutUrl ?? '/login');
```

La cookie nunca necesita leerse desde JavaScript. El token CSRF puede permanecer en memoria mientras se hace la petición. El código SSO viaja en el callback porque es parte del protocolo; no es un JWT ni un secreto. Evita registrar la query del callback en tu proxy, analytics y herramienta de errores.

## 8. Frontend y API en orígenes distintos

Para SPA en `https://web.example` y backend en `https://api.example`:

- `appUrl` apunta a `https://api.example`; callback y login viven allí.
- Configura `successRedirect: 'https://web.example/'` y `errorRedirect: 'https://web.example/login'`.
- Agrega `allowedOrigins: ['https://web.example']` para permitir el logout desde ese frontend.
- Cuando los dominios sean cross-site, usa `sessionSameSite: 'none'` con HTTPS.
- Configura CORS **en la app** con origen exacto y credentials; permite el header `x-orbita-csrf` y maneja preflight `OPTIONS` antes del middleware SSO.
- Las cookies de terceros pueden estar bloqueadas por el navegador. Un BFF/same-origin evita esa dependencia; no existe una opción del SDK que anule la política del navegador.

No compartas cookies entre aplicaciones ni pongas el secreto en el frontend. Las cookies son host-only. Si varias apps comparten un host, usa nombres de cookie diferentes.

## 9. Logout y revocaciones

Por defecto `logout: 'local'`: elimina la sesión de esta app. `logout: 'central'` más `postLogoutUri` solicita un ticket de un uso y devuelve su URL; el navegador debe navegar a esa URL para completar el logout central.

Cerrar Órbita revoca sesiones centrales observables por introspección. No borra cookies locales de otros dominios. El default `introspection: 'always'` verifica cada lectura de sesión. Si eliges `'expiry'`, debes aceptar que las revocaciones centrales se reflejen únicamente al vencer el JWT. El SDK no emite refresh tokens ni extiende el JWT: el usuario vuelve a pasar por Órbita cuando vence la sesión.

## 10. Verificar antes de desplegar

Prueba con Órbita del ambiente objetivo: login desde tarjeta y botón, usuario con rol, usuario sin acceso, usuario inactivo, aplicación deshabilitada, rol revocado, logout local/central y una migración aprobada. Revisa cookies Secure/HttpOnly, callback exacto y ausencia de secretos/tokens en logs. Los tests del paquete usan un proveedor controlado; no prueban tus credenciales ni políticas reales de Órbita.

Para rotar secreto, actualiza el servidor dentro de la ventana vigente del proveedor. El contrato local de Órbita permite 15 minutos de coexistencia después de rotar. Confirma esa política en tu despliegue antes de una operación real.

## Resolver problemas

| Error | Revisar |
|---|---|
| `configuration_error` | HTTPS, URLs exactas, Node, stores compartidos, discovery v1, catálogo válido. |
| `invalid_state` | Login iniciado en otro host, cookies bloqueadas, segundo callback, cookie duplicada, más de 5 minutos. |
| `provider_rejected` | Secreto, registro, callback o código expirado/reutilizado. Reiniciar login; no reintentar el código. |
| `invalid_token` | Firma, audiencia, `kid`, expiración, tipos de claims; comprobar reloj y JWKS. |
| `access_denied` | Roles reconocidos, política single/multiple, cuenta local activa. |
| `account_conflict` | Vinculación aprobada pendiente o colisión de correo/identidad. |
| `migration_denied` | Token de migración, permisos JIT en Órbita, prueba de propiedad y rol válido. |
| `provider_unavailable` | Conectividad, timeout, `429` o `5xx`; mostrar error recuperable. |
| `csrf_failed` | POST, Origin autorizado y `x-orbita-csrf` de la sesión actual. |

Un usuario sin acceso puede terminar en la pantalla de acceso denegado de Órbita antes de llegar al callback de tu app; es el comportamiento actual del proveedor.
