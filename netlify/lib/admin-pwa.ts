/**
 * The two files that make /admin installable as its own Android app.
 *
 * Both are served by the admin edge function rather than from public/, so the
 * rule "nothing belonging to the dashboard exists as a file on the public site"
 * still holds. Neither is behind the session gate, and that is deliberate:
 *
 *   Chrome does not mint a WebAPK from the browser alone. It hands the manifest
 *   and the icon URLs to Google's WebAPK service, which fetches them itself,
 *   from its own network, with no cookies. Anything required for installation
 *   that sits behind the session cookie simply fails to install.
 *
 * So the question is not whether these can be gated, but whether leaving them
 * open costs anything. It does not. The manifest is an app name and an icon
 * path. The worker stores nothing and returns nothing it was not given. Every
 * route that returns a number is still behind the gate, and the existing
 * design already assumes knowing the path /admin grants nothing.
 *
 * The icons are ordinary files under public/assets/icons/ for the same reason —
 * the WebAPK service has to be able to fetch them.
 */

/**
 * `id`, `start_url` and `scope` are relative on purpose.
 *
 * `id` is what Android uses to decide whether two manifests describe the same
 * app. The public site's manifest hardcodes `https://joeehanson.com/`; if this
 * one resolved to the same value the installed admin app would replace the
 * public one rather than sit beside it. Relative values resolve against
 * whatever origin served them, so a deploy preview describes the preview and
 * production describes production, instead of a preview manifest claiming a
 * cross-origin id and being rejected outright.
 *
 * `scope` is `/admin` without a trailing slash so that a bare /admin — which is
 * what every redirect and every bookmark points at — is inside it. With
 * `/admin/` the app's own sign-in redirect would land out of scope and Android
 * would kick it out into a browser tab.
 */
export const ADMIN_MANIFEST = JSON.stringify(
  {
    name: 'Measurement — Joe E. Hanson',
    short_name: 'Measurement',
    description: 'Private analytics for joeehanson.com.',
    id: '/admin',
    start_url: '/admin',
    scope: '/admin',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait-primary',
    background_color: '#080807',
    theme_color: '#0f0f0e',
    icons: [
      { src: '/assets/icons/admin-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/icons/admin-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/assets/icons/admin-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  null,
  2,
);

/**
 * The admin service worker.
 *
 * It exists because Android will not produce a separate installed app without
 * one — not because the dashboard wants an offline mode. It therefore never
 * touches the Cache Storage API at all. There is no cache name, no precache
 * list, no put, no match. That is not a policy written in a comment and
 * enforced by hope; the string below contains no reference to `caches`, and
 * tests/admin-pwa.test.mjs fails if one ever appears.
 *
 * What it does do is answer a failed *navigation* with a plain page. In the
 * installed app there is no address bar and no reload button, so launching it
 * with no signal would otherwise show Chrome's network-error page inside a
 * window with no obvious way out. That response is generated here and read from
 * nowhere, so it reveals nothing and goes stale never.
 *
 * Everything else — every /api/ call, every asset — is left entirely alone and
 * goes to the network untouched.
 */
export const ADMIN_SW = `/* joeehanson.com /admin — installable shell. Stores nothing. */
'use strict';

var OFFLINE = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline</title><style>' +
  'body{background:#080807;color:#d5caa8;font-family:Georgia,serif;line-height:1.6;' +
  'margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;' +
  'padding:2rem;max-width:22rem;margin:0 auto;text-align:center}' +
  'h1{font-weight:300;font-size:1.5rem;margin:0 0 .4rem}' +
  'p{color:#9a8d6e;font-size:.9rem;margin:0 0 1.5rem}' +
  'button{background:transparent;border:1px solid #c87941;color:#c87941;font:inherit;' +
  'font-size:.95rem;padding:.6rem 1.4rem;letter-spacing:.1em;cursor:pointer}' +
  '</style></head><body><h1>No connection</h1>' +
  '<p>Measurement reads live data and keeps nothing on this device, so there is ' +
  'nothing to show until you are back online.</p>' +
  '<button onclick="location.reload()">Try again</button></body></html>';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Only page loads are handled here. API responses, and anything else this
  // app asks for, go straight to the network and are never inspected, copied
  // or stored.
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(function () {
      return new Response(OFFLINE, {
        status: 503,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    })
  );
});
`;
