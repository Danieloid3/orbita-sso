import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createOrbitaSso, MemorySessionStore, MemoryStateStore } from '../dist/index.js';

export const SUBJECT = '00000000-0000-4000-8000-000000000001';
export const OTHER_SUBJECT = '00000000-0000-4000-8000-000000000002';
const pair = await generateKeyPair('RS256');
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'key-1', alg: 'RS256', use: 'sig' };

export async function fixture(overrides = {}) {
  const api = {
    roles: ['staff'], migration: false, active: true,
    calls: [], usedCodes: new Set(), jwks: [publicKey], fail: null, claims: {},
    metadata: {
      contract_version: '1.0', issuer: 'http://localhost:9000',
      authorization_endpoint: 'http://localhost:9000/api/auth/authorize',
      token_endpoint: 'http://localhost:9000/api/auth/token',
      jwks_uri: 'http://localhost:9000/api/.well-known/jwks.json',
      introspection_endpoint: 'http://localhost:9000/api/auth/introspect',
      role_adoption_endpoint: 'http://localhost:9000/api/auth/adopt-role',
      logout_ticket_endpoint: 'http://localhost:9000/api/auth/logout-ticket',
      role_catalog_sync_endpoint: 'http://localhost:9000/api/apps/{client_id}/role-catalog',
      token_signing_alg_values_supported: ['RS256'],
    },
  };
  api.sign = async (claims = {}, header = {}) => new SignJWT({
    sub: SUBJECT, email: 'demo@example.com', name: 'Demo Person', aud: 'demo-app',
    roles: api.roles, jti: 'test-token-id', exp: Math.floor(Date.now() / 1000) + 1800,
    ...(api.migration ? { migration: true } : {}), ...api.claims, ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'key-1', ...header }).sign(pair.privateKey);
  api.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : undefined;
    api.calls.push({ path, options, body });
    if (api.fail === path) throw new Error('provider network failure with unsafe data');
    if (path.endsWith('orbita-configuration')) return Response.json(api.metadata);
    if (path.endsWith('jwks.json')) return Response.json({ keys: api.jwks });
    if (path.endsWith('/role-catalog')) return Response.json({ roles: body.roles });
    if (path.endsWith('/token')) {
      if (api.usedCodes.has(body.code)) return Response.json({ detail: 'Code reused' }, { status: 400 });
      api.usedCodes.add(body.code);
      return Response.json({ access_token: await api.sign(), token_type: 'Bearer', expires_in: 1800 });
    }
    if (path.endsWith('/introspect')) return Response.json({ active: api.active });
    if (path.endsWith('/adopt-role')) {
      api.roles = [body.role]; api.migration = false;
      return Response.json({ role: body.role, reauthorize: true });
    }
    if (path.endsWith('/logout-ticket')) return Response.json({ logout_url: 'http://localhost:9000/api/auth/end-session?ticket=opaque-ticket', expires_in: 60 });
    throw new Error(`Unexpected path ${path}`);
  };
  const options = {
    baseUrl: 'http://localhost:9000', clientId: 'demo-app', clientSecret: 'test-only-secret',
    appUrl: 'http://localhost:3100', redirectUri: 'http://localhost:3100/auth/orbita/callback',
    roles: [{ key: 'staff', displayName: 'Staff' }, { key: 'admin', displayName: 'Admin' }],
    development: true, fetch: api.fetch, stateStore: new MemoryStateStore(), sessionStore: new MemorySessionStore(),
    ...overrides,
  };
  const sso = createOrbitaSso(options);
  api.options = options; api.sso = sso;
  return api;
}

export const request = (path, headers = {}, method = 'GET') => new Request(`http://localhost:3100${path}`, { method, headers });
export const cookieHeader = (response) => response.headers.getSetCookie().filter((value) => !value.includes('Max-Age=0')).map((value) => value.split(';')[0]).join('; ');
export function callbackRequest(start, code = 'c'.repeat(64), override = {}) {
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return request(`/auth/orbita/callback?code=${code}&state=${override.state ?? state}`, { cookie: override.cookie ?? cookieHeader(start) });
}
export async function login(api, code = 'c'.repeat(64)) {
  const start = await api.sso.handle(request('/auth/orbita/login'));
  const end = await api.sso.handle(callbackRequest(start, code));
  return { start, end, cookie: cookieHeader(end) };
}
