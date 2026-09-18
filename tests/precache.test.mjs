/**
 * The service worker's PRECACHE list must be exactly right.
 *
 * `cache.addAll()` is atomic: one 404 rejects the whole call, install fails,
 * and the worker never activates. Nothing surfaces that — the site keeps
 * working, the PWA just quietly stops being installable and offline-capable.
 * This was found the hard way in Phase 0, and it is why this file exists.
 */

import { readFileSync, existsSync } from 'node:fs';
import { precacheState } from '../scripts/precache-lock.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(root, 'public');

export default function run(t) {
  const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');

  const match = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
  t.ok(match, 'sw.js declares a PRECACHE array');

  const entries = match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  t.ok(entries.length > 0, `PRECACHE is not empty (${entries.length} entries)`);

  for (const entry of entries) {
    t.ok(entry.startsWith('/'), `precache entry is root-relative: ${entry}`);
    const rel = entry === '/' ? 'index.html' : entry.slice(1);
    t.ok(
      existsSync(join(PUBLIC, rel)),
      `precache entry exists in public/: ${entry}`,
    );
  }

  // Duplicates are harmless to the browser but always indicate an editing
  // mistake, and they inflate the install payload.
  const dupes = entries.filter((e, i) => entries.indexOf(e) !== i);
  t.equal(dupes.length, 0, `no duplicate precache entries${dupes.length ? ': ' + dupes.join(', ') : ''}`);

  // The cache name must change whenever precached content changes, or
  // returning visitors keep the old copies. Phase 1 ships v5.
  const cacheName = sw.match(/const CACHE = '([^']+)'/)?.[1];
  t.ok(/^joeehanson-v\d+$/.test(cacheName ?? ''), `cache name is versioned: ${cacheName}`);

  // The dashboard must never be cacheable.
  t.ok(
    /pathname\.startsWith\('\/api\/'\)/.test(sw) && /pathname\.startsWith\('\/admin'\)/.test(sw),
    'fetch handler bypasses /api/ and /admin',
  );

  // Nothing private may be precached.
  for (const entry of entries) {
    t.ok(
      !entry.startsWith('/admin') && !entry.startsWith('/api/'),
      `precache entry is not private: ${entry}`,
    );
  }
}

/**
 * Precached content and the cache name must change together.
 *
 * Bumping CACHE is the only thing that makes a returning visitor pick up new
 * files. Editing a precached file without bumping it leaves every existing
 * visitor on the old copy indefinitely -- silently, with the site still
 * working, which is why nobody notices.
 *
 * This nearly shipped in Phase 3: script.js gained the whole attribution
 * collector while the cache name stayed at v5.
 */
export function precacheLock(t) {
  const live = precacheState();
  const lockPath = join(root, 'tests', 'precache-lock.json');

  t.ok(existsSync(lockPath), 'tests/precache-lock.json exists');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

  if (live.hash === lock.hash) {
    t.equal(live.cache, lock.cache, 'precached content is unchanged, so the cache name is unchanged');
  } else {
    t.ok(
      live.cache !== lock.cache,
      `precached content changed but CACHE is still ${live.cache} — bump it in public/sw.js, ` +
      'then run `node scripts/precache-lock.mjs`. Without the bump, every returning ' +
      'visitor keeps the old files forever.',
    );
    t.ok(false,
      'precache lock is stale — run `node scripts/precache-lock.mjs` to record the new contents');
  }

  t.equal(live.entries, lock.entries, 'the precache entry count matches the lock');
}
