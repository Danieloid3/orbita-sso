// Node server only. For TanStack/other Node SSR servers, invoke handle before the existing router.
import pg from 'pg';
import { createOrbitaSso } from 'orbita-sso';
import { PostgresStateStore, PostgresSessionStore } from 'orbita-sso/postgres';

const clientId = process.env.ORBITA_SSO_CLIENT_ID;
const appUrl = process.env.APP_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const sso = createOrbitaSso({
  baseUrl: process.env.ORBITA_SSO_BASE_URL,
  clientId, clientSecret: process.env.ORBITA_SSO_CLIENT_SECRET,
  appUrl, redirectUri: `${appUrl}/auth/orbita/callback`,
  roles: [{ key: 'member', displayName: 'Miembro' }],
  stateStore: new PostgresStateStore(pool, clientId),
  sessionStore: new PostgresSessionStore(pool, clientId),
});
await sso.initialize();

// Export or call this wrapper in your framework's Node server entry.
export function withOrbita(existingHandler) {
  return async (request, ...context) => {
    const authResponse = await sso.handle(request);
    if (authResponse) return authResponse;
    return existingHandler(request, ...context);
  };
}
