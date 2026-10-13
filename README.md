# orbita-sso

Conecta una aplicación JavaScript con Órbita SSO instalando una dependencia en su **servidor**. Incluye sincronización automática del catálogo de roles, inicio/callback, validación RS256/JWKS, sesiones propias, protección del estado del login, introspección, logout y migración explícita de cuentas.

Compatible con **Orbita SSO Client Contract v1.0**, Node.js **22 o superior**, JavaScript ESM y TypeScript. Express 4/5 tiene adaptador; los servidores Node con `Request`/`Response` usan el mismo handler. No es un plugin del navegador ni una implementación genérica de OAuth/OIDC.

## Instalar

```bash
npm install orbita-sso
```

Para Express y el store PostgreSQL:

```bash
npm install orbita-sso express pg
```

Antes de publicar, puedes instalar el `.tgz` generado en este proyecto con `npm install /ruta/orbita-sso-1.0.0.tgz`. En CommonJS utiliza `await import('orbita-sso')`; el paquete publica ESM y tipos, no un segundo build CommonJS.

## Integración mínima en Express

En Órbita registra una app por ambiente y obtén su `client_id`, secreto y URL base. Registra exactamente el callback `https://mi-app.example/auth/orbita/callback`; configura la tarjeta para abrir `https://mi-app.example/auth/orbita/login`.

Aplica [sql/postgres.sql](sql/postgres.sql) mediante las migraciones de tu app. Luego:

```js
import express from 'express';
import pg from 'pg';
import { createOrbitaSso } from 'orbita-sso';
import { orbitaExpress, toWebRequest } from 'orbita-sso/express';
import { PostgresStateStore, PostgresSessionStore } from 'orbita-sso/postgres';

const appUrl = process.env.APP_URL;
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const namespace = process.env.ORBITA_SSO_CLIENT_ID;
const sso = createOrbitaSso({
  baseUrl: process.env.ORBITA_SSO_BASE_URL,
  clientId: namespace,
  clientSecret: process.env.ORBITA_SSO_CLIENT_SECRET,
  redirectUri: `${appUrl}/auth/orbita/callback`,
  appUrl,
  roles: [
    { key: 'admin', displayName: 'Administrador' },
    { key: 'staff', displayName: 'Staff' },
  ],
  stateStore: new PostgresStateStore(db, namespace),
  sessionStore: new PostgresSessionStore(db, namespace),
});

await sso.initialize(); // Discovery + sincronización automática de TODOS los roles.

const app = express();
app.use(orbitaExpress(sso, { appUrl })); // Montar a nivel raíz, antes del router de la app.
app.get('/privado', async (req, res, next) => {
  try {
    const session = await sso.getSession(toWebRequest(req, appUrl));
    if (!session) return res.sendStatus(401);
    if (!session.identity.roles.includes('admin')) return res.sendStatus(403);
    res.json({ mensaje: `Hola ${session.user.name}` });
  } catch (error) { next(error); }
});
app.listen(Number(process.env.PORT ?? 3000));
```

El botón de entrada es un enlace a `/auth/orbita/login`. No contiene secretos ni implementa el canje del código. Para una app nueva, la identidad de Órbita funciona como usuario; si tienes tabla de usuarios, agrega el pequeño adaptador `resolveUser` descrito en el tutorial.

## ¿Los roles llegan automáticamente a Órbita?

**Sí.** `initialize()` envía el catálogo completo al endpoint de sincronización de Órbita. No necesitas recrearlos desde el panel. La app aporta el catálogo mediante `roles` (puede venir de sus constantes o de una consulta a su base de datos); la librería no adivina los roles leyendo código o tablas.

Órbita recibe los nombres y descripciones; administra qué usuarios tienen esos roles y los devuelve en el login. La app sigue decidiendo qué acciones permite cada rol. La sincronización no asigna automáticamente privilegios a personas. Quitar una clave del catálogo completo desactiva ese rol en Órbita: coordina cambios de catálogo entre despliegues. [Detalle de roles y contrato](docs/CONTRACT.md).

## Rutas incluidas

| Método y ruta | Resultado |
|---|---|
| `GET /auth/orbita/login` | Genera estado/nonce y redirige a Órbita. |
| `GET /auth/orbita/callback` | Consume estado una vez, valida código/token y crea sesión. |
| `GET /auth/orbita/session` | Usuario, identidad, vencimiento y token CSRF; nunca el JWT de Órbita. |
| `POST /auth/orbita/logout` | Revoca la sesión local; opcionalmente devuelve URL del logout central. |

La cookie de sesión contiene un identificador opaco HTTP-only; el JWT permanece en el store del servidor. Ninguna sesión supera el vencimiento del JWT original. Por defecto se consulta introspección en cada lectura para comprobar revocaciones; `introspection: 'expiry'` permite optar explícitamente por acceso hasta la expiración sin consultas centrales.

Las demás mutaciones de tu aplicación necesitan su propia protección CSRF. El SDK protege su callback y su logout; CORS, rate limiting, limpieza del store y permisos internos pertenecen al despliegue de la app.

## Documentación y ejemplos

- [Tutorial completo: nueva app, frontend separado y producción](docs/TUTORIAL.md).
- [Contrato lógico, interfaces y defaults](docs/CONTRACT.md).
- [Migración de cuentas y adaptación de TeamUp/Match](docs/MIGRATION.md).
- [Publicar el paquete en npm y distribuir la skill](docs/PUBLISHING.md).
- [Verificación y límites de las pruebas](docs/VERIFICATION.md).
- [Servidor Express ejecutable](examples/express/server.mjs).
- [Handler Request/Response para servidores Node](examples/web/handler.mjs).
- [Skill instalable para agentes](skills/integrate-orbita-sso/SKILL.md).

Instala la skill desde GitHub con el CLI de skills.sh:

```bash
npx skills add WhiteRabbitCoder/orbita-sso --skill integrate-orbita-sso
```

## Desarrollo y publicación

```bash
npm ci
npm run check
npm run release:check
npm pack
# En tu cuenta npm, cuando estés listo:
npm login
npm publish --access public
```

El paquete pasa pruebas antes de publicar y se compila antes de empaquetar. La publicación real exige tu cuenta y la confirmación que pida npm. MIT; consulta [LICENSE](LICENSE).
