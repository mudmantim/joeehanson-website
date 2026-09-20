/**
 * The private side of the site: /admin and the small API behind it.
 *
 * The dashboard HTML is returned by this function and never exists as a file
 * under public/, so there is nothing to serve if this gate ever fails. The gate
 * is configured with onError "fail" in netlify.toml terms — a crash denies.
 *
 * Nothing here is linked from the public site, listed in sitemap.xml, or
 * reachable from the PWA. Knowing the path grants nothing: every route below
 * requires a signed session cookie.
 */

import type { Config, Context } from '@netlify/edge-functions';
import {
  hmacHex,
  issueToken,
  pbkdf2Hex,
  readCookie,
  setCookie,
  timingSafeEqual,
  verifyToken,
} from '../lib/crypto.ts';
import { analyticsStore, isAdminHost, isProductionRequest, keys, reportDay, storeNameFor } from '../lib/store.ts';
import { ADMIN_MANIFEST, ADMIN_SW } from '../lib/admin-pwa.ts';
import { aggregateDay, chooseSource, combineDays, enumerateDays, resolveRange, ROLLUP_VERSION } from '../lib/rollup.js';
import { renderDashboard, renderLogin } from '../lib/admin-ui.ts';

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days
const OWNER_TTL = 365 * 24 * 60 * 60; // 1 year
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      ...headers,
    },
  });

/**
 * Coarse per-IP login throttle.
 *
 * Blobs is last-write-wins, so under concurrency this undercounts; it raises
 * the cost of guessing rather than enforcing an exact ceiling, which is the
 * honest description of what it does.
 */
async function loginThrottle(production: boolean, ipHash: string): Promise<{ blocked: boolean; record: () => Promise<void> }> {
  const store = analyticsStore(production, { consistency: 'strong' });
  const key = `login/${ipHash}`;
  const now = Math.floor(Date.now() / 1000);
  const state = (await store.get(key, { type: 'json' })) as { n: number; since: number } | null;
  const fresh = !state || now - state.since > LOGIN_WINDOW_SECONDS;
  const n = fresh ? 0 : state!.n;

  return {
    blocked: n >= LOGIN_MAX_ATTEMPTS,
    record: async () => {
      await store.setJSON(key, { n: n + 1, since: fresh ? now : state!.since });
    },
  };
}

async function countPrefix(production: boolean, prefix: string): Promise<number> {
  const { blobs } = await analyticsStore(production, { consistency: 'strong' }).list({ prefix });
  return blobs.length;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const production = isProductionRequest(req);
  const path = url.pathname.replace(/\/+$/, '') || '/admin';

  const secret = Netlify.env.get('JH_SECRET');
  const pwHash = Netlify.env.get('JH_ADMIN_PW_HASH');
  const pwSalt = Netlify.env.get('JH_ADMIN_PW_SALT');

  if (!secret || !pwHash || !pwSalt) {
    return html('<!doctype html><meta charset=utf-8><title>Not configured</title><p>Analytics is not configured.', 503);
  }

  // ---- The app shell, on the dashboard's own hostname only ----------------
  // Installable at admin.joeehanson.com; a 404 at joeehanson.com/admin.
  //
  // That asymmetry is the whole fix. Two apps cannot be nested on one origin:
  // the public app's scope is https://joeehanson.com/ -- the entire origin --
  // so a manifest served under it kept being adopted by the music app, while
  // the dashboard was never offered an install prompt of its own. On a
  // separate origin there is no outer app, so nothing to nest inside.
  //
  // The path stays /admin. Once the origin differs the path is irrelevant to
  // app identity, and keeping it means every redirect, form action and
  // bookmark in this file works unchanged on either hostname.
  const adminHost = isAdminHost(req);

  if (path === '/admin/manifest.webmanifest' || path === '/admin/sw.js') {
    if (!adminHost) {
      // A 404 rather than a removal: a 404 on a worker script is what makes a
      // browser drop a registration it already has. Falling through to the
      // session gate would answer 401 and leave stale registrations in place.
      return new Response('Not here.', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex, nofollow, noarchive',
        },
      });
    }

    // Served before the session gate because Google's WebAPK service fetches
    // both itself, without cookies, when Android mints the app. Neither holds
    // anything private: the manifest is a name and an icon path, the worker is
    // a constant that stores nothing.
    const [body, type, extra] = path === '/admin/manifest.webmanifest'
      ? [ADMIN_MANIFEST, 'application/manifest+json; charset=utf-8', {}]
      : [ADMIN_SW, 'text/javascript; charset=utf-8', { 'service-worker-allowed': '/admin' }];

    return new Response(body, {
      headers: {
        'content-type': type,
        'cache-control': 'no-cache',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        ...extra,
      },
    });
  }

  const session = await verifyToken(secret, 'adm', readCookie(req, 'jh_adm'));
  const ipHash = (await hmacHex(secret, `throttle|${context.ip ?? '0.0.0.0'}`)).slice(0, 24);

  // ---- Login --------------------------------------------------------------
  if (path === '/api/login' && req.method === 'POST') {
    const throttle = await loginThrottle(production, ipHash);
    if (throttle.blocked) {
      return html(renderLogin('Too many attempts. Wait 15 minutes.', adminHost), 429);
    }

    const form = await req.formData();
    const supplied = String(form.get('password') ?? '');
    const derived = await pbkdf2Hex(supplied, pwSalt);

    if (!timingSafeEqual(derived, pwHash)) {
      await throttle.record();
      // One generic message: never distinguishes a wrong password from
      // anything else about this path.
      return html(renderLogin('Incorrect.', adminHost), 401);
    }

    const token = await issueToken(secret, 'adm', SESSION_TTL);
    return new Response(null, {
      status: 303,
      headers: { location: '/admin', 'set-cookie': setCookie('jh_adm', token, SESSION_TTL, 'Strict') },
    });
  }

  // ---- Everything below requires a session --------------------------------
  if (!session.valid) {
    if (path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
    return html(renderLogin(undefined, adminHost), 401);
  }

  if (path === '/api/logout') {
    return new Response(null, {
      status: 303,
      headers: { location: '/admin', 'set-cookie': setCookie('jh_adm', '', 0, 'Strict') },
    });
  }

  // ---- Owner exclusion status --------------------------------------------
  const owner = await verifyToken(secret, 'own', readCookie(req, 'jh_own'));

  if (path === '/api/whoami') {
    return json({
      excluded: owner.valid,
      expiresAt: owner.expiresAt ? new Date(owner.expiresAt * 1000).toISOString() : null,
    });
  }

  // ---- Mark / unmark this browser ----------------------------------------
  if (path === '/api/own' && req.method === 'POST') {
    const form = await req.formData();
    const on = String(form.get('exclude') ?? '') === '1';
    const cookie = on
      ? setCookie('jh_own', await issueToken(secret, 'own', OWNER_TTL), OWNER_TTL)
      : setCookie('jh_own', '', 0);
    return new Response(null, { status: 303, headers: { location: '/admin', 'set-cookie': cookie } });
  }

  // ---- Test event ---------------------------------------------------------
  // Reports how THIS request would be treated by the collector, using the same
  // cookie the collector would see. This is the verification affordance: it
  // does not simulate, it re-runs the real decision.
  if (path === '/api/test-event') {
    return json({
      wouldBeCounted: !owner.valid,
      reason: owner.valid ? 'owner cookie present and valid — event would be excluded' : 'no owner cookie — event would be counted',
    });
  }

  // ---- Maintenance --------------------------------------------------------
  // The nightly jobs are scheduled functions and cannot be invoked by hand in
  // production, which is exactly why a bug in them went unnoticed for a day.
  // This runs the same logic over the same shared code, from a request whose
  // hostname decides the environment, so it can be checked immediately.
  //
  // Destructive work is dry-run unless `confirm=yes` is passed.
  if (path === '/api/maintenance' && req.method === 'POST') {
    const store = analyticsStore(production, { consistency: 'strong' });
    const today = reportDay();
    const job = url.searchParams.get('job');
    const confirmed = url.searchParams.get('confirm') === 'yes';

    // The caller must name the environment it believes it is acting on, and it
    // has to match what the hostname says. A maintenance call that runs against
    // a different store than the operator intended is the whole failure being
    // repaired here, so it is made impossible to do by accident.
    const expect = url.searchParams.get('expect');
    const actual = production ? 'production' : 'preview';
    if (expect !== actual) {
      return json({
        error: 'environment assertion failed',
        detail: `this host resolves to "${actual}"; pass expect=${actual} to proceed`,
        host: url.hostname, store: storeNameFor(production),
      }, 409);
    }

    const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const dayOf = (key: string) => key.split('/')[1] ?? '';
    const ageInDays = (day: string) =>
      Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);

    if (job === 'rollup') {
      const only = url.searchParams.get('day');
      if (only && !DAY_RE.test(only)) return json({ error: 'day must be YYYY-MM-DD' }, 400);

      const days = new Set<string>();
      for (const b of (await store.list({ prefix: 'raw/' })).blobs) {
        const d = dayOf(b.key);
        if (DAY_RE.test(d)) days.add(d);
      }

      const written: string[] = [];
      const skipped: string[] = [];
      for (const day of [...days].sort()) {
        if (only && day !== only) continue;
        // Never roll up a day that is still accumulating.
        if (day >= today) { skipped.push(`${day} (still open)`); continue; }
        const existing = (await store.get(keys.rollup(day), { type: 'json' })) as any;
        if (existing?.v === ROLLUP_VERSION && !confirmed) { skipped.push(`${day} (already at v${ROLLUP_VERSION})`); continue; }

        const records = [];
        for (const b of (await store.list({ prefix: `raw/${day}/` })).blobs) {
          const rec = await store.get(b.key, { type: 'json' });
          if (rec) records.push(rec);
        }
        await store.setJSON(keys.rollup(day), { ...aggregateDay(day, records), generatedAt: new Date().toISOString() });
        written.push(day);
      }
      return json({ job, environment: actual, store: storeNameFor(production), today,
                    rollupVersion: ROLLUP_VERSION, written, skipped });
    }

    if (job === 'prune') {
      const RETENTION: Record<string, number> = { raw: 90, owner: 7, salt: 2 };
      // A cap on how much one call may remove. A date-handling mistake should
      // hit this and stop, not empty the store.
      const MAX_DELETE = 500;

      const plan: Record<string, string[]> = { raw: [], owner: [], salt: [] };
      const retained: Record<string, number> = { raw: 0, owner: 0, salt: 0 };

      for (const prefix of ['raw', 'owner', 'salt'] as const) {
        for (const b of (await store.list({ prefix: `${prefix}/` })).blobs) {
          const day = dayOf(b.key);
          // An unparseable key is left alone rather than guessed at.
          if (!DAY_RE.test(day)) { retained[prefix]++; continue; }
          const age = ageInDays(day);
          // Future-dated or same-day keys are never eligible, whatever the
          // arithmetic says. Today's salt in particular must survive.
          if (!Number.isFinite(age) || age < 1) { retained[prefix]++; continue; }
          if (age >= RETENTION[prefix]) plan[prefix].push(b.key); else retained[prefix]++;
        }
      }

      const total = Object.values(plan).reduce((a, v) => a + v.length, 0);
      const summary = {
        job, environment: actual, store: storeNameFor(production), today,
        retentionDays: RETENTION,
        wouldDelete: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])),
        retained,
        oldestEligible: Object.fromEntries(
          Object.entries(plan).map(([k, v]) => [k, v.map(dayOf).sort()[0] ?? null])),
      };

      if (total > MAX_DELETE) {
        return json({ ...summary, refused: true,
                      reason: `plan of ${total} exceeds the ${MAX_DELETE} safety cap` }, 409);
      }
      if (!confirmed) return json({ ...summary, dryRun: true });

      const deleted: Record<string, number> = { raw: 0, owner: 0, salt: 0 };
      for (const [prefix, list] of Object.entries(plan)) {
        for (const key of list) { await store.delete(key); deleted[prefix]++; }
      }
      return json({ ...summary, dryRun: false, deleted });
    }

    return json({ error: 'unknown job', jobs: ['rollup', 'prune'] }, 400);
  }

  // ---- Stats --------------------------------------------------------------
  if (path === '/api/stats') {
    // Strong consistency: a default (eventual) read can lag by up to a minute,
    // which would make "send an event, see it appear" untestable and would
    // make the dashboard look broken to anyone checking their own visit.
    const store = analyticsStore(production, { consistency: 'strong' });
    const today = reportDay();

    // Which days exist at all, so "all time" has a real starting point rather
    // than an invented one.
    const rawKeys = (await store.list({ prefix: 'raw/' })).blobs;
    const rollupKeys = (await store.list({ prefix: 'rollup/daily/' })).blobs;
    const daysWithData = new Set<string>();
    for (const b of rawKeys) {
      const d = b.key.split('/')[1];
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) daysWithData.add(d);
    }
    for (const b of rollupKeys) {
      const d = b.key.split('/').pop()?.replace('.json', '') ?? '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) daysWithData.add(d);
    }
    const earliest = [...daysWithData].sort()[0];

    const range = resolveRange(
      { range: url.searchParams.get('range') ?? undefined,
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined },
      today,
      earliest,
    );

    const days = enumerateDays(range.from, range.to);
    const perDay = [];
    let fromRollups = 0;
    let computedLive = 0;

    for (const day of days) {
      // A closed day reads its stored aggregate. Today is always recomputed,
      // because it is still accumulating and a stored copy would be stale.
      let rollup = null;
      if (day < today) {
        const stored = (await store.get(keys.rollup(day), { type: 'json' })) as any;
        if (chooseSource(day, today, stored) === 'rollup') { rollup = stored; fromRollups++; }
      }

      if (!rollup) {
        const dayBlobs = (await store.list({ prefix: `raw/${day}/` })).blobs;
        if (dayBlobs.length === 0 && day !== today) {
          perDay.push(aggregateDay(day, []));
          continue;
        }
        const records = [];
        for (const b of dayBlobs) {
          const rec = await store.get(b.key, { type: 'json' });
          if (rec) records.push(rec);
        }
        rollup = aggregateDay(day, records);
        computedLive++;
      }
      perDay.push(rollup);
    }

    const totals = combineDays(perDay);

    return json({
      asOf: new Date().toISOString(),
      today,
      timezone: 'America/New_York',
      range,
      totals,
      byDay: perDay.map((d) => ({
        day: d.day,
        visitors: d.visitors,
        sessions: d.sessions,
        pageviews: d.pageviews,
        avgEngagedMs: d.sessions ? Math.round(d.engagedMsTotal / d.sessions) : 0,
      })),
      devices: totals.devices,
      countries: totals.countries,
      sources: totals.sources,
      campaigns: totals.campaigns,
      basis: totals.basis,
      outboundByService: totals.outboundByService,
      outboundDestinations: totals.outboundDestinations,
      newVsReturning: { new: totals.newSessions, returning: totals.returningSessions },
      dataFrom: { rollups: fromRollups, computedLive, daysInRange: days.length, earliestDay: earliest ?? null },
      ownerExcludedToday: await countPrefix(production, `owner/${today}/`),
      // Surfaced so the environment split is visible rather than assumed.
      env: { production, store: storeNameFor(production), host: url.hostname },
    });
  }

  // ---- Dashboard ----------------------------------------------------------
  return html(renderDashboard({ excluded: owner.valid, expiresAt: owner.expiresAt ?? null, production, adminHost }));
};

export const config: Config = {
  path: ['/admin', '/admin/*', '/api/login', '/api/logout', '/api/whoami', '/api/own', '/api/stats', '/api/test-event', '/api/maintenance'],
  onError: 'fail',
};
