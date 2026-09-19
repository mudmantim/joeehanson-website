/**
 * /admin is installable as its own app, and installing it changes nothing else.
 *
 * Three separate promises are made here, and each one is easy to break by
 * accident later:
 *
 *   1. It is a SEPARATE app. Android decides that from the manifest `id`. Make
 *      the admin id equal the public one and the installed dashboard quietly
 *      replaces the artist's app on the home screen.
 *   2. It stores NOTHING. A service worker is the obvious place for a future
 *      "make it faster offline" change to land, and the thing it would cache is
 *      a private dashboard on a shared phone.
 *   3. Opening it records no visit. The dashboard must never load the public
 *      collector, or looking at the numbers would change them.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

const pwaSrc = read('netlify/lib/admin-pwa.ts');
const adminSrc = read('netlify/edge-functions/admin.ts');
const uiSrc = read('netlify/lib/admin-ui.ts');
const swSrc = read('public/sw.js');

/** Evaluate the manifest literal from the source, so the test reads what ships. */
function adminManifest() {
  const body = pwaSrc.match(/export const ADMIN_MANIFEST = JSON\.stringify\(\s*(\{[\s\S]*?\}),\s*null,\s*2,\s*\);/);
  if (!body) throw new Error('could not find the ADMIN_MANIFEST literal');
  return (0, eval)('(' + body[1] + ')');
}

/** The service worker source, as the edge function will serve it. */
function adminWorker() {
  const m = pwaSrc.match(/export const ADMIN_SW = `([\s\S]*?)`;\s*$/);
  if (!m) throw new Error('could not find the ADMIN_SW template');
  return m[1];
}

/** Width and height straight out of a PNG's IHDR, to catch a mislabelled icon. */
function pngSize(file) {
  const buf = readFileSync(join(root, 'public', file.replace(/^\//, '')));
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export default function run(t) {
  const m = adminManifest();
  const pub = JSON.parse(read('public/manifest.json'));
  const base = 'https://joeehanson.com';

  // ---- A separate app, not a replacement for the public one ---------------
  t.ok(m.id !== undefined, 'the admin manifest declares an id');
  t.ok(new URL(m.id, base).href !== new URL(pub.id, base).href,
       'the admin id differs from the public id — Android installs two apps, not one');
  t.equal(new URL(m.id, base).href, `${base}/admin`, 'the admin id resolves to /admin');
  t.ok(m.name !== pub.name && m.short_name !== pub.short_name,
       'the admin app has its own name on the home screen');

  // Relative, so a deploy preview describes the preview rather than claiming a
  // cross-origin id (which browsers reject outright).
  for (const field of ['id', 'start_url', 'scope']) {
    t.ok(!/^https?:/.test(m[field]), `manifest ${field} is relative, so it works on any origin`);
  }

  // ---- Installability, which is unforgiving about specifics ---------------
  t.equal(m.start_url, '/admin', 'start_url is the dashboard');
  t.equal(m.scope, '/admin', 'scope has no trailing slash, so a bare /admin is inside it');
  t.ok(m.start_url.startsWith(m.scope), 'start_url is within scope');
  t.equal(m.display, 'standalone', 'it opens as an app, not a browser tab');
  const sizes = m.icons.map((i) => i.sizes);
  t.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'both required icon sizes are declared');
  t.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon exists, so Android does not letterbox it');

  // ---- The icons exist, are the size they claim, and are not the band's ---
  for (const icon of m.icons) {
    const path = icon.src.replace(/^\//, '');
    t.ok(existsSync(join(root, 'public', path)), `${icon.src} exists`);
    t.ok(!/\/icon-\d+\.png$/.test(icon.src), `${icon.src} is not a public-site icon — the app needs its own mark`);
    if (existsSync(join(root, 'public', path))) {
      const [w, h] = icon.sizes.split('x').map(Number);
      const actual = pngSize(icon.src);
      t.equal(`${actual.w}x${actual.h}`, `${w}x${h}`, `${icon.src} really is ${icon.sizes}`);
    }
  }
  const pubIcons = new Set(pub.icons.map((i) => i.src.replace(/^\//, '')));
  for (const icon of m.icons) {
    t.ok(!pubIcons.has(icon.src.replace(/^\//, '')), `${icon.src} is not shared with the public manifest`);
  }

  // ---- The public app is untouched ----------------------------------------
  t.equal(new URL(pub.id, base).href, `${base}/`, 'the public manifest still identifies the public site');
  t.equal(pub.start_url, `${base}/`, 'the public start_url is unchanged');
  t.equal(pub.scope, `${base}/`, 'the public scope is unchanged');
  t.ok(!/admin/.test(read('public/manifest.json')), 'the public manifest mentions no admin route');
  t.ok(!/admin/.test(read('public/index.html')), 'the public page still links nothing admin');
}

/**
 * The worker exists so Android will mint an app. It is not a cache.
 */
export function workerStoresNothing(t) {
  const sw = adminWorker();
  // Strip comments first: this file explains at length what it does not do, and
  // matching the explanation instead of the code is how a test lies.
  const code = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  t.ok(!/\bcaches\b/.test(code), 'the admin worker never reaches the Cache Storage API');
  for (const call of ['caches.open', 'caches.match', 'caches.keys', '.addAll(', '.put(', 'cache.match']) {
    t.ok(!code.includes(call), `the admin worker never calls ${call}`);
  }
  t.ok(!/localStorage|sessionStorage|indexedDB|IDBDatabase/.test(code),
       'the admin worker uses no other persistent storage either');
  t.ok(!/importScripts/.test(code), 'the admin worker pulls in no third-party code');

  // Installability requires a fetch handler. It must stay one that handles page
  // loads only, so an /api/ response is never even inspected.
  t.ok(/addEventListener\('fetch'/.test(code), 'the admin worker registers a fetch handler');
  t.ok(/addEventListener\('install'/.test(code), 'the admin worker registers an install handler');
  t.ok(/addEventListener\('activate'/.test(code), 'the admin worker registers an activate handler');
  t.ok(/request\.mode !== 'navigate'/.test(code) && /return;/.test(code),
       'anything that is not a page load returns early and goes to the network untouched');
  t.ok(/event\.respondWith\(\s*fetch\(request\)/.test(code),
       'page loads are answered from the network, never from storage');
  t.ok(/'cache-control': 'no-store'/.test(code), 'the generated offline page is itself uncacheable');

  // The offline page has to be self-contained: it is shown precisely when
  // nothing can be fetched.
  t.ok(!/<script src|<link rel="stylesheet"|https?:\/\//.test(sw.match(/var OFFLINE =[\s\S]*?';\n/)?.[0] ?? ''),
       'the offline page loads nothing external');
}

/**
 * Routing: the shell is reachable, everything that returns data is not.
 */
export function routingAndGating(t) {
  t.ok(/path: \[[^\]]*'\/admin\/\*'/.test(adminSrc), "the edge function still claims /admin/*");

  const manifestRoute = adminSrc.indexOf("path === '/admin/manifest.webmanifest'");
  const workerRoute = adminSrc.indexOf("path === '/admin/sw.js'");
  const gate = adminSrc.indexOf('if (!session.valid)');
  const statsRoute = adminSrc.indexOf("path === '/api/stats'");

  t.ok(manifestRoute > 0, 'the manifest has a route');
  t.ok(workerRoute > 0, 'the worker has a route');
  // Google's WebAPK service fetches both without cookies; behind the gate they
  // would 401 and the app would simply never install.
  t.ok(manifestRoute < gate, 'the manifest is served before the session gate');
  t.ok(workerRoute < gate, 'the worker is served before the session gate');
  // Everything that answers with numbers stays behind it.
  t.ok(statsRoute > gate, '/api/stats is still behind the session gate');

  t.ok(/'service-worker-allowed': '\/admin'/.test(adminSrc),
       'the worker is allowed the widened /admin scope, so a bare /admin is controlled');
  t.ok(/'content-type': 'application\/manifest\+json/.test(adminSrc), 'the manifest is served as a manifest');
  t.ok(/'content-type': 'text\/javascript/.test(adminSrc), 'the worker is served as javascript');

  // Neither may become a file on the public site.
  t.ok(!existsSync(join(root, 'public/admin')), 'there is still no public/admin directory');
  t.ok(!existsSync(join(root, 'public/admin.webmanifest')), 'the admin manifest is not a public file');

  // The public worker must keep its hands off both.
  const pubCode = swSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  t.ok(/startsWith\('\/admin'\)/.test(pubCode), 'the public worker still bypasses /admin');
  t.ok(/startsWith\('\/api\/'\)/.test(pubCode), 'the public worker still bypasses /api/');
  t.ok(!/\/admin/.test(swSrc.match(/const PRECACHE = \[[\s\S]*?\];/)[0]),
       'nothing admin is in the public precache list');
}

/**
 * Opening the dashboard must not put a visit into the dashboard.
 */
export function openingItRecordsNothing(t) {
  // The comments in admin-ui.ts discuss script.js at length, and matching that
  // would be checking the explanation. The risk is a tag that actually loads it.
  t.ok(!/<script[^>]+src=/.test(uiSrc), 'the dashboard loads no external script at all');
  t.ok(!/src=["'][^"']*script\.js/.test(uiSrc), 'in particular it never loads the public collector');
  t.ok(!/sendBeacon/.test(uiSrc), 'the dashboard sends no beacons');
  t.ok(!/addEventListener\(\s*['"]pagehide['"]/.test(uiSrc), 'the dashboard registers no pagehide flush');
  t.ok(!/jh_fs/.test(uiSrc), 'the dashboard writes no first-seen stamp');
  t.ok(!/visibilitychange/.test(uiSrc), 'the dashboard runs no engagement clock');

  // The one place it posts to the collector is the deliberate test button, and
  // that event is flagged so it lands in the excluded log.
  const posts = uiSrc.match(/fetch\('\/api\/e'[\s\S]*?\}\)\}\);/g) ?? [];
  t.equal(posts.length, 1, 'the dashboard posts to the collector exactly once, from the test button');
  t.ok(posts[0]?.includes('test:true'), 'that single post is marked as a test');

  // The worker must not reintroduce it by another route.
  t.ok(!/\/api\/e/.test(adminWorker()), 'the service worker never posts analytics');
  t.ok(!/registration|register\(/.test(read('public/script.js').match(/\/admin[\s\S]{0,80}/)?.[0] ?? ''),
       'the public script does not register anything under /admin');
}

/**
 * Phone layout.
 *
 * The previous mobile check asserted scrollWidth > innerWidth, which cannot
 * catch this class of bug: the columns did not overflow, they compressed until
 * "direct / none" and "20" met with no space between them and the headers read
 * "ENGAGEDSTREAMING". These assertions are about the two things that actually
 * prevent it — real horizontal padding, and labels that survive losing the
 * header row.
 */
export function phoneLayout(t) {
  const shell = uiSrc.match(/const SHELL = `([\s\S]*?)`;/)[1];

  const cellRule = shell.match(/\n\s*th,td\{([^}]*)\}/)?.[1] ?? '';
  t.ok(/padding:\s*[.\d]+rem\s+[.\d]+rem/.test(cellRule), 'cells have horizontal padding, not just vertical');
  const [, horiz] = cellRule.match(/padding:\s*[.\d]+rem\s+([.\d]+)rem/) ?? [];
  t.ok(Number(horiz) > 0, 'that horizontal padding is greater than zero');

  t.ok(/th:not\(:first-child\),td:not\(:first-child\)\{[^}]*white-space:nowrap/.test(shell),
       'figures never wrap mid-number');
  t.ok(/@media \(max-width:640px\)/.test(shell), 'there is a phone breakpoint');
  t.ok(/@media \(max-width:560px\)/.test(shell), 'there is a narrow breakpoint where the table restacks');
  t.ok(/\.tw thead\{position:absolute/.test(shell), 'the header row leaves the flow when the table restacks');
  t.ok(/content:attr\(data-l\)/.test(shell), 'each figure prints its own label once the header is gone');

  // Which only works if every cell actually carries one.
  t.ok(/<td data-l="'\+esc\(firstHeader\)\+'"/.test(uiSrc), 'the first column carries its heading');
  t.ok(/'<td data-l="'\+esc\(labels\[i\]\)\+'">'/.test(uiSrc), 'every other cell carries its heading');
  const tables = uiSrc.match(/return '<div class="tw"><table>/g) ?? [];
  t.equal(tables.length, 2, 'both table builders wrap their table for narrow screens');
  t.ok(!/return '<table>/.test(uiSrc), 'no table is emitted outside that wrapper');
}

/**
 * A session lasts seven days. What happens on day eight is part of the product,
 * and inside an installed app it is the only navigation the operator has.
 */
export function sessionExpiry(t) {
  t.ok(/res\.status === 401/.test(uiSrc), 'the dashboard recognises an expired session');
  t.ok(/function signedOut\(\)/.test(uiSrc), 'it has one place that handles being signed out');
  t.ok(/location\.assign\('\/admin'\)/.test(uiSrc), 'it navigates to the sign-in screen');
  t.ok(/Your session has expired/.test(uiSrc), 'it says so in words, not just by redirecting');

  // Every authenticated read must go through the helper, or one of them will
  // parse a 401 as data again.
  const rawReads = uiSrc.match(/fetch\('\/api\/(stats|test-event|whoami)[^)]*\)/g) ?? [];
  t.equal(rawReads.length, 0, 'no authenticated read bypasses the 401 check');
  t.ok(/await api\('\/api\/stats\?'\+qs\)/.test(uiSrc), 'the main load goes through it');
  t.ok(/await api\('\/api\/test-event'\)/.test(uiSrc), 'the test button goes through it');

  // The sign-in page is where an expired app session lands, so it needs the
  // manifest too — otherwise Android sees a document that is not the app.
  const login = uiSrc.match(/export function renderLogin[\s\S]*?\n\}/)[0];
  t.ok(/\$\{PWA_HEAD\}/.test(login), 'the sign-in page carries the manifest link');
  t.ok(/\$\{SW_REGISTER\}/.test(login), 'the sign-in page registers the worker');
  t.ok(/rel="manifest" href="\/admin\/manifest\.webmanifest"/.test(uiSrc), 'the manifest is linked by path');
  t.ok(/navigator\.serviceWorker\.register\('\/admin\/sw\.js', \{ scope: '\/admin' \}\)/.test(uiSrc),
       'the worker is registered at the widened scope');
}

/**
 * What the two pages actually render.
 *
 * Everything above reads source text, which cannot see the one failure this
 * work already hit: a stray backtick inside a comment that happened to sit
 * within the dashboard's template literal closed the string early. The source
 * still contained every line you would grep for. It simply was not a program.
 * So these assertions build the pages and compile the scripts they embed.
 */
export async function renderedOutput(t) {
  const { renderDashboard, renderLogin } = await import('../netlify/lib/admin-ui.ts');
  const { ADMIN_MANIFEST, ADMIN_SW } = await import('../netlify/lib/admin-pwa.ts');

  const pages = {
    'sign-in': renderLogin('Incorrect.'),
    dashboard: renderDashboard({ excluded: true, expiresAt: 1789000000, production: true }),
  };

  for (const [name, out] of Object.entries(pages)) {
    t.ok(out.startsWith('<!doctype html>'), `${name} is a whole document`);
    t.ok(out.trimEnd().endsWith('</html>'), `${name} is not truncated`);
    // A backtick reaching the output means a template literal ended somewhere
    // it was not meant to. Neither page has any legitimate use for one.
    t.ok(!out.includes('`'), `${name} contains no stray backtick`);
    t.ok(!out.includes('${'), `${name} left nothing uninterpolated`);
    t.equal((out.match(/<script/g) ?? []).length, (out.match(/<\/script>/g) ?? []).length,
            `${name} opens and closes the same number of script tags`);

    t.ok(out.includes('<link rel="manifest" href="/admin/manifest.webmanifest">'),
         `${name} links the admin manifest`);
    t.ok(out.includes("navigator.serviceWorker.register('/admin/sw.js'"),
         `${name} registers the admin worker`);
    t.ok(out.includes('noindex'), `${name} still asks not to be indexed`);

    // Every script the page embeds has to compile, or the dashboard is a blank
    // screen with an error only the console ever sees.
    const scripts = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    t.ok(scripts.length > 0, `${name} embeds at least one script`);
    for (const [i, js] of scripts.entries()) {
      let compiled = true;
      try { new Function(js); } catch (err) { compiled = false; }
      t.ok(compiled, `${name} script #${i + 1} compiles`);
    }
  }

  // The dashboard's tables must emit the per-cell labels the phone layout needs.
  t.ok(pages.dashboard.includes('data-l="'), 'the dashboard builds cells that carry their own heading');

  // The manifest and worker are served as literal strings; they have to be real.
  let manifest;
  try { manifest = JSON.parse(ADMIN_MANIFEST); } catch { manifest = null; }
  t.ok(manifest !== null, 'the manifest is valid JSON');
  t.equal(manifest?.scope, '/admin', 'the served manifest scopes to /admin');

  let swCompiles = true;
  try { new Function(ADMIN_SW); } catch (err) { swCompiles = false; }
  t.ok(swCompiles, 'the service worker compiles');
}
