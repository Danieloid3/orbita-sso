import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrbitaError, createOrbitaSso } from '../dist/index.js';
import { SUBJECT, OTHER_SUBJECT, fixture, request, cookieHeader, callbackRequest, login } from './fixture.mjs';

test('complete browser flow creates opaque cookies and public session without provider tokens', async () => {
  const api = await fixture(); const flow = await login(api);
  assert.equal(flow.end.status, 302); assert.equal(flow.end.headers.get('location'), 'http://localhost:3100/');
  assert.equal(flow.end.headers.get('cache-control'), 'no-store');
  assert.equal(flow.end.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(flow.end.headers.getSetCookie().every((value) => value.includes('HttpOnly')));
  const response = await api.sso.handle(request('/auth/orbita/session', { cookie: flow.cookie }));
  const session = await response.json();
  assert.equal(session.user.id, SUBJECT); assert.deepEqual(session.identity.roles, ['staff']);
  assert.equal(typeof session.csrfToken, 'string'); assert.ok(session.expiresAt <= session.identity.expiresAt);
  assert.equal(JSON.stringify(session).includes('providerToken'), false);
  assert.equal(JSON.stringify(session).includes('access_token'), false);
  assert.equal(flow.cookie.includes('eyJ'), false);
});

test('state replay and concurrent duplicate callbacks can create only one session', async () => {
  const api = await fixture();
  const start = await api.sso.handle(request('/auth/orbita/login'));
  const callback = callbackRequest(start);
  const results = await Promise.all([api.sso.handle(callback), api.sso.handle(callback)]);
  assert.equal(results.filter((result) => result.headers.get('location') === 'http://localhost:3100/').length, 1);
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('/token')).length, 1);
});

test('missing/wrong browser nonce, mismatched state and unsolicited callbacks never exchange codes', async () => {
  const api = await fixture();
  const start = await api.sso.handle(request('/auth/orbita/login'));
  for (const req of [
    callbackRequest(start, 'c'.repeat(64), { cookie: '' }),
    callbackRequest(start, 'c'.repeat(64), { cookie: 'orbita_app_session_nonce=' + 'n'.repeat(43) }),
    callbackRequest(start, 'c'.repeat(64), { state: 'z'.repeat(43) }),
    request('/auth/orbita/callback?code=' + 'c'.repeat(64)),
  ]) {
    const response = await api.sso.handle(req);
    assert.match(response.headers.get('location'), /error=invalid_state/);
  }
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('/token')).length, 0);
});

test('expired state cannot be redeemed and provider error consumes state', async () => {
  const api = await fixture();
  const originalPut = api.options.stateStore.put.bind(api.options.stateStore);
  api.options.stateStore.put = (key, record) => originalPut(key, { ...record, expiresAt: 1 });
  const start = await api.sso.handle(request('/auth/orbita/login'));
  assert.match((await api.sso.handle(callbackRequest(start))).headers.get('location'), /invalid_state/);
  const second = await fixture(); const flow = await second.sso.handle(request('/auth/orbita/login'));
  const callback = callbackRequest(flow); const url = new URL(callback.url); url.searchParams.set('error', 'access_denied');
  assert.match((await second.sso.handle(new Request(url, callback))).headers.get('location'), /access_denied/);
  assert.match((await second.sso.handle(callback)).headers.get('location'), /invalid_state/);
});

test('refreshing local session rotates it and expires the earlier cookie', async () => {
  const api = await fixture(); const first = await login(api);
  const start = await api.sso.handle(request('/auth/orbita/login'));
  const callback = callbackRequest(start, 'd'.repeat(64));
  callback.headers.set('cookie', callback.headers.get('cookie') + '; ' + first.cookie);
  const end = await api.sso.handle(callback);
  assert.equal(end.headers.get('location'), 'http://localhost:3100/');
  assert.equal(await api.sso.getSession(request('/private', { cookie: first.cookie })), null);
  assert.ok(await api.sso.getSession(request('/private', { cookie: cookieHeader(end) })));
});

test('introspection revocation removes sessions; provider outage fails closed', async () => {
  const api = await fixture(); const flow = await login(api);
  api.fail = '/api/auth/introspect';
  const failed = await api.sso.handle(request('/auth/orbita/session', { cookie: flow.cookie }));
  assert.equal(failed.status, 503);
  api.fail = null; api.active = false;
  assert.equal((await api.sso.handle(request('/auth/orbita/session', { cookie: flow.cookie }))).status, 401);
  api.active = true;
  assert.equal(await api.sso.getSession(request('/private', { cookie: flow.cookie })), null);
});

test('expiry policy is explicit and avoids introspection while still honoring absolute expiry', async () => {
  const api = await fixture({ introspection: 'expiry' }); const flow = await login(api);
  assert.ok(await api.sso.getSession(request('/private', { cookie: flow.cookie })));
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('/introspect')).length, 0);
  const get = api.options.sessionStore.get.bind(api.options.sessionStore);
  api.options.sessionStore.get = async (...args) => ({ ...await get(...args), expiresAt: 1 });
  assert.equal(await api.sso.getSession(request('/private', { cookie: flow.cookie })), null);
});

test('logout needs POST, trusted Origin and CSRF; local logout works during provider outage', async () => {
  const api = await fixture(); const flow = await login(api);
  const session = await api.sso.getSession(request('/private', { cookie: flow.cookie }));
  assert.equal((await api.sso.handle(request('/auth/orbita/logout', { cookie: flow.cookie }))).status, 405);
  for (const headers of [{}, { origin: 'http://attacker.example', 'x-orbita-csrf': session.csrfToken }, { origin: 'http://localhost:3100', 'x-orbita-csrf': 'wrong' }]) {
    assert.equal((await api.sso.handle(request('/auth/orbita/logout', { cookie: flow.cookie, ...headers }, 'POST'))).status, 403);
  }
  api.fail = '/api/auth/introspect';
  const end = await api.sso.handle(request('/auth/orbita/logout', { cookie: flow.cookie, origin: 'http://localhost:3100', 'x-orbita-csrf': session.csrfToken }, 'POST'));
  assert.equal(end.status, 200); assert.deepEqual(await end.json(), { logoutUrl: null, centralLogoutError: null });
  assert.equal(await api.sso.getSession(request('/private', { cookie: flow.cookie })), null);
});

test('central logout failure reports it while still deleting the local session', async () => {
  const api = await fixture({ logout: 'central', postLogoutUri: 'http://localhost:3100/login' });
  const flow = await login(api); const session = await api.sso.getSession(request('/private', { cookie: flow.cookie }));
  api.fail = '/api/auth/logout-ticket';
  const end = await api.sso.handle(request('/auth/orbita/logout', { cookie: flow.cookie, origin: 'http://localhost:3100', 'x-orbita-csrf': session.csrfToken }, 'POST'));
  assert.equal(end.status, 200); assert.equal((await end.json()).centralLogoutError, 'provider_unavailable');
  assert.equal(await api.sso.getSession(request('/private', { cookie: flow.cookie })), null);
});

test('application identity conflicts deny access with safe codes; reporting failure is isolated', async () => {
  const errors = [];
  const api = await fixture({ resolveUser: async () => { throw new OrbitaError('account_conflict', 409); }, onError: (error) => { errors.push(error); throw new Error('logger failed'); } });
  const flow = await login(api);
  assert.match(flow.end.headers.get('location'), /account_conflict/);
  assert.deepEqual(errors, [{ code: 'account_conflict', status: 409 }]);
  assert.equal(await api.sso.getSession(request('/private', { cookie: flow.cookie })), null);
});

test('account migration adopts a role, reauthorizes, then links once and creates a session', async () => {
  const linked = [];
  const api = await fixture({ migration: {
    findAccount: async () => ({ accountId: 'legacy-42', role: 'staff' }),
    authorizeLink: async () => true,
    linkAccount: async (id, identity) => { linked.push({ id, identity }); return { id, name: identity.name }; },
  } });
  api.migration = true; api.roles = [];
  const flow = await login(api);
  assert.equal(new URL(flow.end.headers.get('location')).pathname, '/api/auth/authorize');
  assert.equal(linked.length, 0);
  const final = await api.sso.handle(callbackRequest(flow.end, 'd'.repeat(64)));
  assert.equal(final.headers.get('location'), 'http://localhost:3100/');
  assert.equal(linked.length, 1); assert.equal(linked[0].identity.subject, SUBJECT);
  const session = await api.sso.getSession(request('/private', { cookie: cookieHeader(final) }));
  assert.equal(session.user.id, 'legacy-42'); assert.deepEqual(session.identity.roles, ['staff']);
});

for (const variant of ['no adapter', 'no account', 'no proof', 'unknown role']) {
  test(`migration rejects ${variant} without granting access or adopting roles`, async () => {
    const adapter = { findAccount: async () => variant === 'no account' ? null : ({ accountId: '42', role: variant === 'unknown role' ? 'superuser' : 'staff' }), authorizeLink: async () => variant !== 'no proof', linkAccount: async () => ({ id: '42' }) };
    const api = await fixture(variant === 'no adapter' ? {} : { migration: adapter });
    api.roles = []; api.migration = true;
    assert.match((await login(api)).end.headers.get('location'), /migration_denied/);
    assert.equal(api.calls.filter((entry) => entry.path.endsWith('/adopt-role')).length, 0);
  });
}

for (const variant of ['changed subject', 'changed role', 'migration loop']) {
  test(`migration final authorization rejects ${variant} before local linking`, async () => {
    let links = 0;
    const api = await fixture({ migration: { findAccount: async () => ({ accountId: '42', role: 'staff' }), authorizeLink: async () => true, linkAccount: async () => { links++; return { id: '42' }; } } });
    api.roles = []; api.migration = true; const flow = await login(api);
    if (variant === 'changed subject') api.claims = { sub: OTHER_SUBJECT };
    if (variant === 'changed role') api.roles = ['admin'];
    if (variant === 'migration loop') { api.roles = []; api.migration = true; }
    const end = await api.sso.handle(callbackRequest(flow.end, 'd'.repeat(64)));
    assert.match(end.headers.get('location'), /migration_denied/); assert.equal(links, 0);
    assert.equal(api.calls.filter((entry) => entry.path.endsWith('/adopt-role')).length, 1);
  });
}

test('other app routes pass through and login cannot use an untrusted return URL', async () => {
  const api = await fixture();
  assert.equal(await api.sso.handle(request('/app')), null);
  const start = await api.sso.handle(request('/auth/orbita/login?returnTo=https://attacker.example'));
  const end = await api.sso.handle(callbackRequest(start));
  assert.equal(end.headers.get('location'), 'http://localhost:3100/');
});
