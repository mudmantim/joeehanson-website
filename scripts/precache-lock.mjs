/**
 * Records the current precache contents against the current cache name.
 *
 *   node scripts/precache-lock.mjs
 *
 * Run this after bumping CACHE in public/sw.js. The test suite compares the
 * live files against this lock and fails if precached content changed without
 * the cache name changing with it -- the mistake that leaves every returning
 * visitor on stale files forever, silently, with the site still working.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function precacheState() {
  const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
  const cache = sw.match(/const CACHE = '([^']+)'/)?.[1] ?? null;
  const entries = (sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] ?? '')
    .split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

  const h = createHash('sha256');
  for (const entry of entries.slice().sort()) {
    const rel = entry === '/' ? 'index.html' : entry.slice(1);
    h.update(entry).update('\0');
    try { h.update(readFileSync(join(root, 'public', rel))); }
    catch { h.update('MISSING'); }
  }
  return { cache, entries: entries.length, hash: h.digest('hex').slice(0, 32) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = precacheState();
  writeFileSync(join(root, 'tests', 'precache-lock.json'), JSON.stringify(state, null, 2) + '\n');
  console.log('precache lock written:', JSON.stringify(state));
}
