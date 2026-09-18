/**
 * The service worker's PRECACHE list must be exactly right.
 *
 * `cache.addAll()` is atomic: one 404 rejects the whole call, install fails,
 * and the worker never activates. Nothing surfaces that — the site keeps
 * working, the PWA just quietly stops being installable and offline-capable.
 * This was found the hard way in Phase 0, and it is why this file exists.
 */

import { readFileSync, existsSync } from 'node:fs';
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
