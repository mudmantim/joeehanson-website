/**
 * POST /api/e — the only public write endpoint.
 *
 * Accepts a small batch of events, drops anything from the owner's browser or
 * an obvious bot, and appends the rest under a unique key.
 *
 * What is deliberately never stored: the IP address (HMAC input only, in
 * memory), the full User-Agent string, the full referrer URL, or anything the
 * visitor typed. See docs/ANALYTICS.md.
 */

import type { Config, Context } from '@netlify/edge-functions';
import { hmacHex, readCookie, verifyToken } from '../lib/crypto.ts';
import { analyticsStore, dailySalt, keys, reportDay, reportHour } from '../lib/store.ts';

const MAX_BODY_BYTES = 4096;
const MAX_EVENTS_PER_BATCH = 20;
const EVENT_TYPES = new Set(['pv', 'eng', 'out', 'end']);

/** Small and deliberately incomplete: this is hygiene, not a bot product. */
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|curl|wget|python-requests|monitoring/i;

function noContent(extra: Record<string, string> = {}): Response {
  // 204 for every outcome. A caller cannot learn whether it was counted,
  // dropped as owner traffic, or rejected as malformed.
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...extra } });
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const secret = Netlify.env.get('JH_SECRET');
  if (!secret) return new Response(null, { status: 204 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return noContent();

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return noContent();
  }

  const incoming = Array.isArray(body?.events) ? body.events : [];
  if (incoming.length === 0 || incoming.length > MAX_EVENTS_PER_BATCH) return noContent();

  const now = new Date();
  const day = reportDay(now);
  const ua = req.headers.get('user-agent') ?? '';

  // ---- Owner exclusion ----------------------------------------------------
  // Verified server-side from a signed cookie, so it cannot be forged and the
  // page script has no say in it. Kept as a diagnostic so the dashboard can
  // prove exclusion is working, and pruned after 7 days.
  const owner = await verifyToken(secret, 'own', readCookie(req, 'jh_own'));
  if (owner.valid) {
    const store = analyticsStore();
    await store.setJSON(keys.owner(day, crypto.randomUUID()), {
      at: now.toISOString(),
      count: incoming.length,
      types: incoming.map((e: any) => String(e?.t ?? '')).slice(0, MAX_EVENTS_PER_BATCH),
    });
    return noContent({ 'x-jh': 'owner-excluded' });
  }

  // ---- Cheap non-visitor filtering ---------------------------------------
  const prefetch = req.headers.get('sec-purpose') ?? req.headers.get('purpose') ?? '';
  if (prefetch.includes('prefetch')) return noContent();

  const suspect = BOT_RE.test(ua) || body?.wd === true;

  // ---- Visitor id ---------------------------------------------------------
  // HMAC of (ip, user-agent) under a salt that is random per day and destroyed
  // two days later. The IP is used here and never written anywhere.
  const ip = context.ip ?? '0.0.0.0';
  const vid = (await hmacHex(await dailySalt(day), `${ip}|${ua}`)).slice(0, 16);

  const events = [];
  for (const e of incoming) {
    const t = String(e?.t ?? '');
    if (!EVENT_TYPES.has(t)) continue;
    if (typeof e?.eid !== 'string' || typeof e?.sid !== 'string') continue;

    events.push({
      eid: e.eid.slice(0, 64),
      sid: e.sid.slice(0, 64),
      t,
      ts: Number.isFinite(e?.ts) ? Number(e.ts) : now.getTime(),
      path: typeof e?.path === 'string' ? e.path.slice(0, 200) : '/',
      eng_ms: Number.isFinite(e?.eng_ms) ? Math.max(0, Math.min(Number(e.eng_ms), 86_400_000)) : 0,
      pv: Number.isFinite(e?.pv) ? Math.max(0, Math.min(Number(e.pv), 1000)) : 0,
      test: e?.test === true,
    });
  }
  if (events.length === 0) return noContent();

  // Referrer host only, never the full URL with its query string.
  let refHost: string | null = null;
  if (typeof body?.ref === 'string' && body.ref) {
    try {
      const host = new URL(body.ref).hostname;
      refHost = host === new URL(req.url).hostname ? null : host.slice(0, 120);
    } catch {
      refHost = null;
    }
  }

  const record = {
    v: 1,
    vid,
    at: now.toISOString(),
    day,
    // Coarse families only. The full UA string is never stored.
    dev: /mobile|iphone|android.*mobile/i.test(ua) ? 'mobile' : /ipad|tablet/i.test(ua) ? 'tablet' : 'desktop',
    cc: context.geo?.country?.code ?? null,
    ref_host: refHost,
    new: body?.new === true,
    q: suspect ? 'suspect' : 'ok',
    events,
  };

  const store = analyticsStore();
  await store.setJSON(keys.raw(day, reportHour(now), crypto.randomUUID()), record);

  return noContent();
};

export const config: Config = { path: '/api/e', method: 'POST' };
