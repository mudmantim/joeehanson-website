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
import { analyticsStore, isProductionRequest, reportDay, storeNameFor } from '../lib/store.ts';
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

  const session = await verifyToken(secret, 'adm', readCookie(req, 'jh_adm'));
  const ipHash = (await hmacHex(secret, `throttle|${context.ip ?? '0.0.0.0'}`)).slice(0, 24);

  // ---- Login --------------------------------------------------------------
  if (path === '/api/login' && req.method === 'POST') {
    const throttle = await loginThrottle(production, ipHash);
    if (throttle.blocked) {
      return html(renderLogin('Too many attempts. Wait 15 minutes.'), 429);
    }

    const form = await req.formData();
    const supplied = String(form.get('password') ?? '');
    const derived = await pbkdf2Hex(supplied, pwSalt);

    if (!timingSafeEqual(derived, pwHash)) {
      await throttle.record();
      // One generic message: never distinguishes a wrong password from
      // anything else about this path.
      return html(renderLogin('Incorrect.'), 401);
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
    return html(renderLogin(), 401);
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

  // ---- Stats --------------------------------------------------------------
  if (path === '/api/stats') {
    // Strong consistency: a default (eventual) read can lag by up to a minute,
    // which would make "send an event, see it appear" untestable and would
    // make the dashboard look broken to anyone checking their own visit.
    const store = analyticsStore(production, { consistency: 'strong' });
    const today = reportDay();

    const { blobs } = await store.list({ prefix: 'raw/' });
    const days = new Map<string, number>();
    const sessions = new Set<string>();
    const visitors = new Set<string>();
    const engagedSessions = new Set<string>();
    const seenEventIds = new Set<string>();
    // Request-local: an edge isolate is reused across requests, so any of this
    // held at module scope would accumulate between invocations.
    const sessionEngagement = new Map<string, number>();
    let pageviews = 0;
    let engagedMs = 0;
    let suspect = 0;

    for (const b of blobs) {
      const rec = (await store.get(b.key, { type: 'json' })) as any;
      if (!rec) continue;
      days.set(rec.day, (days.get(rec.day) ?? 0) + 1);
      if (rec.q === 'suspect') suspect++;
      visitors.add(`${rec.day}|${rec.vid}`);

      for (const e of rec.events ?? []) {
        // Duplicate event ids are counted once, no matter how many times a
        // retried beacon delivered them.
        if (seenEventIds.has(e.eid)) continue;
        seenEventIds.add(e.eid);

        sessions.add(e.sid);
        if (e.t === 'pv') pageviews++;
        if (e.t === 'end' || e.t === 'eng') {
          // eng_ms is cumulative per session; keep the largest seen.
          const prev = sessionEngagement.get(e.sid) ?? 0;
          if (e.eng_ms > prev) sessionEngagement.set(e.sid, e.eng_ms);
        }
      }
    }

    for (const [sid, ms] of sessionEngagement) {
      engagedMs += ms;
      if (ms >= 10_000) engagedSessions.add(sid);
    }

    return json({
      asOf: new Date().toISOString(),
      today,
      totals: {
        visitorDays: visitors.size,
        sessions: sessions.size,
        pageviews,
        uniqueEvents: seenEventIds.size,
        rawBlobs: blobs.length,
        suspectBatches: suspect,
        avgEngagedMs: sessions.size ? Math.round(engagedMs / sessions.size) : 0,
        engagementRate: sessions.size ? engagedSessions.size / sessions.size : 0,
      },
      byDay: [...days.entries()].sort().map(([day, batches]) => ({ day, batches })),
      ownerExcludedToday: await countPrefix(production, `owner/${today}/`),
      // Surfaced so the environment split is visible rather than assumed.
      env: { production, store: storeNameFor(production), host: url.hostname },
    });
  }

  // ---- Dashboard ----------------------------------------------------------
  return html(renderDashboard({ excluded: owner.valid, expiresAt: owner.expiresAt ?? null, production }));
};

export const config: Config = {
  path: ['/admin', '/admin/*', '/api/login', '/api/logout', '/api/whoami', '/api/own', '/api/stats', '/api/test-event'],
  onError: 'fail',
};
