# Contrato lógico de integración — orbita-sso 1.x

Este contrato empaqueta el **Orbita SSO Client Contract v1.0**. Su fuente es discovery y el comportamiento del proveedor, no un estándar OAuth/OIDC supuesto. Se revisaron las implementaciones locales de Órbita, TeamUp y Talent Match al construir esta versión.

## Responsabilidades

| Parte | Responsabilidad |
|---|---|
| Órbita | Identidad canónica, registro de clientes, secretos, allowlist de callbacks, asignación y entrega de roles, firma, códigos y revocación. |
| Librería | Protocolo, validación, sincronización del catálogo, rutas, state/nonce, sesión opaca, introspección y ticket de logout. |
| Aplicación | Catálogo, significado de roles, usuario local y conflictos, pruebas de vinculación, permisos, stores compartidos, CORS y CSRF de sus propias mutaciones. |

## Configuración y defaults

`createOrbitaSso(options)` recibe:

| Opción | Valor / default |
|---|---|
| `baseUrl`, `clientId`, `clientSecret`, `redirectUri` | Obligatorios; valores del registro en Órbita. Base URL es un origen sin ruta/query. |
| `appUrl` | Obligatorio; origen público de las rutas del servidor. |
| `roles` | Obligatorio; catálogo completo de 0–100 roles únicos. |
| `stateStore`, `sessionStore` | Obligatorios; compartidos/atómicos en producción. |
| `routePrefix` | `/auth/orbita`; callback debe ser exactamente `appUrl + routePrefix + '/callback'`. |
| `successRedirect`, `errorRedirect` | `/` y `/login`; destinos configurados, nunca `returnTo` del usuario. |
| `resolveUser(identity, request)` | Opcional; devuelve un usuario público con `id` string. Default: ID, nombre y correo de Órbita. |
| `migration` | Desactivada; adaptador de migración explícita. |
| `syncRolesOnInitialize` | `true`; catálogo completo enviado una vez por instancia, antes de aceptar tráfico. |
| `roleMode` | `multiple`; `single` exige como máximo un rol. Roles vacíos solo se aceptan como evidencia de migración. |
| `introspection` | `always`; `expiry` no consulta revocaciones centrales. |
| `logout`, `postLogoutUri` | `local`; `central` requiere URI de retorno registrada. |
| `sessionSameSite` | `lax`; `none` requiere HTTPS y una política de CORS/CSRF deliberada. |
| `sessionCookieName` | `__Host-orbita_app_session` con HTTPS; `orbita_app_session` en HTTP local. |
| `allowedOrigins` | Solo origen de `appUrl`; permite declarar otros frontends para POST logout. |
| `timeoutMs`, `cacheTtlMs`, `clockToleranceSeconds` | 8000 ms, 300000 ms y 30 segundos. Límites: 100–60000, 1000–3600000 y 0–60. |
| `development` | `false`; permite HTTP únicamente en loopback y los stores de memoria. |
| `fetch` | `globalThis.fetch`; inyectable para pruebas. |
| `onError({code, status})` | Opcional; recibe información segura, sin texto bruto del proveedor. |

Cada rol tiene `{ key, displayName, description? }`: clave estable lowercase `[a-z0-9][a-z0-9._-]*` de hasta 80 caracteres, nombre de 1–120 y descripción de hasta 500. Se transforma a `{ key, display_name, description }` al sincronizar. Quitar un rol lo desactiva; no es una actualización parcial. Las asignaciones a usuarios siguen administrándose en Órbita.

## Cliente reutilizable

`new OrbitaClient(options)` no necesita rutas ni stores. Permite conservar sesiones existentes o crear adaptadores para otros frameworks:

```ts
initialize(): Promise<void>
discovery(): Promise<Discovery>
syncRoles(): Promise<void>
authorizationUrl(state: string): Promise<string>
exchangeCode(code: string): Promise<VerifiedToken>
verifyToken(token: string): Promise<Identity>
introspect(token: string): Promise<boolean>
adoptRole(migrationToken: string, role: string): Promise<void>
centralLogoutUrl(postLogoutUri: string): Promise<string>
```

En modo cliente, la aplicación implementa y consume el state, vincula al navegador, crea su sesión, protege cookies/CSRF y limita **toda** renovación local a `VerifiedToken.expiresAt`. El cliente es la salida para sistemas con sesiones que no desean sustituirlas por las del SDK.

La introspección falla mediante `OrbitaError` ante rechazo/transporte, en lugar de devolver aprobación. `false` significa sesión revocada/no activa. El canje y la adopción no se reintentan automáticamente: un resultado incierto exige volver a autenticar.

## Identidad y verificación

```ts
interface Identity {
  subject: string;       // sub UUID firmado por Órbita
  email: string;
  name: string;
  roles: string[];       // Claves reconocidas por este catálogo
  tokenId: string;       // jti
  expiresAt: number;     // Unix seconds
  migration: boolean;
  attributes: Record<string, string>; // Extensión opcional, no permisos
}
```

Se verifica RS256, selección RSA por `kid`, firma, expiración, audiencia **string exacta**, tipos de claims y catálogo. Un `kid` desconocido fuerza una actualización de JWKS; refreshes forzados se limitan a uno por segundo para evitar ráfagas. Discovery y JWKS tienen caché y solicitudes concurrentes compartidas. Se rechazan claves ambiguas y privadas.

La versión 1 actual no emite `iss`, `iat` ni `nbf`: no son claims obligatorios. El `issuer` de discovery sí debe coincidir con la base configurada. Todos los endpoints descubiertos pertenecen a ese origen; las peticiones servidor-servidor no siguen redirecciones. No se permiten algoritmos configurables desde el navegador.

El código opaco de autorización dura aproximadamente 60 segundos y puede canjearse una vez. El token suele durar 30 minutos; el SDK usa el plazo efectivo recibido y el `exp` firmado, sin asumir una duración fija.

## Rutas, sesiones y errores

`sso.handle(request)` devuelve `Response | null`; `null` permite continuar al router normal. Se exige GET para login/callback/session y POST para logout. Un método incorrecto devuelve 405 con `Allow`. Todas las respuestas del SDK usan `Cache-Control: no-store` y `Referrer-Policy: no-referrer`.

El estado y nonce usan 32 bytes aleatorios. El store conserva sus hashes y un vencimiento de 5 minutos. El consumo comprueba estado, nonce y vencimiento atómicamente. Un error del proveedor también consume el estado validado. Callbacks duplicados no canjean el mismo código desde el SDK.

El SDK genera una nueva sesión opaca en cada login y elimina la anterior del navegador que inició el callback. En el servidor guarda usuario, identidad, JWT central, token CSRF y plazo absoluto. No emite refresh tokens. La cookie HTTP-only es host-only, path `/`, Secure con HTTPS; su Max-Age queda limitado por el plazo absoluto.

`sso.getSession(request)` devuelve `{ user, identity, expiresAt, csrfToken } | null`; el store y el JWT nunca se devuelven. Por defecto consulta revocación antes de devolver una sesión. El endpoint `/session` devuelve esta proyección, o 401 si falta/expiró, o error seguro si no se puede comprobar.

Logout exige Origin declarado y coincidencia del header `x-orbita-csrf` con el valor almacenado. Revoca localmente incluso si falla el ticket central, devolviendo `{ logoutUrl: null, centralLogoutError: 'provider_unavailable' }` cuando corresponde. Debe mostrarse que la sesión central no se cerró. La petición de logout no depende de introspección para permitir cerrar localmente durante una caída.

Login/callback fallidos redirigen al destino configurado con `?error=<codigo-seguro>`. El resto devuelve `{ error: <codigo-seguro> }`. `OrbitaError` permite expresar `access_denied`, `account_conflict` o errores de aplicación controlados; excepciones no reconocidas se convierten en `internal_error`, nunca se muestran al usuario.

## Stores

```ts
interface StateStore {
  put(stateHash: string, record: StateRecord): Promise<void>;
  consume(stateHash: string, nonceHash: string, now: number): Promise<StateRecord | null>;
}
interface SessionStore<U> {
  put(sessionHash: string, session: SessionRecord<U>): Promise<void>;
  get(sessionHash: string, now: number): Promise<SessionRecord<U> | null>;
  delete(sessionHash: string): Promise<void>;
}
```

Los argumentos `now` y `expiresAt` son segundos Unix. `consume` es una operación de un uso que comprueba nonce/expiry y borra en la misma operación. El Postgres adapter lo hace con `DELETE ... RETURNING`; no implementes `SELECT` seguido de `DELETE`. Un store Redis debe usar una operación atómica/Lua con esa misma semántica.

Los stores PostgreSQL usan namespace y hashes como claves. El esquema está en `sql/postgres.sql`; no se cambia implícitamente. El payload de sesión incluye un token válido: es dato sensible del servidor. Ningún método garantiza que las cuentas locales de negocio estén activas después del login; si tu app necesita revocación local inmediata, agrega esa comprobación al guard de tu repositorio local.

## Evolución y Python

Versionar el paquete con SemVer; no reutilizar claves de rol con otro significado. Un futuro paquete Python debe conservar las responsabilidades, errores, shape de identidad, reglas de consumo y casos de conformidad. No hace falta que comparta las tablas de sesión o nombres de cookie: esos pertenecen a su adaptador. Mantener el protocolo independiente del framework facilita el port, pero la implementación Python y sus pruebas todavía requieren trabajo.
