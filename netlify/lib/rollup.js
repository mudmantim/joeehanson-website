/**
 * Aggregation. Pure functions, no I/O, no platform APIs.
 *
 * Plain ESM on purpose: the Deno edge runtime and the Node test runner both
 * import this same file, so the logic the dashboard runs is the logic the tests
 * check. There is no second copy and no build step.
 *
 * Every number the dashboard shows is produced here, which is why this is the
 * file with the tests.
 */

/** @typedef {{vid:string, day:string, dev:string, cc:string|null, new:boolean, q:string, events:Array<object>}} RawRecord */

import { sourceKey, campaignKey, STREAMING_SERVICES } from './attribution.js';

// Bumped for Phase 3: rollups written before attribution existed lack the
// sources/campaigns/outbound breakdowns, so they are recomputed rather than
// shown with silently empty tables.
export const ROLLUP_VERSION = 2;

/** A session counts as engaged at or above this. Matches GA4's definition. */
export const ENGAGED_MS = 10_000;

const emptyDevices = () => ({ mobile: 0, tablet: 0, desktop: 0 });

/**
 * Compact one day's raw records into a single aggregate.
 *
 * Deduplicates by event id, so a beacon that was retried and delivered twice
 * contributes once. Engagement is the largest cumulative value seen for a
 * session, never a sum: heartbeats each report the running total, and adding
 * them would multiply a visitor's time by the number of heartbeats they sent.
 */
export function aggregateDay(day, records) {
  const visitors = new Set();
  const seenEvents = new Set();
  /** @type {Map<string, {engagedMs:number, pageviews:number, isNew:boolean|null, attr:object|null, outbound:number, streaming:number}>} */
  const sessions = new Map();
  const outboundByService = {};
  const outboundDestinations = {};
  const devices = emptyDevices();
  const countries = {};

  let pageviews = 0;
  let suspectBatches = 0;
  let rawBatches = 0;

  for (const rec of records) {
    if (!rec || rec.day !== day) continue;
    rawBatches++;
    if (rec.q === 'suspect') suspectBatches++;
    if (rec.vid) visitors.add(rec.vid);
    if (rec.dev && rec.dev in devices) devices[rec.dev]++;
    if (rec.cc) countries[rec.cc] = (countries[rec.cc] ?? 0) + 1;

    for (const e of rec.events ?? []) {
      if (!e || typeof e.eid !== 'string') continue;
      if (seenEvents.has(e.eid)) continue;
      seenEvents.add(e.eid);

      let s = sessions.get(e.sid);
      if (!s) {
        s = { engagedMs: 0, pageviews: 0, isNew: null, attr: null, outbound: 0, streaming: 0 };
        sessions.set(e.sid, s);
      }
      // Attribution belongs to the session, fixed by the batch that opened it,
      // so a later outbound click is still credited to the post that brought
      // the visitor in.
      if (s.attr === null && rec.attr) s.attr = rec.attr;
      // The first record seen for a session decides new-vs-returning; later
      // batches in the same session carry the same flag.
      if (s.isNew === null) s.isNew = rec.new === true;

      if (e.t === 'pv') { pageviews++; s.pageviews++; }

      if (e.t === 'out' && e.out) {
        s.outbound++;
        const svc = e.out.service ?? 'other';
        outboundByService[svc] = (outboundByService[svc] ?? 0) + 1;
        if (e.out.kind === 'streaming') {
          s.streaming++;
          const dest = `${svc}|${e.out.path ?? ''}`;
          outboundDestinations[dest] = (outboundDestinations[dest] ?? 0) + 1;
        }
      }

      const ms = Number(e.eng_ms);
      if (Number.isFinite(ms) && ms > s.engagedMs) s.engagedMs = ms;
    }
  }

  let engagedSessions = 0;
  let engagedMsTotal = 0;
  let newSessions = 0;
  let returningSessions = 0;
  let outboundClicks = 0;
  let streamingClicks = 0;
  let sessionsWithStreaming = 0;
  const sources = {};
  const campaigns = {};
  const basis = {};

  const bucket = (into, key) => (into[key] ??= { sessions: 0, engagedMs: 0, pageviews: 0, outbound: 0, streaming: 0, intentSessions: 0 });

  for (const s of sessions.values()) {
    engagedMsTotal += s.engagedMs;
    if (s.engagedMs >= ENGAGED_MS || s.pageviews >= 2 || s.outbound >= 1) engagedSessions++;
    if (s.isNew) newSessions++; else returningSessions++;
    outboundClicks += s.outbound;
    streamingClicks += s.streaming;
    if (s.streaming > 0) sessionsWithStreaming++;

    const a = s.attr ?? null;
    if (a?.basis) basis[a.basis] = (basis[a.basis] ?? 0) + 1;

    for (const [into, key] of [[sources, sourceKey(a)], [campaigns, campaignKey(a)]]) {
      const b = bucket(into, key);
      b.sessions++;
      b.engagedMs += s.engagedMs;
      b.pageviews += s.pageviews;
      b.outbound += s.outbound;
      b.streaming += s.streaming;
      if (s.streaming > 0) b.intentSessions++;
    }
  }

  return {
    v: ROLLUP_VERSION,
    day,
    visitors: visitors.size,
    sessions: sessions.size,
    pageviews,
    engagedSessions,
    engagedMsTotal,
    newSessions,
    returningSessions,
    devices,
    countries,
    suspectBatches,
    rawBatches,
    uniqueEvents: seenEvents.size,
    outboundClicks,
    streamingClicks,
    sessionsWithStreaming,
    sources,
    campaigns,
    basis,
    outboundByService,
    outboundDestinations,
  };
}

/** Merge two `{key: {sessions, engagedMs, ...}}` tables. */
function mergeBuckets(into, from) {
  for (const [k, v] of Object.entries(from ?? {})) {
    const b = (into[k] ??= { sessions: 0, engagedMs: 0, pageviews: 0, outbound: 0, streaming: 0, intentSessions: 0 });
    for (const f of ['sessions', 'engagedMs', 'pageviews', 'outbound', 'streaming', 'intentSessions']) {
      b[f] += v?.[f] ?? 0;
    }
  }
}

function mergeCounts(into, from) {
  for (const [k, n] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + n;
}

/**
 * Sum a set of daily rollups into range totals.
 *
 * `visitors` is the sum of daily uniques and therefore **overcounts anyone who
 * visited on more than one day**. That is not a bug to be fixed here: the
 * visitor hash is salted per day and the salt is destroyed, so cross-day
 * identity is cryptographically unavailable by design. The dashboard labels
 * this number accordingly, and `sessions` is the figure that is accurate
 * across any range.
 */
export function combineDays(rollups) {
  const devices = emptyDevices();
  const countries = {};
  let visitorDaysSummed = 0;
  let sessions = 0;
  let pageviews = 0;
  let engagedSessions = 0;
  let engagedMsTotal = 0;
  let newSessions = 0;
  let returningSessions = 0;
  let suspectBatches = 0;
  let rawBatches = 0;
  let uniqueEvents = 0;
  let outboundClicks = 0;
  let streamingClicks = 0;
  let sessionsWithStreaming = 0;
  const sources = {};
  const campaigns = {};
  const basis = {};
  const outboundByService = {};
  const outboundDestinations = {};

  for (const r of rollups) {
    if (!r) continue;
    visitorDaysSummed += r.visitors ?? 0;
    sessions += r.sessions ?? 0;
    pageviews += r.pageviews ?? 0;
    engagedSessions += r.engagedSessions ?? 0;
    engagedMsTotal += r.engagedMsTotal ?? 0;
    newSessions += r.newSessions ?? 0;
    returningSessions += r.returningSessions ?? 0;
    suspectBatches += r.suspectBatches ?? 0;
    rawBatches += r.rawBatches ?? 0;
    uniqueEvents += r.uniqueEvents ?? 0;
    outboundClicks += r.outboundClicks ?? 0;
    streamingClicks += r.streamingClicks ?? 0;
    sessionsWithStreaming += r.sessionsWithStreaming ?? 0;
    mergeBuckets(sources, r.sources);
    mergeBuckets(campaigns, r.campaigns);
    mergeCounts(basis, r.basis);
    mergeCounts(outboundByService, r.outboundByService);
    mergeCounts(outboundDestinations, r.outboundDestinations);
    for (const k of Object.keys(devices)) devices[k] += r.devices?.[k] ?? 0;
    for (const [cc, n] of Object.entries(r.countries ?? {})) countries[cc] = (countries[cc] ?? 0) + n;
  }

  return {
    visitorDaysSummed,
    sessions,
    pageviews,
    engagedSessions,
    engagedMsTotal,
    newSessions,
    returningSessions,
    devices,
    countries,
    suspectBatches,
    rawBatches,
    uniqueEvents,
    outboundClicks,
    streamingClicks,
    sessionsWithStreaming,
    sources,
    campaigns,
    basis,
    outboundByService,
    outboundDestinations,
    avgEngagedMs: sessions ? Math.round(engagedMsTotal / sessions) : 0,
    engagementRate: sessions ? engagedSessions / sessions : 0,
    pagesPerSession: sessions ? pageviews / sessions : 0,
    // The number the whole phase exists for: what share of visits turned into
    // someone actually going to listen.
    intentRate: sessions ? sessionsWithStreaming / sessions : 0,
  };
}

/** Add `n` days to a `YYYY-MM-DD` string. Date-only arithmetic, no timezones. */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Every day from `from` to `to` inclusive, ascending. */
export function enumerateDays(from, to) {
  const out = [];
  if (!isDay(from) || !isDay(to) || from > to) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 1100) break; // ~3 years; a guard, not a limit anyone hits
  }
  return out;
}

export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Turn a range request into concrete bounds.
 *
 * `today` is supplied by the caller rather than read from the clock, because
 * the reporting day is America/New_York and the server's idea of "now" is not.
 */
export function resolveRange(spec, today, earliestDay) {
  const s = spec ?? {};

  if (isDay(s.from) && isDay(s.to)) {
    const from = s.from > today ? today : s.from;
    const to = s.to > today ? today : s.to;
    return from <= to
      ? { from, to, label: from === to ? from : `${from} to ${to}`, key: 'custom' }
      : { from: to, to: from, label: `${to} to ${from}`, key: 'custom' };
  }

  switch (s.range) {
    case 'today':
      return { from: today, to: today, label: 'Today', key: 'today' };
    case '7d':
      return { from: addDays(today, -6), to: today, label: 'Last 7 days', key: '7d' };
    case '30d':
      return { from: addDays(today, -29), to: today, label: 'Last 30 days', key: '30d' };
    case 'all':
      return { from: isDay(earliestDay) ? earliestDay : today, to: today, label: 'All time', key: 'all' };
    default:
      return { from: addDays(today, -6), to: today, label: 'Last 7 days', key: '7d' };
  }
}

/**
 * Decide where one day's numbers should come from.
 *
 * Today is always recomputed: it is still accumulating, and a rollup written
 * at noon would be stale by evening. A closed day uses its stored aggregate
 * when there is one at the current version, and is recomputed otherwise — so
 * bumping ROLLUP_VERSION is the escape hatch that forces every day to be
 * rebuilt, which matters because scheduled functions cannot be invoked by hand
 * in production.
 *
 * @returns {'live'|'rollup'} where the day's figures should be read from
 */
export function chooseSource(day, today, storedRollup) {
  if (day >= today) return 'live';
  if (storedRollup && storedRollup.v === ROLLUP_VERSION) return 'rollup';
  return 'live';
}
