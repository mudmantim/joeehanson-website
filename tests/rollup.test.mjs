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

/** Attribution and outbound aggregation (Phase 3). */
export function attributionAggregation(t) {
  const D = '2026-09-18';
  let i = 0;
  const e = (sid, type, extra = {}) => ({ eid: `a${++i}`, sid, t: type, ts: 1, path: '/', eng_ms: 0, pv: 1, ...extra });
  const r = (attr, events, over = {}) =>
    ({ vid: 'v1', day: D, dev: 'mobile', cc: 'US', new: true, q: 'ok', attr, events, ...over });

  const tiktok = { source: 'tiktok', medium: 'social', campaign: 'hmha-launch', content: 'sds-clip-01', term: 'same-damn-shame', basis: 'utm' };
  const insta  = { source: 'instagram', medium: 'social', campaign: 'hmha-launch', content: 'sds-post-01', term: 'same-damn-shame', basis: 'utm' };
  const direct = { source: 'direct', medium: 'none', campaign: null, content: null, basis: 'direct' };
  const spot = { host: 'open.spotify.com', path: '/track/abc', service: 'spotify', kind: 'streaming' };
  const ig   = { host: 'instagram.com', path: '/x', service: 'instagram', kind: 'social' };

  const day = aggregateDay(D, [
    // TikTok: two sessions, one clicks through to Spotify.
    r(tiktok, [e('t1', 'pv'), e('t1', 'end', { eng_ms: 40000 }), e('t1', 'out', { out: spot })]),
    r(tiktok, [e('t2', 'pv'), e('t2', 'end', { eng_ms: 5000 })]),
    // Instagram: one session, clicks a social link only.
    r(insta,  [e('i1', 'pv'), e('i1', 'out', { out: ig })]),
    // Direct: one session, nothing.
    r(direct, [e('d1', 'pv')]),
  ]);

  t.equal(day.sessions, 4, 'four sessions');
  t.equal(day.outboundClicks, 2, 'two outbound clicks in total');
  t.equal(day.streamingClicks, 1, 'one of them was a streaming service');
  t.equal(day.sessionsWithStreaming, 1, 'one session showed listening intent');

  t.equal(day.sources['tiktok / social'].sessions, 2, 'tiktok has two sessions');
  t.equal(day.sources['instagram / social'].sessions, 1, 'instagram has one');
  t.equal(day.sources['direct / none'].sessions, 1, 'direct has one');
  t.equal(day.sources['tiktok / social'].streaming, 1, 'tiktok produced the streaming click');
  t.equal(day.sources['instagram / social'].streaming, 0,
    'a social outbound click is not counted as listening intent');

  t.equal(day.campaigns['hmha-launch / sds-clip-01'].sessions, 2, 'the TikTok clip is its own row');
  t.equal(day.campaigns['hmha-launch / sds-post-01'].sessions, 1, 'the Instagram post is a separate row');
  t.equal(day.campaigns['(untagged)'].sessions, 1, 'untagged traffic groups separately');
  t.equal(day.campaigns['hmha-launch / sds-clip-01'].intentSessions, 1,
    'intent is attributed to the post that brought the visitor in');

  t.equal(day.outboundByService.spotify, 1, 'spotify click tallied');
  t.equal(day.outboundByService.instagram, 1, 'social click tallied separately');
  t.equal(day.outboundDestinations['spotify|/track/abc'], 1, 'the exact track is recorded');
  t.ok(!('instagram|/x' in day.outboundDestinations), 'only streaming destinations are listed');
  t.equal(day.basis.utm, 3, 'three sessions were attributed from tagged links');
  t.equal(day.basis.direct, 1, 'one was direct');

  // An outbound click alone makes a session engaged.
  const clicky = aggregateDay(D, [r(tiktok, [e('c1', 'pv'), e('c1', 'out', { out: spot })])]);
  t.equal(clicky.engagedSessions, 1, 'a session that clicked through counts as engaged');

  // Attribution is fixed by the batch that opens the session.
  const later = aggregateDay(D, [
    r(tiktok, [e('s1', 'pv')]),
    r(insta,  [e('s1', 'out', { out: spot })]),
  ]);
  t.equal(later.sources['tiktok / social'].sessions, 1, 'the opening batch owns the session');
  t.ok(!('instagram / social' in later.sources), 'a later batch cannot re-attribute it');
  t.equal(later.sources['tiktok / social'].streaming, 1,
    'and the later click is credited to the original source');

  // Combine across days.
  const c = combineDays([day, day]);
  t.equal(c.sources['tiktok / social'].sessions, 4, 'source tables merge across days');
  t.equal(c.campaigns['hmha-launch / sds-clip-01'].sessions, 4, 'campaign tables merge');
  t.equal(c.outboundByService.spotify, 2, 'service counts merge');
  t.equal(c.streamingClicks, 2, 'streaming clicks add');
  t.equal(c.intentRate, 2 / 8, 'intent rate is sessions-with-streaming over sessions');

  // Empty is empty, not NaN.
  const empty = combineDays([]);
  t.equal(empty.intentRate, 0, 'intent rate on no data is zero');
  t.equal(Object.keys(empty.sources).length, 0, 'no phantom source rows');

  // Old rollups lacking the new fields must not poison a merge.
  const legacy = combineDays([{ v: 1, sessions: 3, pageviews: 3 }, day]);
  t.equal(legacy.sessions, 7, 'a pre-Phase-3 rollup still contributes its totals');
  t.equal(legacy.outboundClicks, 2, 'and contributes zero to the new fields rather than NaN');
}
