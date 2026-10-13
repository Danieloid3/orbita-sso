import express from 'express';
import pg from 'pg';
import { createOrbitaSso, MemoryStateStore, MemorySessionStore } from 'orbita-sso';
import { orbitaExpress, toWebRequest } from 'orbita-sso/express';
import { PostgresStateStore, PostgresSessionStore } from 'orbita-sso/postgres';

const development = process.env.ORBITA_SSO_DEVELOPMENT === 'true';
const appUrl = process.env.APP_URL ?? (development ? 'http://localhost:3000' : undefined);
if (!appUrl) throw new Error('APP_URL is required');
const clientId = process.env.ORBITA_SSO_CLIENT_ID;
if (!clientId) throw new Error('ORBITA_SSO_CLIENT_ID is required');
const db = development ? null : new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sso = createOrbitaSso({
  appUrl, development,
  baseUrl: process.env.ORBITA_SSO_BASE_URL,
  clientId, clientSecret: process.env.ORBITA_SSO_CLIENT_SECRET,
  redirectUri: `${appUrl}/auth/orbita/callback`,
  roles: [
    { key: 'admin', displayName: 'Administrador', description: 'Administración de esta app' },
    { key: 'staff', displayName: 'Staff', description: 'Operación diaria' },
  ],
  stateStore: db ? new PostgresStateStore(db, clientId) : new MemoryStateStore(),
  sessionStore: db ? new PostgresSessionStore(db, clientId) : new MemorySessionStore(),
  successRedirect: '/', errorRedirect: '/login',
  onError: ({ code, status }) => console.error('orbita_sso_error', { code, status }),
});

await sso.initialize();
const app = express();
app.use(orbitaExpress(sso, { appUrl }));
app.get('/login', (_req, res) => res.send('<a href="/auth/orbita/login">Continuar con Órbita</a>'));
app.get('/', async (req, res, next) => {
  try {
    const session = await sso.getSession(toWebRequest(req, appUrl));
    if (!session) return res.redirect('/login');
    return res.json({ user: session.user, roles: session.identity.roles });
  } catch (error) { return next(error); }
});
app.get('/admin', async (req, res, next) => {
  try {
    const session = await sso.getSession(toWebRequest(req, appUrl));
    if (!session) return res.sendStatus(401);
    if (!session.identity.roles.includes('admin')) return res.sendStatus(403);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});
app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  res.status(status).json({ error: status === 503 ? 'provider_unavailable' : 'authentication_failed' });
});
const server = app.listen(Number(process.env.PORT ?? 3000), () => console.info('App listening'));
const stop = () => server.close(async () => { await db?.end(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
