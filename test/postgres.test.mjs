import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PostgresStateStore, PostgresSessionStore } from '../dist/postgres.js';

test('Postgres consume performs expiry/nonce checking and consumption in one parameterized statement', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  const store = new PostgresStateStore(db, 'test-app');
  assert.equal(await store.consume('state-hash', 'nonce-hash', 123), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^DELETE .*nonce_hash = \$3 AND expires_at > \$4 RETURNING payload$/);
  assert.deepEqual(calls[0].params, ['test-app', 'state-hash', 'nonce-hash', 123]);
});

test('SDK SQL runs in embedded Postgres: JSON roundtrip, namespace isolation, expiry and one-use state', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const ddl = await readFile(new URL('../sql/postgres.sql', import.meta.url), 'utf8');
  await db.exec(ddl); await db.exec(ddl); // Idempotent schema creation.
  const states = new PostgresStateStore(db, 'app-one');
  const other = new PostgresStateStore(db, 'app-two');
  await states.put('hash', { nonceHash: 'nonce', expiresAt: 200, migration: { accountId: '42', subject: 'subject', role: 'staff' } });
  assert.equal(await other.consume('hash', 'nonce', 100), null);
  assert.equal(await states.consume('hash', 'wrong', 100), null);
  const results = await Promise.all([states.consume('hash', 'nonce', 100), states.consume('hash', 'nonce', 100)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).migration.accountId, '42');
  await states.put('expired', { nonceHash: 'nonce', expiresAt: 1 });
  assert.equal(await states.consume('expired', 'nonce', 100), null);
  const sessions = new PostgresSessionStore(db, 'app-one');
  const record = { user: { id: '42' }, identity: { subject: 'subject' }, providerToken: 'test-only', csrfToken: 'csrf', expiresAt: 200 };
  await sessions.put('session', record);
  assert.deepEqual(await sessions.get('session', 100), record);
  assert.equal(await new PostgresSessionStore(db, 'app-two').get('session', 100), null);
  assert.equal(await sessions.get('session', 200), null);
  await sessions.delete('session'); assert.equal(await sessions.get('session', 100), null);
});

test('Postgres roundtrip and concurrent consumers across independent connections', { skip: !process.env.ORBITA_TEST_DATABASE_URL }, async (t) => {
  // ONLY point this at a dedicated test database; never staging/production.
  const db = new pg.Pool({ connectionString: process.env.ORBITA_TEST_DATABASE_URL });
  const otherDb = new pg.Pool({ connectionString: process.env.ORBITA_TEST_DATABASE_URL });
  const namespace = `test-${randomUUID()}`;
  t.after(async () => {
    await db.query('DELETE FROM orbita_sdk_states WHERE namespace = $1', [namespace]);
    await db.query('DELETE FROM orbita_sdk_sessions WHERE namespace = $1', [namespace]);
    await Promise.all([db.end(), otherDb.end()]);
  });
  await db.query(await readFile(new URL('../sql/postgres.sql', import.meta.url), 'utf8'));
  const state = new PostgresStateStore(db, namespace);
  const second = new PostgresStateStore(otherDb, namespace);
  await state.put('hash', { nonceHash: 'nonce', expiresAt: 200 });
  assert.equal(await second.consume('hash', 'wrong', 100), null);
  const consumed = await Promise.all([state.consume('hash', 'nonce', 100), second.consume('hash', 'nonce', 100)]);
  assert.equal(consumed.filter(Boolean).length, 1);
  await state.put('expired', { nonceHash: 'nonce', expiresAt: 1 });
  assert.equal(await state.consume('expired', 'nonce', 100), null);
  const sessions = new PostgresSessionStore(db, namespace);
  const record = { user: { id: '42' }, identity: { subject: 'test-subject' }, providerToken: 'test-only', expiresAt: 200, csrfToken: 'csrf' };
  await sessions.put('session-hash', record);
  assert.deepEqual(await sessions.get('session-hash', 100), record);
  assert.equal(await sessions.get('session-hash', 201), null);
  await sessions.delete('session-hash');
  assert.equal(await sessions.get('session-hash', 100), null);
});
