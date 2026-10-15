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

## Servidor Node con autenticación existente

Usa `OrbitaClient` si tu aplicación debe conservar sus propias cookies, JWT o refresh tokens. Sustituye discovery, verificación, sincronización de catálogo e introspección; conserva la semántica de sus guards y limita cualquier renovación al vencimiento del token de Órbita.

Si eliges el handler completo, adapta todos los consumidores de sesión al identificador opaco del SDK. Cambiar solo el callback no actualiza los endpoints, el frontend ni el mecanismo de refresh existentes.

Define una traducción explícita entre el rol legado y una clave estable del catálogo, por ejemplo `OWNER → owner` y `MEMBER → member`. El catálogo puede tener varios roles posibles; la identidad normal recibe exactamente uno. Si una cuenta antigua tenía varios roles, requiere una decisión revisada sobre su rol de destino; no elijas automáticamente el más privilegiado.

Un token ordinario con un rol distinto del legado es un conflicto o un cambio administrativo, no una autorización para adoptar otro rol. Las asignaciones en revisión deben resolverse en Órbita. Solo `migration: true` con `roles: []` permite iniciar la adopción, y una negativa del proveedor nunca activa un rol de respaldo.

## Frontend JavaScript y API en otro lenguaje

Instala el SDK en el servidor Node que sea dueño del flujo SSO, no en una SPA. Si una API en otro lenguaje es la dueña de la sesión y del canje, conserva esa frontera: este paquete no sustituye su verificación ni su contrato de sesión.

Mover el canje a Node requiere diseñar una comunicación autenticada entre servicios para que la API acepte evidencia verificable. No envíes una identidad JSON sin autenticación como si fuera confiable. El adaptador del otro lenguaje debe implementar el mismo contrato HTTP y las mismas invariantes de firma, audiencia, state, vigencia y vinculación.

El handler `Request`/`Response` puede montarse en cualquier servidor Node compatible, siempre que sus rutas y guards compartan el mismo contrato de sesión. La integración con datos de negocio, los IDs locales y los permisos internos sigue perteneciendo a cada aplicación.
