import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { orbitaExpress, toWebRequest } from '../dist/express.js';
import { fixture } from './fixture.mjs';

test('Express serves the actual login/callback/session flow, preserves separate cookies and passes other routes', async (t) => {
  const api = await fixture();
  const app = express();
  app.use(orbitaExpress(api.sso, { appUrl: 'http://localhost:3100' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const start = await fetch(`${origin}/auth/orbita/login`, { redirect: 'manual', headers: { 'x-forwarded-host': 'attacker.example' } });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const nonce = start.headers.getSetCookie()[0].split(';')[0];
  const end = await fetch(`${origin}/auth/orbita/callback?state=${state}&code=${'c'.repeat(64)}`, { redirect: 'manual', headers: { cookie: nonce } });
  assert.equal(end.headers.getSetCookie().length, 2);
  const sessionCookie = end.headers.getSetCookie().find((cookie) => cookie.startsWith('orbita_app_session=')).split(';')[0];
  const session = await fetch(`${origin}/auth/orbita/session`, { headers: { cookie: sessionCookie } });
  assert.equal(session.status, 200); assert.equal((await session.json()).user.email, 'demo@example.com');
  assert.deepEqual(await (await fetch(`${origin}/health`)).json(), { ok: true });
});

test('Express conversion uses public origin even for malicious absolute URLs and forwarded headers', () => {
  const request = toWebRequest({ originalUrl: '//attacker.example/auth/orbita/session?x=1', method: 'GET', headers: { host: 'attacker.example', 'x-forwarded-host': 'other.example' } }, 'https://app.example');
  assert.equal(request.url, 'https://app.example/auth/orbita/session?x=1');
});
