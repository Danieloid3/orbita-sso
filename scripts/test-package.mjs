import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run test:package');
function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: process.env });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr + result.stdout);
  return result.stdout;
}
const info = JSON.parse(run([npmCli, 'pack', '--json', '--ignore-scripts'], root))[0];
const files = info.files.map((file) => file.path);
assert.ok(files.includes('dist/index.js'));
assert.ok(files.includes('dist/index.d.ts'));
assert.ok(files.includes('sql/postgres.sql'));
assert.ok(files.includes('skills/integrate-orbita-sso/SKILL.md'));
assert.ok(!files.some((file) => /^(src|test|node_modules|\.env|scripts|artifacts)(\/|$)/.test(file)));
assert.ok(!files.some((file) => /^(e2e|docs\/e2e)(\/|$)|^(RELEASE_REPORT\.md|docs\/(E2E_REPORT|PANEL)\.md)$/.test(file)), 'Internal application validation must not ship in the public package');
const consumer = await mkdtemp(join(tmpdir(), 'orbita-sso-consumer-'));
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run([npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', join(root, info.filename), 'express@5', 'pg@8', 'typescript@5.9.3', '@types/node@22', '@types/express@5', '@types/pg@8'], consumer);
await writeFile(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { createOrbitaSso, OrbitaClient, MemoryStateStore, MemorySessionStore } from 'orbita-sso';
import { orbitaExpress } from 'orbita-sso/express';
import { PostgresStateStore, PostgresSessionStore } from 'orbita-sso/postgres';
const sso = createOrbitaSso({
  baseUrl: 'http://localhost:9000', clientId: 'smoke-app', clientSecret: 'test-only',
  appUrl: 'http://localhost:3000', redirectUri: 'http://localhost:3000/auth/orbita/callback',
  roles: [{key:'member', displayName:'Member'}], development:true,
  stateStore: new MemoryStateStore(), sessionStore: new MemorySessionStore(),
});
assert.equal(await sso.handle(new Request('http://localhost:3000/other')), null);
assert.equal(typeof orbitaExpress(sso, {appUrl:'http://localhost:3000'}), 'function');
assert.ok(sso.client instanceof OrbitaClient);
const db = {query: async () => ({rows:[]})};
assert.equal(await new PostgresStateStore(db, 'smoke-app').consume('hash','nonce',1), null);
assert.equal(await new PostgresSessionStore(db, 'smoke-app').get('hash',1), null);
console.log('Packed ESM exports work in an independent consumer.');
`);
run(['smoke.mjs'], consumer);
await writeFile(join(consumer, 'consumer.ts'), `
import pg from 'pg';
import express from 'express';
import { createOrbitaSso, type Identity, type User } from 'orbita-sso';
import { orbitaExpress, toWebRequest } from 'orbita-sso/express';
import { PostgresStateStore, PostgresSessionStore } from 'orbita-sso/postgres';
type LocalUser = {id:string; name:string};
const db = new pg.Pool();
const sso = createOrbitaSso<LocalUser>({
  baseUrl:'https://identity.example', clientId:'my-app', clientSecret:'test-only',
  appUrl:'https://app.example', redirectUri:'https://app.example/auth/orbita/callback',
  roles:[{key:'member',displayName:'Member'}],
  stateStore:new PostgresStateStore(db,'my-app'),
  sessionStore:new PostgresSessionStore<LocalUser>(db,'my-app'),
  resolveUser: async (identity: Identity) => ({id:identity.subject, name:identity.name}),
});
const app = express(); app.use(orbitaExpress(sso, {appUrl:'https://app.example'}));
app.get('/private', async (req, res) => {
  const session = await sso.getSession(toWebRequest(req, 'https://app.example'));
  const user: User | undefined = session?.user;
  res.json(user);
});
`);
run([join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', 'consumer.ts'], consumer);
await readFile(join(consumer, 'node_modules/orbita-sso/skills/integrate-orbita-sso/references/migration.md'), 'utf8');
console.log(`Package verified: ${info.filename}; independent ESM imports, TypeScript/pg/Express compatibility and shipped skill.`);
console.log(`Temporary consumer retained for inspection: ${consumer}`);
