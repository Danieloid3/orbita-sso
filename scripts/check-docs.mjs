import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'artifacts'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await check(path); continue; }
    if (!entry.name.endsWith('.md')) continue;
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      await access(resolve(dirname(path), target.split('#')[0]));
    }
  }
}
await check(root);
console.log('All local documentation and skill links resolve.');
