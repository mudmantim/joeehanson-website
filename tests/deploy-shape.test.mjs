/**
 * The publish directory is the security boundary.
 *
 * Netlify serves public/ and nothing else, so the guarantee "source and
 * secrets are unreachable" is only as true as the contents of that directory.
 * These tests fail if anything private drifts into it, or if the site loses
 * something it needs.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(root, 'public');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(relative(PUBLIC, full));
  }
  return acc;
}

export default function run(t) {
  // --- netlify.toml points at public/ ------------------------------------
  const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
  t.ok(/publish\s*=\s*"public"/.test(toml), 'netlify.toml publishes from public/');

  // --- the site's own files are present ----------------------------------
  for (const f of ['index.html', 'style.css', 'script.js', 'sw.js', 'manifest.json',
                   'sitemap.xml', 'robots.txt', 'favicon.ico', 'apple-touch-icon.png',
                   'data/releases.json', 'data/fragments.json', 'data/socials.json']) {
    t.ok(existsSync(join(PUBLIC, f)), `public/${f} exists`);
  }

  // --- nothing private is inside public/ ---------------------------------
  const files = walk(PUBLIC);
  const forbidden = [
    /(^|\/)netlify\//, /(^|\/)node_modules\//, /(^|\/)tests?\//,
    /(^|\/)package(-lock)?\.json$/, /\.env/, /(^|\/)docs\//,
    /(^|\/)README\.md$/, /\.ts$/, /\.mts$/,
  ];
  for (const f of files) {
    for (const pat of forbidden) {
      t.ok(!pat.test(f), `public/ contains nothing private — offender: ${f}`);
    }
  }

  // --- private things live outside public/, and stay there ---------------
  for (const f of ['netlify/edge-functions/collect.ts', 'netlify/edge-functions/admin.ts',
                   'netlify/lib/crypto.ts', 'netlify/lib/store.ts',
                   'netlify/functions/prune.mts', 'package.json', 'README.md']) {
    t.ok(existsSync(join(root, f)), `${f} exists outside public/`);
    t.ok(!existsSync(join(PUBLIC, f)), `${f} is NOT duplicated inside public/`);
  }

  // --- the admin surface is not a static file ----------------------------
  t.ok(!existsSync(join(PUBLIC, 'admin')), 'there is no public/admin directory to leak');

  // --- the public site does not advertise the private one ----------------
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  t.ok(!/\/admin/.test(html), 'index.html contains no /admin link');
  t.ok(!/\/admin/.test(readFileSync(join(PUBLIC, 'sitemap.xml'), 'utf8')), 'sitemap.xml omits /admin');
  t.ok(!/\/admin/.test(readFileSync(join(PUBLIC, 'manifest.json'), 'utf8')), 'manifest.json omits /admin');

  // --- privacy constraints, asserted against the shipped source ----------
  const collector = readFileSync(join(root, 'netlify/edge-functions/collect.ts'), 'utf8');
  t.ok(/never (stored|written)/i.test(collector), 'collector documents what it does not store');
  t.ok(!/\bip\s*:/.test(collector.replace(/\/\/.*$/gm, '')), 'collector never assigns a raw ip into a record');
  t.ok(/\.slice\(0, 16\)/.test(collector), 'visitor id is truncated');

  const client = readFileSync(join(PUBLIC, 'script.js'), 'utf8');
  t.ok(!/document\.cookie/.test(client), 'client sets no cookies for ordinary visitors');
  t.ok(/jh_fs/.test(client), 'client uses the month stamp for new-vs-returning');
  t.ok(!/canvas|webgl|AudioContext|deviceMemory|hardwareConcurrency/i.test(client),
       'client does no fingerprinting');
  // Check for a real listener, not the word appearing in a comment.
  t.ok(!/addEventListener\(\s*['"](beforeunload|unload)['"]/.test(client),
       'client registers no beforeunload/unload listener (both are bfcache-hostile)');
  t.ok(/pagehide/.test(client), 'client flushes on pagehide');
  t.ok(/sendBeacon/.test(client), 'client uses sendBeacon for the final flush');
}
