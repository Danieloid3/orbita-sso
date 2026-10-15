import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrbitaClient, OrbitaError, createOrbitaSso } from '../dist/index.js';
import { fixture } from './fixture.mjs';

test('initialization automatically sends the full catalog once, including display metadata', async () => {
  const api = await fixture();
  await Promise.all([api.sso.initialize(), api.sso.initialize(), api.sso.initialize()]);
  const sync = api.calls.filter((entry) => entry.path.endsWith('/role-catalog'));
  assert.equal(sync.length, 1);
  assert.deepEqual(sync[0].body.roles, [
    { key: 'staff', display_name: 'Staff', description: '' },
    { key: 'admin', display_name: 'Admin', description: '' },
  ]);
  assert.equal(sync[0].options.method, 'PUT');
  assert.equal(sync[0].body.client_secret, 'test-only-secret');
});

test('catalog sync can be owned by the deployment pipeline instead', async () => {
  const api = await fixture({ syncRolesOnInitialize: false });
  await api.sso.initialize();
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('/role-catalog')).length, 0);
  await api.sso.client.syncRoles();
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('/role-catalog')).length, 1);
});

test('failed startup sync is not accepted and can be retried after provider recovery', async () => {
  const api = await fixture();
  api.fail = '/api/apps/demo-app/role-catalog';
  await assert.rejects(api.sso.initialize(), { code: 'provider_unavailable' });
  api.fail = null;
  await api.sso.initialize();
});

for (const [label, changes] of [
  ['foreign endpoint', { token_endpoint: 'https://attacker.example/token' }],
  ['wrong issuer', { issuer: 'https://other.example' }],
  ['unknown contract', { contract_version: '2.0' }],
  ['algorithm downgrade', { token_signing_alg_values_supported: ['HS256'] }],
]) {
  test(`discovery rejects ${label} before forwarding any secret`, async () => {
    const api = await fixture(); Object.assign(api.metadata, changes);
    await assert.rejects(api.sso.initialize(), { code: 'configuration_error' });
    assert.equal(api.calls.length, 1);
  });
}

test('production config rejects HTTP, memory stores, duplicate roles and incorrect callbacks', async () => {
  const api = await fixture();
  for (const changes of [
    { development: false },
    { roles: [api.options.roles[0], api.options.roles[0]] },
    { roles: [{ key: 'ADMIN', displayName: 'Admin' }] },
    { redirectUri: 'http://localhost:3100/other' },
    { sessionSameSite: 'none' },
    { timeoutMs: 0 },
    { logout: 'central' },
  ]) assert.throws(() => createOrbitaSso({ ...api.options, ...changes }), { code: 'configuration_error' });
  assert.throws(() => createOrbitaSso({ ...api.options, development: false, baseUrl: 'https://identity.example', appUrl: 'https://app.example', redirectUri: 'https://app.example/auth/orbita/callback' }), { code: 'configuration_error' });
});

test('valid RS256 identity is verified without inventing v1 iss/iat claims', async () => {
  const api = await fixture();
  const identity = await api.sso.client.verifyToken(await api.sign({ attributes: { clan: 'demo' } }));
  assert.deepEqual(identity.roles, ['staff']);
  assert.equal(identity.attributes.clan, 'demo');
});

for (const [label, claims, code] of [
  ['wrong audience', { aud: 'other-app' }, 'invalid_token'],
  ['audience array', { aud: ['demo-app', 'other-app'] }, 'invalid_token'],
  ['expired token', { exp: 1 }, 'invalid_token'],
  ['missing exp', { exp: undefined }, 'invalid_token'],
  ['unknown subject', { sub: 'not-a-uuid' }, 'invalid_token'],
  ['missing jti', { jti: undefined }, 'invalid_token'],
  ['role privilege fallback', { roles: ['unknown'] }, 'access_denied'],
  ['empty nonmigration roles', { roles: [] }, 'access_denied'],
  ['string roles', { roles: 'admin' }, 'invalid_token'],
  ['duplicate roles', { roles: ['staff', 'staff'] }, 'invalid_token'],
  ['migration with privileges', { roles: ['admin'], migration: true }, 'access_denied'],
  ['nonboolean migration', { migration: 'true' }, 'invalid_token'],
  ['attributes as roles', { attributes: { clan: ['admin'] } }, 'invalid_token'],
]) {
  test(`JWT rejects ${label}`, async () => {
    const api = await fixture();
    await assert.rejects(api.sso.client.verifyToken(await api.sign(claims)), { code });
  });
}

test('current contract defaults to one role; multiple roles require explicit legacy compatibility', async () => {
  const api = await fixture();
  const token = await api.sign({ roles: ['staff', 'admin'] });
  await assert.rejects(api.sso.client.verifyToken(token), { code: 'access_denied' });
  const legacy = new OrbitaClient({ ...api.options, roleMode: 'multiple' });
  assert.deepEqual((await legacy.verifyToken(token)).roles, ['staff', 'admin']);
  const single = new OrbitaClient({ ...api.options, roleMode: 'single' });
  await assert.rejects(single.verifyToken(token), { code: 'access_denied' });
});

test('unknown kid refreshes JWKS once; invalid signature fails closed', async () => {
  const api = await fixture();
  await assert.rejects(api.sso.client.verifyToken(await api.sign({}, { kid: 'unknown' })), { code: 'invalid_token' });
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('jwks.json')).length, 2);
  const token = await api.sign();
  const pieces = token.split('.');
  const signature = Buffer.from(pieces[2], 'base64url'); signature[0] ^= 1;
  pieces[2] = signature.toString('base64url');
  await assert.rejects(api.sso.client.verifyToken(pieces.join('.')), { code: 'invalid_token' });
});

test('rotating kid is accepted after one forced JWKS refresh', async () => {
  const api = await fixture();
  await api.sso.client.verifyToken(await api.sign());
  api.jwks = [{ ...api.jwks[0], kid: 'key-2' }];
  const identity = await api.sso.client.verifyToken(await api.sign({}, { kid: 'key-2' }));
  assert.equal(identity.email, 'demo@example.com');
});

test('exchange timeout never retries a single-use code or exposes provider messages', async () => {
  const api = await fixture(); api.fail = '/api/auth/token';
  await assert.rejects(api.sso.client.exchangeCode('c'.repeat(64)), (error) => {
    assert.ok(error instanceof OrbitaError); assert.equal(error.message, 'provider_unavailable'); return true;
  });
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('/token')).length, 1);
  assert.equal(api.calls.at(-1).options.redirect, 'error');
});

test('ordinary tokens cannot adopt roles; logout URLs must be trusted ticket URLs', async () => {
  const api = await fixture();
  await assert.rejects(api.sso.client.adoptRole(await api.sign(), 'admin'), { code: 'migration_denied' });
  assert.equal(api.calls.filter((entry) => entry.path.endsWith('/adopt-role')).length, 0);
  assert.match(await api.sso.client.centralLogoutUrl('http://localhost:3100/login'), /end-session\?ticket=/);
});

test('algorithm downgrade and ambiguous JWKS keys are rejected', async () => {
  const api = await fixture();
  const downgraded = Buffer.from(JSON.stringify({alg:'HS256',kid:'key-1'})).toString('base64url') + '.e30.c2ln';
  await assert.rejects(api.sso.client.verifyToken(downgraded), { code:'invalid_token' });
  assert.equal(api.calls.length, 0);
  api.jwks = [api.jwks[0], api.jwks[0]];
  await assert.rejects(api.sso.client.verifyToken(await api.sign()), { code:'invalid_token' });
});

test('exchange rejects near-expired evidence even within JWT clock tolerance and rejects replayed codes', async () => {
  const api = await fixture();
  api.claims = { exp: Math.floor(Date.now()/1000) };
  await assert.rejects(api.sso.client.exchangeCode('c'.repeat(64)), { code:'invalid_token' });
  api.claims = {};
  await assert.rejects(api.sso.client.exchangeCode('c'.repeat(64)), { code:'provider_rejected' });
});

test('returned logout URL cannot carry tokens or leave the provider origin', async () => {
  const api = await fixture();
  for (const logoutUrl of ['https://attacker.example/logout?ticket=x', 'http://localhost:9000/api/auth/end-session?ticket=x&access_token=secret', 'http://localhost:9000/other?ticket=x']) {
    const client = new OrbitaClient({ ...api.options, fetch: async (url, options) => new URL(url).pathname.endsWith('/logout-ticket') ? Response.json({ logout_url:logoutUrl }) : api.fetch(url,options) });
    await assert.rejects(client.centralLogoutUrl('http://localhost:3100/login'), (error) => error instanceof OrbitaError);
  }
});

test('malformed token response never reaches signature verification', async () => {
  const api = await fixture();
  const client = new OrbitaClient({ ...api.options, fetch: async (url, options) => new URL(url).pathname.endsWith('/token') ? Response.json({ access_token:'bad', expires_in:-1, token_type:'Bearer' }) : api.fetch(url,options) });
  await assert.rejects(client.exchangeCode('c'.repeat(64)), { code:'invalid_token' });
});
