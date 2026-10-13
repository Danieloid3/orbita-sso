# Migrar cuentas existentes

## Qué migra la librería

La migración enlaza una identidad canónica de Órbita con **una cuenta local existente** y permite adoptar su rol legado mediante la extensión JIT del proveedor. Conserva el ID local y sus relaciones de negocio. No copia contraseñas, no importa tablas a Órbita y no convierte un correo coincidente en prueba suficiente.

Las apps nuevas pueden usar directamente el ID de Órbita. Las apps con cuentas existentes implementan `resolveUser` para vínculos ya aprobados y, opcionalmente, `migration` para adopción JIT.

## Dos estrategias compatibles

**Vinculación previa por administrador:** prepara una tabla/mapeo revisado de `local_user_id → orbita_subject`, identifica duplicados y conflictos, aplica vínculos únicos y asigna los roles de las personas en Órbita. Después `resolveUser` encuentra usuarios por `subject`; no necesitas activar JIT. Para empresas con cuentas existentes y roles ya asignados, esta es la opción más directa.

**JIT durante el login:** habilita temporalmente en Órbita la política de migración de esta app y su opción de adopción JIT. Solo el proveedor puede autorizar estas opciones. Un usuario elegible, sin rol explícito para la app, obtiene `migration: true, roles: []`. El SDK identifica la cuenta candidata, exige prueba de autorización y adopta su rol. Esta opción solo adopta un rol legado.

Usuarios sin cuenta local o sin prueba de propiedad no reciben sesión mediante el flujo de migración. No se crean automáticamente con un rol por defecto. El administrador puede provisionarlos por el flujo normal.

## Secuencia JIT

1. Validar código/token y consumir el estado del navegador.
2. `findAccount(identity, request)` localiza un único candidato activo y su rol traducido a una clave del catálogo.
3. `authorizeLink(account, identity, request)` confirma prueba de cuenta local o mapeo aprobado por un administrador.
4. El SDK solicita `adopt-role` con token de migración y secreto del servidor. No vincula todavía la cuenta ni crea sesión.
5. Al tener éxito, genera un nuevo login y guarda en su state la cuenta aprobada, el sujeto y el rol esperado.
6. En el segundo callback exige el mismo sujeto, exactamente el rol adoptado y un token normal. Entonces ejecuta `linkAccount` y crea la sesión local.

La segunda fase no repite la adopción si sigue recibiendo un token de migración; falla y evita loops. Si cambió el sujeto/rol, no vincula. Si se pierde el callback después de adoptar el rol, el administrador puede completar el vínculo previamente aprobado por la estrategia de vinculación previa; no se reintenta una adopción con un token ordinario.

## Adaptador

```js
import { OrbitaError } from 'orbita-sso';

const migration = {
  async findAccount(identity, request) {
    // users y approvals son repositorios DE TU APP, no funciones mágicas del SDK.
    const candidates = await users.findByNormalizedEmail(identity.email);
    if (candidates.length > 1) throw new OrbitaError('account_conflict', 409);
    const local = candidates[0];
    if (!local?.active || local.orbitaId) return null;
    const role = LOCAL_TO_ORBITA_ROLE[local.role];
    return role ? { accountId: String(local.id), role } : null;
  },
  async authorizeLink(account, identity, request) {
    // Un ejemplo concreto: aprobación persistente creada por un administrador,
    // ligada a ambos IDs y vigente durante la migración. No basta correo igual.
    return approvals.isApproved({
      localId: account.accountId, orbitaId: identity.subject,
    });
  },
  async linkAccount(accountId, identity) {
    // Dentro de UNA transacción: revalidar cuenta activa + aprobación vigente,
    // rechazar otro sujeto ya vinculado, actualizar el vínculo idempotentemente
    // y sincronizar perfil/rol. Constraints únicos evitan carreras.
    const local = await users.linkApprovedAccountAtomically(accountId, identity);
    return { id: String(local.id), name: identity.name, email: identity.email };
  },
};
// createOrbitaSso({ ...config, migration, resolveUser });
```

Una alternativa para `authorizeLink` es exigir una sesión local autenticada, ligada a esa misma cuenta, con una prueba de reautenticación aún válida. Verifica esa prueba en servidor y diseña su transporte/expiry como parte de la app. No aceptes un `accountId` o `approved=true` enviados por el navegador como aprobación.

Para permitir reentrada después de una adopción interrumpida, `resolveUser` puede consultar el mismo mapeo aprobado y completar el vínculo de forma transaccional. Debe verificar que coincidan sujeto, cuenta y rol aprobado. Esta recuperación es específica de tu sistema; el SDK no guarda un vínculo de negocio a medias ni asume que el correo es suficiente.

## Datos y conflictos

Agrega un identificador de Órbita único y nullable a tu tabla local. No cambies los IDs locales ni FK de datos históricos. Si usas email como clave, normaliza consistentemente y detecta duplicados antes de habilitar el flujo.

Un sujeto ya vinculado a otra cuenta, un correo perteneciente a otra persona, un rol desconocido, una cuenta desactivada o una aprobación revocada se rechazan; nunca escales a `admin` como fallback. Revalida todo dentro de `linkAccount` porque el estado puede cambiar entre callbacks. No sobreescribas el rol explícito de Órbita con un rol legado distinto.

Después de completar la adopción de la población objetivo, desactiva JIT/migration en Órbita y elimina el adaptador opcional si ya no se necesita. Conserva historial de aprobaciones y vínculos. Antes de operar sobre datos reales, exporta y revisa un dry-run de candidatos con el repositorio local de la app.

## Adaptar TeamUp

TeamUp ya concentra el protocolo en Node/Express, guarda state y nonce en PostgreSQL y tiene catálogo de seis roles. Puede sustituir discovery, JWT/JWKS, catálogo, adopción y logout-ticket por `OrbitaClient`, conservando sus tokens/cookies actuales. Esta adopción del **cliente** reduce riesgo de cambiar su autenticación local.

Si adopta el handler completo, sus guards y refresh deben pasar a la sesión opaca del SDK, o coexistir con un adapter claramente definido. No basta reemplazar el callback: los endpoints actuales esperan sus JWT/refresh tokens locales.

Traducción de roles actual:

| Órbita | TeamUp |
|---|---|
| `admin` | `ADMIN` |
| `staff` | `STAFF` |
| `coder` | `CODER` |
| `tl_development` | `TL_DEVELOPMENT` |
| `tl_soft_skills` | `TL_SOFT_SKILLS` |
| `tl_english` | `TL_ENGLISH` |

Usa `roleMode: 'single'`. El código local revisado de TeamUp intenta adoptar un rol también cuando el JWT contiene un rol distinto al legado; el proveedor revisado exige un token de migración vacío. Esa rama debe pasar a conflicto/vinculación aprobada, no a `adopt-role`. La librería impide esa adopción incorrecta.

## Adaptar Talent Match

Match tiene inicio/callback en su servidor TanStack JavaScript; su API Python canjea/verifica el código y emite sesión local. La política actual rechaza la vinculación automática por correo y resuelve roles con prioridad `admin > ta_leader > recruiter`.

La primera versión del paquete **no reemplaza el backend Python**. Para conservar la arquitectura, el futuro paquete Python sustituirá su adaptador confidencial y JavaScript seguirá consumiendo las rutas internas del API. Otra arquitectura posible es mover el canje a Node y crear un endpoint Python autenticado entre servicios que reciba identidad verificable y emita sesión local; eso exige diseñar y probar un contrato nuevo. No envíes al API una identidad JSON sin autenticación como si ya fuera confiable.

El handler Request/Response demuestra cómo montar las rutas en un servidor Node/TanStack para apps nuevas. No afirma que montar ese handler sustituya las cookies `rm_access`/`rm_refresh` actuales de Match. Las migraciones de TeamUp/Match en producción son trabajo separado de publicar esta librería.
