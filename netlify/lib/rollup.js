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

export const ROLLUP_VERSION = 1;

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
  /** @type {Map<string, {engagedMs:number, pageviews:number, isNew:boolean|null}>} */
  const sessions = new Map();
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
        s = { engagedMs: 0, pageviews: 0, isNew: null };
        sessions.set(e.sid, s);
      }
      // The first record seen for a session decides new-vs-returning; later
      // batches in the same session carry the same flag.
      if (s.isNew === null) s.isNew = rec.new === true;

      if (e.t === 'pv') { pageviews++; s.pageviews++; }

      const ms = Number(e.eng_ms);
      if (Number.isFinite(ms) && ms > s.engagedMs) s.engagedMs = ms;
    }
  }

  let engagedSessions = 0;
  let engagedMsTotal = 0;
  let newSessions = 0;
  let returningSessions = 0;

  for (const s of sessions.values()) {
    engagedMsTotal += s.engagedMs;
    if (s.engagedMs >= ENGAGED_MS || s.pageviews >= 2) engagedSessions++;
    if (s.isNew) newSessions++; else returningSessions++;
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
  };
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
    avgEngagedMs: sessions ? Math.round(engagedMsTotal / sessions) : 0,
    engagementRate: sessions ? engagedSessions / sessions : 0,
    pagesPerSession: sessions ? pageviews / sessions : 0,
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
