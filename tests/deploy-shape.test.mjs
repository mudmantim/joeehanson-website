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

/**
 * Environment isolation must not depend on CONTEXT.
 *
 * Production, deploy previews and local dev shared one blob store until this
 * was found: `Netlify.env.get('CONTEXT')` is undefined in the edge runtime, so
 * the production check silently returned false everywhere and a preview write
 * landed in production. The hostname is the signal now, and these assertions
 * exist so it cannot quietly regress.
 */
export function environmentIsolation(t) {
  const store = readFileSync(join(root, 'netlify/lib/store.ts'), 'utf8');
  // Strip comments: the file documents the CONTEXT bug in prose, and matching
  // that would be checking the explanation rather than the code.
  const code = store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // Was `hostname === PRODUCTION_HOST` when there was one production host.
  // There are two now -- the site and the dashboard's subdomain -- so the check
  // is exact membership of a fixed list. tests/host-routing.test.mjs calls the
  // function with real hostnames, including the look-alike branch deploy.
  t.ok(/PRODUCTION_HOSTS\.includes\(new URL\(req\.url\)\.hostname\)/.test(code),
       'production is determined by exact hostname membership');
  t.ok(!/hostname\.startsWith|hostname\.includes|hostname\.endsWith/.test(code),
       'and never by a prefix or substring match');
  t.ok(!/Netlify\.env\.get\(['"]CONTEXT['"]\)/.test(code),
       'store.ts does not rely on CONTEXT in the edge runtime');
  t.ok(/PRODUCTION_HOST = 'joeehanson\.com'/.test(code),
       'the canonical production host is pinned');
  t.ok(/export const PREVIEW_STORE_NAME/.test(code) && /export const STORE_NAME/.test(code),
       'production and preview stores have distinct names');

  // Every caller must pass the flag explicitly; a bare analyticsStore() would
  // reintroduce an implicit, wrong default.
  for (const f of ['netlify/edge-functions/collect.ts', 'netlify/edge-functions/admin.ts',
                   'netlify/functions/prune.mts']) {
    const src = readFileSync(join(root, f), 'utf8');
    t.ok(!/analyticsStore\(\s*\)/.test(src), `${f} never calls analyticsStore() without an environment`);
  }

  const collect = readFileSync(join(root, 'netlify/edge-functions/collect.ts'), 'utf8');
  t.ok(/isProductionRequest\(req\)/.test(collect), 'collector decides environment per request');
}

/**
 * The credential scripts must not leak what they are handling.
 *
 * A password given on a command line lands in shell history and the process
 * list; one echoed to the terminal lands in scrollback. The current admin
 * password reached both, which is the reason it is being rotated.
 */
export function credentialHandling(t) {
  const setPw = readFileSync(join(root, 'scripts/set-admin-password.mjs'), 'utf8');
  const genAll = readFileSync(join(root, 'scripts/gen-admin-secrets.mjs'), 'utf8');

  for (const [name, src] of [['set-admin-password', setPw], ['gen-admin-secrets', genAll]]) {
    t.ok(/process\.argv\.length > 2/.test(src) && /process\.exit\(2\)/.test(src),
      `${name} refuses a password passed as an argument`);
    t.ok(!/writeFileSync|writeFile\(|appendFile|createWriteStream/.test(src),
      `${name} writes no file`);
  }

  // The rotation script must prompt with echo off and never print the entry.
  t.ok(/setRawMode\(true\)/.test(setPw), 'set-admin-password disables terminal echo');
  t.ok(/isTTY/.test(setPw), 'set-admin-password requires an interactive terminal');
  t.ok(/first !== second/.test(setPw), 'set-admin-password asks twice and compares');
  // The real risk is interpolating the captured value, not the word appearing
  // in the script's own prose.
  t.ok(!/\$\{\s*(first|second)\s*\}/.test(setPw),
    'set-admin-password never interpolates the entered password into output');
  t.ok(!/console\.(log|error)\(\s*(first|second)\s*\)/.test(setPw),
    'set-admin-password never logs the entered password directly');

  // It must not touch the signing secret, which would sign everyone out and
  // un-mark every excluded browser.
  t.ok(!/JH_SECRET\s*[:=]/.test(setPw), 'set-admin-password does not generate a new JH_SECRET');
  t.ok(/JH_ADMIN_PW_SALT/.test(setPw) && /JH_ADMIN_PW_HASH/.test(setPw),
    'set-admin-password emits exactly the two password variables');
  t.ok(/Leave JH_SECRET exactly as it is/.test(setPw),
    'set-admin-password warns against changing JH_SECRET');

  // Its PBKDF2 parameters must match the server, or a new password would never
  // verify and the only operator would be locked out.
  const server = readFileSync(join(root, 'netlify/lib/crypto.ts'), 'utf8');
  const serverIters = server.match(/iterations = ([0-9_]+)/)?.[1];
  const scriptIters = setPw.match(/ITERATIONS = ([0-9_]+)/)?.[1];
  t.equal(scriptIters, serverIters, 'PBKDF2 iterations match the server');
  t.ok(/deriveBits\([\s\S]*?key,\s*256\s*\)/.test(setPw), 'script derives 256 bits, as the server does');
  t.ok(/hash: 'SHA-256'/.test(setPw), 'script uses SHA-256, as the server does');
}
