/**
 * /admin is a page, not an app, and must not drift back into being one.
 *
 * It was installable for about a day. That was a mistake, and the way it
 * failed is worth writing down, because the fix looks like a removal and
 * removals get undone by people who think they are restoring a feature.
 *
 * The public music site's app claims the scope `https://joeehanson.com/` --
 * the entire origin. /admin is inside it. Chrome keeps an installed app in
 * sync with whatever manifest it finds within that app's scope, so serving a
 * second manifest at /admin meant the music app kept adopting it and rewriting
 * its own start URL to the private dashboard. It did this twice on a real
 * phone, the second time after we thought it was understood.
 *
 * Meanwhile the dashboard itself never installed at all: Chrome does not offer
 * an install prompt for an inner app when the outer one is already installed,
 * which is also why a beforeinstallprompt seen on a preview origin -- where no
 * outer app exists -- proved nothing about production.
 *
 * So: nothing at this address advertises itself as installable. The dashboard
 * moves to its own origin, where nesting is impossible.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

const adminSrc = read('netlify/edge-functions/admin.ts');
const uiSrc = read('netlify/lib/admin-ui.ts');
const swSrc = read('public/sw.js');

/**
 * admin-ui.ts explains at length what it deliberately does NOT call --
 * caches.delete, localStorage, and so on. Matching that prose instead of the
 * code is how a test comes to assert the opposite of what it claims. Block
 * comments are stripped; line comments are left alone because the file is full
 * of https:// inside string literals.
 */
const uiCode = uiSrc.replace(/\/\*[\s\S]*?\*\//g, '');

export default function run(t) {
  // ---- The apex dashboard advertises no app ------------------------------
  t.ok(!/rel="manifest"/.test(uiSrc), '/admin links no web app manifest');
  t.ok(!/serviceWorker\.register\(/.test(uiSrc), '/admin registers no service worker');
  t.ok(!/apple-mobile-web-app-capable/.test(uiSrc),
       '/admin does not ask iOS to treat it as standalone either');

  // ---- Both shell routes are gone, and gone in the way that works --------
  const shellRoute = adminSrc.indexOf("path === '/admin/manifest.webmanifest'");
  const gate = adminSrc.indexOf('if (!session.valid)');
  t.ok(shellRoute > 0, 'the shell paths are still handled explicitly');
  t.ok(/'\/admin\/manifest\.webmanifest' \|\| path === '\/admin\/sw\.js'/.test(adminSrc),
       'the manifest and the worker are handled together');
  t.ok(/status: 404/.test(adminSrc.slice(shellRoute, shellRoute + 400)), 'they answer 404');
  // A 404 is what makes a browser drop a worker it already registered. Falling
  // through to the gate would answer 401 and every stale registration would
  // survive.
  t.ok(shellRoute < gate, 'they answer before the session gate, so they cannot become 401s');
  t.ok(!/ADMIN_MANIFEST|ADMIN_SW/.test(adminSrc), 'the apex function serves neither constant');

  // ---- The removal must not take anything else with it -------------------
  t.ok(/getRegistrations\(\)/.test(uiSrc), '/admin cleans up the worker it used to register');
  t.ok(/scope === '\/admin' \|\| scope\.indexOf\('\/admin\/'\) === 0/.test(uiSrc),
       'it unregisters ONLY /admin-scoped workers');
  // Cache Storage is per-origin, not per-worker: clearing it here would delete
  // the music site's precache.
  t.ok(!/caches\.delete|caches\.open|caches\.keys/.test(uiCode),
       '/admin touches no cache, so nothing of the public site can be destroyed');
  t.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(uiCode),
       '/admin clears no storage and no cookies');

  // ---- The public app is untouched by any of this ------------------------
  const pub = JSON.parse(read('public/manifest.json'));
  t.equal(pub.id, 'https://joeehanson.com/', 'the public app still identifies as the site root');
  t.equal(pub.start_url, 'https://joeehanson.com/', 'the public start_url is unchanged');
  t.equal(pub.scope, 'https://joeehanson.com/', 'the public scope is unchanged');
  t.ok(!/admin/.test(read('public/manifest.json')), 'the public manifest mentions no admin route');
  t.ok(!/admin/.test(read('public/index.html')), 'the public page links nothing admin');

  const pubCode = swSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  t.ok(/startsWith\('\/admin'\)/.test(pubCode), 'the public worker still bypasses /admin');
  t.ok(/startsWith\('\/api\/'\)/.test(pubCode), 'the public worker still bypasses /api/');
  t.ok(!/\/admin/.test(swSrc.match(/const PRECACHE = \[[\s\S]*?\];/)[0]),
       'nothing admin is in the public precache list');

  // ---- The dashboard still works as a page -------------------------------
  t.ok(/renderDashboard/.test(adminSrc) && /renderLogin/.test(adminSrc),
       'the dashboard and sign-in page are still served');
  t.ok(!existsSync(join(root, 'public/admin')), 'there is still no public/admin directory');
}

/** Opening the dashboard must still not put a visit into the dashboard. */
export function openingItRecordsNothing(t) {
  t.ok(!/<script[^>]+src=/.test(uiSrc), 'the dashboard loads no external script');
  t.ok(!/src=["'][^"']*script\.js/.test(uiSrc), 'it never loads the public collector');
  t.ok(!/sendBeacon/.test(uiSrc), 'the dashboard sends no beacons');
  t.ok(!/addEventListener\(\s*['"]pagehide['"]/.test(uiSrc), 'no pagehide flush');
  t.ok(!/jh_fs/.test(uiSrc), 'no first-seen stamp');

  const posts = uiSrc.match(/fetch\('\/api\/e'[\s\S]*?\}\)\}\);/g) ?? [];
  t.equal(posts.length, 1, 'it posts to the collector once, from the test button');
  t.ok(posts[0]?.includes('test:true'), 'and that post is marked as a test');
}

/** The phone layout is unaffected by any of this and must stay so. */
export function phoneLayout(t) {
  const shell = uiSrc.match(/const SHELL = `([\s\S]*?)`;/)[1];
  const cellRule = shell.match(/\n\s*th,td\{([^}]*)\}/)?.[1] ?? '';
  const [, horiz] = cellRule.match(/padding:\s*[.\d]+rem\s+([.\d]+)rem/) ?? [];
  t.ok(Number(horiz) > 0, 'table cells still have horizontal padding');
  t.ok(/@media \(max-width:560px\)/.test(shell), 'the narrow breakpoint survives');
  t.ok(/content:attr\(data-l\)/.test(shell), 'figures still print their own labels');
  t.ok(/'<td data-l="'\+esc\(labels\[i\]\)\+'">'/.test(uiSrc), 'cells still carry those labels');
}

/** Session expiry still lands on a usable sign-in screen. */
export function sessionExpiry(t) {
  t.ok(/res\.status === 401/.test(uiSrc), 'an expired session is recognised');
  t.ok(/function signedOut\(\)/.test(uiSrc), 'handled in one place');
  t.ok(/location\.assign\('\/admin'\)/.test(uiSrc), 'it goes to the sign-in screen');
  t.ok(/Your session has expired/.test(uiSrc), 'and says so');
  const rawReads = uiSrc.match(/fetch\('\/api\/(stats|test-event|whoami)[^)]*\)/g) ?? [];
  t.equal(rawReads.length, 0, 'no authenticated read bypasses the 401 check');
}

/**
 * Render both pages and compile what they embed. Source-level regexes cannot
 * see a page that is not a program: a stray backtick inside a comment closed
 * the dashboard's template literal early once, and every grep still passed.
 */
export async function renderedOutput(t) {
  const { renderDashboard, renderLogin } = await import('../netlify/lib/admin-ui.ts');

  const pages = {
    'sign-in': renderLogin('Incorrect.'),
    dashboard: renderDashboard({ excluded: true, expiresAt: 1789000000, production: true }),
  };

  for (const [name, out] of Object.entries(pages)) {
    t.ok(out.startsWith('<!doctype html>'), `${name} is a whole document`);
    t.ok(out.trimEnd().endsWith('</html>'), `${name} is not truncated`);
    t.ok(!out.includes('`'), `${name} contains no stray backtick`);
    t.ok(!out.includes('${'), `${name} left nothing uninterpolated`);
    t.equal((out.match(/<script/g) ?? []).length, (out.match(/<\/script>/g) ?? []).length,
            `${name} balances its script tags`);

    // The point of this change, asserted against the bytes a browser receives.
    t.ok(!out.includes('rel="manifest"'), `${name} serves no manifest link`);
    t.ok(!out.includes('serviceWorker.register'), `${name} registers no worker`);
    t.ok(out.includes('getRegistrations'), `${name} cleans up the old worker`);
    t.ok(out.includes('noindex'), `${name} still asks not to be indexed`);

    for (const [i, js] of [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).entries()) {
      let ok = true;
      try { new Function(js); } catch { ok = false; }
      t.ok(ok, `${name} script #${i + 1} compiles`);
    }
  }
}
