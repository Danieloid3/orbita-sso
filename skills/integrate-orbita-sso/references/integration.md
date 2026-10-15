# orbita-sso 1.x integration API

Dependency: [`orbita-sso`](https://www.npmjs.com/package/orbita-sso). Install with `npm install orbita-sso@^1` using the existing server package manager. [Source and full tutorial](https://github.com/WhiteRabbitCoder/orbita-sso).

## Registration

The administrator registers an application per environment, delivers its backend base URL, client ID and secret, and allowlists the callback exactly. Launcher URL points to the **app's** login route. Central logout also requires an allowlisted post-logout URI. The package does not create clients or modify their administrative policy. Keep provider migration/JIT adoption disabled for ordinary first-login provisioning; user app-role assignments remain in Órbita.

## Full handler: Express recipe

This recipe uses the default public identity projection and does not persist application user rows. For an app that needs local users, follow [account resolution](accounts.md); the core client gives the application control over live introspection before account writes and atomic persistence.

```js
import express from 'express';
import pg from 'pg';
import { createOrbitaSso } from 'orbita-sso';
import { orbitaExpress, toWebRequest } from 'orbita-sso/express';
import { PostgresStateStore, PostgresSessionStore } from 'orbita-sso/postgres';

const appUrl = process.env.APP_URL;
const clientId = process.env.ORBITA_SSO_CLIENT_ID;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sso = createOrbitaSso({
  baseUrl: process.env.ORBITA_SSO_BASE_URL,
  clientId, clientSecret: process.env.ORBITA_SSO_CLIENT_SECRET,
  redirectUri: `${appUrl}/auth/orbita/callback`, appUrl,
  roles: [{ key: 'member', displayName: 'Miembro' }],
  stateStore: new PostgresStateStore(pool, clientId),
  sessionStore: new PostgresSessionStore(pool, clientId),
});
await sso.initialize();
const app = express();
app.use(orbitaExpress(sso, { appUrl })); // root middleware, before existing routes
app.get('/private', async (req, res, next) => {
  try {
    const session = await sso.getSession(toWebRequest(req, appUrl));
    if (!session) return res.sendStatus(401);
    if (!session.identity.roles.includes('member')) return res.sendStatus(403);
    res.json({ user: session.user });
  } catch (error) { next(error); }
});
```

Apply `node_modules/orbita-sso/sql/postgres.sql` through migrations first. Its two SDK tables do not alter users. Protect session payloads at rest because they contain the provider JWT. Schedule cleanup of expired rows. All replicas use the same namespace/store. TypeScript uses package declarations; custom user projections have `id: string` and JSON-compatible fields.

For Node Request/Response servers:

```js
const response = await sso.handle(request);
if (response) return response;
return existingRouter(request);
```

## Defaults and options

- Required: `baseUrl`, `clientId`, `clientSecret`, `redirectUri`, `appUrl`, `roles`, `stateStore`, `sessionStore`.
- `appUrl` and `baseUrl` are origins without path/query. Callback is exactly `appUrl + routePrefix + '/callback'`.
- `routePrefix`: `/auth/orbita`. GET `/login`, `/callback`, `/session`; POST `/logout`.
- `roles`: complete list `{key, displayName, description?}`. Up to 100 unique keys; lowercase `[a-z0-9][a-z0-9._-]*`, max 80; display name max 120, description max 500. Empty catalog means deactivate all synchronized roles.
- `syncRolesOnInitialize`: true. Disable only when a deployment step explicitly calls `client.syncRoles()`. Avoid mixed catalogs in rolling deployments.
- `roleMode`: single by default, matching the current provider's one-role contract. multiple is an explicit compatibility option for older providers. A full catalog can contain many roles; a normal identity receives one. Empty roles are valid only for migration evidence, never app access.
- `resolveUser(identity, request)`: optional. Default public user `{ id: subject, email, name }`. Existing apps resolve by stable subject, check account status/conflicts and return a **public projection**, never an ORM object with password hashes.
- `successRedirect`: `/`; `errorRedirect`: `/login`. Fixed trusted configuration; no user-supplied return URL support.
- `introspection`: always; expiry skips current revocation checks and still enforces absolute expiration.
- `logout`: local; central requires `postLogoutUri` and a browser navigation to the returned ticket URL.
- `sessionSameSite`: lax. Cross-site uses none + HTTPS + explicit app CORS with credentials.
- `allowedOrigins`: additional frontend origins for POST logout. Default only `appUrl` origin. SDK does not configure CORS/preflight.
- `development`: false; true permits memory stores and loopback HTTP, not arbitrary insecure remote hosts.
- `onError`: receives `{code, status}` only. Unknown exceptions become `internal_error`.

Frontend uses a [branded login action with the official logo](login-button.md), reads `/session` with `credentials: 'include'`, and posts `/logout` with `x-orbita-csrf` from the session response. The browser supplies Origin. Session cookies are opaque, HTTP-only, Secure over HTTPS, host-only and path `/`. The JWT never leaves the server store. Other application mutations need their own CSRF protection.

`getSession` returns `{user, identity, expiresAt, csrfToken}` or null. Outages may throw; do not catch an outage and allow access. Logout can close locally during provider outages; it reports `centralLogoutError` if it could not obtain a central ticket.

## Next.js App Router integration

Run the SDK on the Node runtime (`export const runtime = 'nodejs'`), using server-only configuration and shared stores. A route handler can return `await sso.handle(request)` as a standard Response; unknown routes return null and must pass through or return 404. Exclude `/auth/orbita/*` from locale/proxy rewrites. Use a full browser navigation for login; avoid framework prefetches that start an authorization flow in the background.

Preserve every SDK Set-Cookie header, including nonce and session deletion. If a legacy cookie must also expire on SDK logout, append its deletion directly to the SDK response. Avoid mixing that response with Next mutable `cookies()` writes that can replace headers. Exercise this with a real browser, checking cookie removal as well as a 401 from the session API.

Persist an allowlisted presentation locale across the provider redirect if needed; it is not an identity, role or arbitrary return URL. Adapt the application's existing guards to `getSession`, and keep application-specific record resolution and numeric IDs inside the server. Do not resolve provider roles from privileged downstream credentials.

## Core client when preserving existing authentication

`new OrbitaClient({baseUrl, clientId, clientSecret, redirectUri, roles, ...})` exports:

- `initialize()`: discovery and default automatic role sync.
- `authorizationUrl(state)`: validates state and builds URL.
- `exchangeCode(code)`: server-only `{identity, accessToken, expiresAt}`.
- `verifyToken(token)`: signature/audience/claims/roles validation.
- `syncRoles()`, `introspect(token)`, `adoptRole(migrationToken, role)`, `centralLogoutUrl(postLogoutUri)`.

The app then owns state/nonce, local cookies, CSRF and session lifetime. Do not exchange an arbitrary callback without browser-state validation. Preserve existing refresh/session behavior but bound the lifetime to `expiresAt`.

For the approved first-login policy, validate the normal role-bearing token and asserted email, perform live introspection, then resolve/link/create the local user and persist session evidence atomically as described in [account resolution](accounts.md). Apply an email-domain restriction only if this application's requirements explicitly specify one; it is not the default. Role reconciliation follows the provider's normal assignment; it is distinct from legacy role adoption.

Identity: `{subject, email, name, roles, tokenId, expiresAt, migration, attributes}`. Times are Unix seconds. Attributes are allowlisted provider extensions and never authorization roles.

## Custom stores

State: `put(hash, {nonceHash, expiresAt, migration?})`, `consume(hash, nonceHash, now)` returning record/null. Consumption must atomically check nonce/expiry and delete once. PostgreSQL uses `DELETE ... RETURNING`; Redis needs a transaction/Lua equivalent, not separate get/delete.

Session: `put(hash, record)`, `get(hash, now)` returning nonexpired record/null, `delete(hash)`. Record: `{user, identity, providerToken, expiresAt, csrfToken}`; server-only. Keys are SHA-256 digests supplied by the SDK. Do not return internal records to the browser.

## Troubleshooting

`configuration_error`: URLs/contract/catalog/store. `invalid_state`: expired/missing/duplicate browser state. `provider_rejected`: secret/code/registration/callback. `invalid_token`: signature/kid/audience/claims. `account_conflict`: ambiguous identity. `provider_unavailable`: timeout/network/429/5xx. `csrf_failed`: Origin/header mismatch. Callback failures redirect with these safe codes; raw provider messages are not returned.
