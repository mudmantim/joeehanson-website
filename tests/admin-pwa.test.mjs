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
  // Whether the page advertises an app now depends on the hostname, so the
  // real assertions live in renderedOutput() below, which builds both pages
  // for both hosts. Here we only check the decision exists and is made once.
  t.ok(/const pwaHead = \(adminHost/.test(uiSrc), 'the head is chosen by host');
  t.ok(/const pwaScript = \(adminHost/.test(uiSrc), 'the worker script is chosen by host');

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
  t.ok(/if \(!adminHost\) \{/.test(adminSrc), 'the 404 is conditional on the hostname');
  t.ok(/const adminHost = isAdminHost\(req\);/.test(adminSrc),
       'the host decision comes from store.ts, where it is tested by name');
  const hostDecision = adminSrc.indexOf('const adminHost = isAdminHost(req)');
  t.ok(hostDecision > 0 && hostDecision < shellRoute,
       'the host is decided before the shell routes use it');

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

  const view = (adminHost) => ({
    production: true,
    adminHost,
    publicOrigin: adminHost ? 'https://joeehanson.com' : 'https://joeehanson.com',
    returnTo: adminHost ? 'https://admin.joeehanson.com/admin' : 'https://joeehanson.com/admin',
    badgeToken: 'badge.token.value',
    setToken: 'set.token.value',
    nonce: 'nonce-0001',
  });
  const build = (adminHost) => ({
    'sign-in': renderLogin('Incorrect.', adminHost),
    dashboard: renderDashboard(view(adminHost)),
  });

  for (const [hostLabel, adminHost] of [['apex joeehanson.com', false], ['admin.joeehanson.com', true]]) {
    for (const [name, out] of Object.entries(build(adminHost))) {
      const where = `${name} @ ${hostLabel}`;

      t.ok(out.startsWith('<!doctype html>'), `${where} is a whole document`);
      t.ok(out.trimEnd().endsWith('</html>'), `${where} is not truncated`);
      t.ok(!out.includes('`'), `${where} contains no stray backtick`);
      t.ok(!out.includes('${'), `${where} left nothing uninterpolated`);
      t.equal((out.match(/<script/g) ?? []).length, (out.match(/<\/script>/g) ?? []).length,
              `${where} balances its script tags`);
      t.ok(out.includes('noindex'), `${where} still asks not to be indexed`);

      if (adminHost) {
        // Its own origin, no outer app, so it may install.
        t.ok(out.includes('<link rel="manifest" href="/admin/manifest.webmanifest">'),
             `${where} links the manifest`);
        t.ok(out.includes("navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin' })"),
             `${where} registers the worker at the widened scope`);
        t.ok(!out.includes('getRegistrations'), `${where} does not also unregister it`);
      } else {
        // Inside the public app's scope. Advertising an app here is what kept
        // rewriting the music app's start URL.
        t.ok(!out.includes('rel="manifest"'), `${where} links NO manifest`);
        t.ok(!out.includes('serviceWorker.register'), `${where} registers NO worker`);
        t.ok(!out.includes('apple-mobile-web-app-capable'), `${where} asks iOS for nothing either`);
        t.ok(out.includes('getRegistrations'), `${where} cleans up the old worker`);
        t.ok(out.includes("scope === '/admin' || scope.indexOf('/admin/') === 0"),
             `${where} unregisters ONLY /admin-scoped workers`);
      }

      for (const [i, js] of [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).entries()) {
        let ok = true;
        try { new Function(js); } catch { ok = false; }
        t.ok(ok, `${where} script #${i + 1} compiles`);
      }
    }
  }

  // The two hosts must actually differ, or the branch is dead code.
  const apex = build(false).dashboard, admin = build(true).dashboard;
  t.ok(apex !== admin, 'the two hosts render different documents');
}

/**
 * The installable identity, on the origin it will actually be served from.
 */
export async function appIdentity(t) {
  const { ADMIN_MANIFEST, ADMIN_SW } = await import('../netlify/lib/admin-pwa.ts');
  const m = JSON.parse(ADMIN_MANIFEST);
  const pub = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'));

  // Relative, so the same bytes describe the real subdomain and the branch
  // deploy it is tested on, instead of claiming a cross-origin id on either.
  for (const f of ['id', 'start_url', 'scope']) {
    t.ok(!/^https?:/.test(m[f]), `manifest ${f} is relative`);
  }

  // The identity that decides "one app or two" is the id resolved against the
  // origin that served it. On the subdomain these can no longer collide,
  // whatever the paths are.
  const onAdmin = new URL(m.id, 'https://admin.joeehanson.com');
  const onApex = new URL(pub.id, 'https://joeehanson.com');
  t.equal(onAdmin.href, 'https://admin.joeehanson.com/admin', 'the app identifies on its own origin');
  t.equal(onApex.href, 'https://joeehanson.com/', 'the public app is unchanged');
  t.ok(onAdmin.origin !== onApex.origin, 'different origins: nesting is impossible');
  t.ok(m.name !== pub.name, 'and they have different names');

  // The worker still stores nothing.
  const code = ADMIN_SW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  t.ok(!/\bcaches\b/.test(code), 'the admin worker never reaches Cache Storage');
  t.ok(!/localStorage|sessionStorage|indexedDB/.test(code), 'nor any other persistent storage');
  let ok = true; try { new Function(ADMIN_SW); } catch { ok = false; }
  t.ok(ok, 'the worker compiles');
}

/**
 * Owner exclusion, once the dashboard lives on another origin.
 *
 * jh_own is host-only on joeehanson.com and must stay exactly that. The
 * dashboard cannot read it -- HttpOnly rules out script, and a credentialed
 * cross-origin fetch was ruled out deliberately. So the origin that holds the
 * cookie draws the status itself and the page displays the result.
 *
 * The obvious way for that to go wrong is caching: a status image that depends
 * on one browser's cookie, held by any cache in between, shows one person
 * another person's exclusion state.
 */
export async function ownerExclusion(t) {
  const { renderDashboard } = await import('../netlify/lib/admin-ui.ts');
  const src = adminSrc;

  // ---- The cookie is untouched -------------------------------------------
  // Strip block comments, then line comments -- but NOT the "//" inside a URL
  // literal, which is how the previous version of this test quietly decided
  // that `const ADMIN_ORIGIN = 'https://admin.joeehanson.com'` was absent.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  t.ok(/setCookie\('jh_own', await issueToken\(secret, 'own', OWNER_TTL\), OWNER_TTL\)/.test(code),
       'the owner cookie is still issued exactly as before');
  t.ok(!/Domain=/.test(code), 'no Domain attribute is introduced anywhere');
  t.ok(!/jh_own_/.test(code), 'no second, readable mirror cookie exists');
  t.ok(!/Access-Control-Allow-Credentials/i.test(code), 'no credentialed CORS endpoint was added');
  t.ok(!/Access-Control-Allow-Origin/i.test(code), 'no CORS headers at all');

  // ---- The badge cannot be cached into showing someone else's status -----
  // Slice from the SVG response, not from the route: the token-rejection
  // branch above it also ends in "});" and an earlier version of this test
  // measured that instead, reading the 403's headers and passing anyway.
  const badge = code.slice(code.indexOf("path === '/api/owner-badge.svg'"));
  const headers = badge.slice(badge.indexOf('return new Response(svg'),
                              badge.indexOf('return new Response(svg') + 900);
  t.ok(/'cache-control': 'no-store, no-cache, must-revalidate, private, max-age=0'/.test(headers),
       'the badge is no-store and private');
  t.ok(/'vary': 'Cookie'/.test(headers), 'and varies on Cookie');
  t.ok(/'content-type': 'image\/svg\+xml/.test(headers), 'and is served as an image');

  // A fresh nonce per render, so even a cache that ignored the headers could
  // not key-collide two browsers onto one entry.
  const a = renderDashboard({ production: true, adminHost: true, publicOrigin: 'https://joeehanson.com',
    returnTo: 'https://admin.joeehanson.com/admin', badgeToken: 'b', setToken: 's', nonce: 'n1' });
  const b = renderDashboard({ production: true, adminHost: true, publicOrigin: 'https://joeehanson.com',
    returnTo: 'https://admin.joeehanson.com/admin', badgeToken: 'b', setToken: 's', nonce: 'n2' });
  t.ok(a.includes('n=n1') && b.includes('n=n2'), 'the badge URL carries a per-render nonce');
  t.ok(a !== b, 'two renders produce two badge URLs');
  t.ok(/nonce: crypto\.randomUUID\(\)/.test(src), 'and that nonce is random per request');

  // The public worker must never precache it either.
  const pubCode = swSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  t.ok(/startsWith\('\/api\/'\)/.test(pubCode), 'the public worker still bypasses /api/, badge included');

  // ---- Authorisation ------------------------------------------------------
  t.ok(/verifyToken\(secret, 'own-badge'/.test(code), 'the badge requires a signed token');
  t.ok(/verifyToken\(secret, 'own-set'/.test(code), 'setting exclusion requires a signed token');
  t.ok(/'own-badge'/.test(code) && /'own-set'/.test(code) && /'own'/.test(code),
       'badge, set and cookie tokens have three distinct purposes');
  t.ok(/if \(!session\.valid && !viaToken\)/.test(code),
       'the bounce accepts a session OR a token, never neither');

  const badgeRoute = code.indexOf("path === '/api/owner-badge.svg'");
  const ownRoute = code.indexOf("path === '/api/own'");
  const gate = code.indexOf('if (!session.valid)');
  t.ok(badgeRoute > 0 && badgeRoute < gate, 'the badge answers before the session gate');
  t.ok(ownRoute > 0 && ownRoute < gate, 'the bounce answers before the session gate');

  // ---- The bounce is not an open redirect --------------------------------
  t.ok(/u\.origin === ADMIN_ORIGIN \|\| u\.origin === adminOriginFor\(req\)/.test(code),
       'the return URL is checked against an origin allowlist');
  t.ok(/const ADMIN_ORIGIN = 'https:\/\/admin\.joeehanson\.com'/.test(code),
       'that allowlist is a pinned literal');
  t.ok(/let back = '\/admin';/.test(code), 'anything else falls back to this host');

  // ---- The badge and the collector must agree, by construction -----------
  // If the badge says EXCLUDED, the collector must exclude. The only way to
  // guarantee that without a live authenticated request is for both to read
  // the same cookie through the same verification, so assert exactly that.
  const collectSrc = readFileSync(join(root, 'netlify/edge-functions/collect.ts'), 'utf8');
  const CHECK = "verifyToken(secret, 'own', readCookie(req, 'jh_own'))";
  t.ok(collectSrc.includes(CHECK), 'the collector decides exclusion with this exact call');
  t.ok(src.includes(CHECK), 'and the badge decides status with the identical call');
  t.ok(/'x-jh': 'owner-excluded'/.test(collectSrc),
       'the collector still announces exclusion in a header we can verify from outside');
  // Neither may drift onto a different cookie name.
  t.equal((collectSrc.match(/jh_own/g) ?? []).length, 1, 'the collector reads one cookie name');
  t.ok(!/jh_own[a-z_]/.test(collectSrc + src), 'and no variant name exists anywhere');

  // ---- The badge itself ---------------------------------------------------
  const { ownerBadge } = await import('../netlify/lib/admin-ui.ts');
  const excluded = ownerBadge('#7fa86a', 'EXCLUDED \u2713', 'expires 2027-09-19');
  const counted = ownerBadge('#c87941', 'NOT EXCLUDED', 'visits from this browser are being counted');

  for (const [n, svg] of [['excluded', excluded], ['not excluded', counted]]) {
    t.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), `${n} badge is an SVG document`);
    t.ok(svg.trimEnd().endsWith('</svg>'), `${n} badge is closed`);
    t.ok(/role="img" aria-label="/.test(svg), `${n} badge is labelled for screen readers`);
    t.ok(!/<script|href=|xlink:|<image/.test(svg), `${n} badge references nothing external`);
  }
  t.ok(excluded.includes('expires 2027-09-19'), 'the excluded badge states the expiry');
  t.ok(counted.includes('being counted'), 'the other says visits are being counted');
  t.ok(excluded !== counted, 'the two states render differently');

  // The label and the note must flow, not be positioned by arithmetic. Placing
  // the note at x = label.length * 8.6 printed "expires 2027-09-19" on top of
  // "EXCLUDED": glyph widths are not a function of character count in a
  // proportional serif.
  t.ok(/<tspan[^>]*>[\s\S]*<tspan[^>]*dx=/.test(excluded),
       'the note follows the label with dx, not a computed x');
  t.ok(!/x="\$\{[^}]*length/.test(readFileSync(join(root, 'netlify/lib/admin-ui.ts'), 'utf8')),
       'no text position is derived from string length');

  // Escaping, since the expiry is interpolated.
  const nasty = ownerBadge('#000', 'A<B&C', '"><script>alert(1)</script>');
  t.ok(!nasty.includes('<script>'), 'badge content is escaped');
  t.ok(nasty.includes('&lt;') && nasty.includes('&amp;'), 'and escaped as XML entities');

  // ---- One claim about exclusion, not two --------------------------------
  t.ok(!/This browser:<\/strong> \$\{status\}/.test(readFileSync(join(root, 'netlify/lib/admin-ui.ts'), 'utf8')),
       'the server no longer renders a second, separate status line');
  t.ok(a.includes('/api/owner-badge.svg'), 'the badge is the only status shown');
  t.ok(a.includes('Exclude this browser') && a.includes('Stop excluding'),
       'both actions are offered, since the page cannot read which one applies');
}
