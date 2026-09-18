/**
 * Aggregation correctness.
 *
 * These run the same module the dashboard runs. Every assertion here is a claim
 * the dashboard makes, so if one of these is wrong a number on screen is wrong.
 */

import {
  aggregateDay, combineDays, addDays, enumerateDays, resolveRange, isDay, ENGAGED_MS,
  chooseSource, ROLLUP_VERSION,
} from '../netlify/lib/rollup.js';

const DAY = '2026-09-18';

/** Build a raw record the way the collector writes one. */
function rec({ vid = 'v1', day = DAY, dev = 'mobile', cc = 'US', isNew = true, q = 'ok', events = [] }) {
  return { vid, day, dev, cc, new: isNew, q, events };
}
let n = 0;
const ev = (sid, t, eng_ms = 0, eid) => ({ eid: eid ?? `e${++n}`, sid, t, ts: 1, path: '/', eng_ms, pv: 1 });

export default function run(t) {
  // ---------------------------------------------------------------- basics --
  {
    const r = aggregateDay(DAY, [
      rec({ vid: 'a', events: [ev('s1', 'pv')] }),
      rec({ vid: 'b', events: [ev('s2', 'pv')] }),
    ]);
    t.equal(r.visitors, 2, 'two distinct visitor hashes count as two visitors');
    t.equal(r.sessions, 2, 'two sessions');
    t.equal(r.pageviews, 2, 'two pageviews');
    t.equal(r.rawBatches, 2, 'two batches');
  }

  // ----------------------------------------------------- duplicate events --
  {
    const dup = ev('s1', 'pv', 0, 'SAME');
    const r = aggregateDay(DAY, [
      rec({ events: [dup] }), rec({ events: [dup] }), rec({ events: [dup] }),
    ]);
    t.equal(r.pageviews, 1, 'the same event id delivered three times counts once');
    t.equal(r.uniqueEvents, 1, 'unique events is one');
    t.equal(r.rawBatches, 3, 'but all three batches are still recorded as received');
  }

  // --------------------------------------------------------- engagement ----
  {
    // Heartbeats report the running total. Summing them would multiply the
    // visitor's real time by the number of heartbeats.
    const r = aggregateDay(DAY, [rec({
      events: [ev('s1', 'pv', 0), ev('s1', 'eng', 15000), ev('s1', 'eng', 30000), ev('s1', 'end', 42000)],
    })]);
    t.equal(r.engagedMsTotal, 42000, 'engagement is the largest cumulative value, not the sum');
    t.equal(r.sessions, 1, 'all four events belong to one session');
  }
  {
    const r = aggregateDay(DAY, [
      rec({ events: [ev('short', 'pv'), ev('short', 'end', 3000)] }),
      rec({ events: [ev('long', 'pv'), ev('long', 'end', 25000)] }),
    ]);
    t.equal(r.engagedSessions, 1, 'only the 25s session is engaged; 3s is not');
    t.equal(combineDays([r]).avgEngagedMs, 14000, 'average engagement is per session ((3000+25000)/2)');
  }
  {
    // Two pageviews makes a session engaged even with no time recorded.
    const r = aggregateDay(DAY, [rec({ events: [ev('s1', 'pv'), ev('s1', 'pv')] })]);
    t.equal(r.engagedSessions, 1, 'two pageviews makes a session engaged regardless of time');
    t.equal(r.pageviews, 2, 'both pageviews counted');
  }
  {
    const r = aggregateDay(DAY, [rec({ events: [ev('s1', 'pv'), ev('s1', 'end', ENGAGED_MS - 1)] })]);
    t.equal(r.engagedSessions, 0, 'one millisecond under the threshold is not engaged');
  }

  // --------------------------------------------------- new vs returning ----
  {
    const r = aggregateDay(DAY, [
      rec({ isNew: true, events: [ev('s1', 'pv')] }),
      rec({ isNew: false, events: [ev('s2', 'pv')] }),
      rec({ isNew: false, events: [ev('s3', 'pv')] }),
    ]);
    t.equal(r.newSessions, 1, 'one new session');
    t.equal(r.returningSessions, 2, 'two returning sessions');
    t.equal(r.newSessions + r.returningSessions, r.sessions, 'new + returning accounts for every session');
  }
  {
    // A session's later batches must not flip its classification.
    const r = aggregateDay(DAY, [
      rec({ isNew: true, events: [ev('s1', 'pv')] }),
      rec({ isNew: false, events: [ev('s1', 'eng', 5000)] }),
    ]);
    t.equal(r.newSessions, 1, 'the first batch decides new-vs-returning for the session');
    t.equal(r.sessions, 1, 'still one session');
  }

  // ---------------------------------------------------- devices, quality ---
  {
    const r = aggregateDay(DAY, [
      rec({ dev: 'mobile', events: [ev('s1', 'pv')] }),
      rec({ dev: 'mobile', events: [ev('s2', 'pv')] }),
      rec({ dev: 'desktop', events: [ev('s3', 'pv')] }),
      rec({ dev: 'tablet', q: 'suspect', events: [ev('s4', 'pv')] }),
    ]);
    t.equal(r.devices.mobile, 2, 'two mobile batches');
    t.equal(r.devices.desktop, 1, 'one desktop batch');
    t.equal(r.devices.tablet, 1, 'one tablet batch');
    t.equal(r.suspectBatches, 1, 'one batch flagged suspect');
    t.equal(r.countries.US, 4, 'country tallied per batch');
  }

  // ----------------------------------------------- foreign / junk records --
  {
    const r = aggregateDay(DAY, [
      rec({ events: [ev('s1', 'pv')] }),
      rec({ day: '2026-09-17', events: [ev('other', 'pv')] }), // another day
      null,
      { day: DAY },                                            // no events
      rec({ events: [{ sid: 'x', t: 'pv' }] }),                // no event id
    ]);
    t.equal(r.pageviews, 1, "a different day's record is ignored");
    t.equal(r.sessions, 1, 'only the valid session counts');
    t.ok(r.rawBatches >= 1, 'malformed input does not throw');
  }

  // ------------------------------------------------------------ combine ----
  {
    const d1 = aggregateDay('2026-09-17', [rec({ day: '2026-09-17', vid: 'a', events: [ev('s1', 'pv', 0), ev('s1', 'end', 20000)] })]);
    const d2 = aggregateDay('2026-09-18', [rec({ day: '2026-09-18', vid: 'a', events: [ev('s2', 'pv', 0), ev('s2', 'end', 40000)] })]);
    const c = combineDays([d1, d2]);
    t.equal(c.sessions, 2, 'sessions add across days');
    t.equal(c.pageviews, 2, 'pageviews add across days');
    t.equal(c.engagedMsTotal, 60000, 'engagement adds across days');
    t.equal(c.avgEngagedMs, 30000, 'average engagement is total over sessions');
    t.equal(c.engagementRate, 1, 'both sessions engaged');
    t.equal(c.visitorDaysSummed, 2,
      'the same visitor on two days counts twice — daily salt rotation makes cross-day identity unavailable');
    t.equal(c.uniqueEvents, 4, 'unique event counts carry through to range totals');
    t.equal(c.devices.mobile, 2, 'device counts merge');
    t.equal(c.countries.US, 2, 'country counts merge');
  }
  {
    const c = combineDays([]);
    t.equal(c.sessions, 0, 'an empty range has zero sessions');
    t.equal(c.avgEngagedMs, 0, 'no division by zero on an empty range');
    t.equal(c.engagementRate, 0, 'engagement rate is zero, not NaN');
  }

  // --------------------------------------------------------- date maths ----
  t.equal(addDays('2026-09-18', 1), '2026-09-19', 'addDays forward');
  t.equal(addDays('2026-09-18', -1), '2026-09-17', 'addDays back');
  t.equal(addDays('2026-01-01', -1), '2025-12-31', 'addDays crosses a year');
  t.equal(addDays('2026-03-01', -1), '2026-02-28', 'addDays handles a non-leap February');
  t.equal(addDays('2024-03-01', -1), '2024-02-29', 'addDays handles a leap day');
  t.equal(enumerateDays('2026-09-16', '2026-09-18').length, 3, 'enumerateDays is inclusive of both ends');
  t.equal(enumerateDays('2026-09-18', '2026-09-16').length, 0, 'a reversed range enumerates nothing');
  t.ok(isDay('2026-09-18') && !isDay('2026-9-8') && !isDay('nope'), 'isDay is strict');

  // ------------------------------------------------------------- ranges ----
  {
    const today = '2026-09-18';
    t.equal(resolveRange({ range: 'today' }, today).from, today, 'today starts today');
    t.equal(resolveRange({ range: '7d' }, today).from, '2026-09-12', '7d covers 7 days including today');
    t.equal(enumerateDays(...Object.values(resolveRange({ range: '7d' }, today)).slice(0, 2)).length, 7, '7d is 7 days');
    t.equal(resolveRange({ range: '30d' }, today).from, '2026-08-20', '30d covers 30 days including today');
    t.equal(resolveRange({ range: 'all' }, today, '2026-09-01').from, '2026-09-01', 'all time starts at the earliest day');
    t.equal(resolveRange({ range: 'all' }, today, undefined).from, today, 'all time with no data starts today');
    t.equal(resolveRange({}, today).key, '7d', 'an unrecognised range falls back to 7d');
    t.equal(resolveRange({ from: '2026-09-01', to: '2026-09-05' }, today).key, 'custom', 'explicit dates make a custom range');
    t.equal(resolveRange({ from: '2026-09-05', to: '2026-09-01' }, today).from, '2026-09-01', 'a reversed custom range is swapped, not rejected');
    t.equal(resolveRange({ from: '2026-09-01', to: '2099-01-01' }, today).to, today, 'a future end date is clamped to today');
  }
}

/** Where each day's numbers are read from. */
export function sourceSelection(t) {
  const today = '2026-09-18';
  const good = { v: ROLLUP_VERSION, day: '2026-09-17' };

  t.equal(chooseSource(today, today, good), 'live', 'today is always recomputed, even if a rollup exists');
  t.equal(chooseSource('2026-09-19', today, good), 'live', 'a future day is never read from a rollup');
  t.equal(chooseSource('2026-09-17', today, good), 'rollup', 'a closed day with a current rollup uses it');
  t.equal(chooseSource('2026-09-17', today, null), 'live', 'a closed day with no rollup is recomputed');
  t.equal(chooseSource('2026-09-17', today, undefined), 'live', 'a missing rollup falls back to live');
  t.equal(chooseSource('2026-09-17', today, { v: ROLLUP_VERSION + 1 }), 'live',
    'a rollup from a different version is ignored, so bumping the version rebuilds every day');
  t.equal(chooseSource('2026-09-17', today, { day: '2026-09-17' }), 'live',
    'a rollup with no version is ignored');
}
