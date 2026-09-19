/**
 * Nightly compaction.
 *
 * Reads a closed day's raw batches, aggregates them once, and stores the
 * result. The dashboard then reads one small blob per day instead of every
 * event ever collected, which is what lets "all time" stay fast while raw
 * events expire at 90 days.
 *
 * Today is never rolled up: it is still accumulating, and a rollup written at
 * noon would be wrong by evening. The dashboard computes today live.
 *
 * Idempotent. Re-running rewrites the same aggregate from the same input, and
 * a run that dies halfway simply resumes next time.
 */

import type { Config } from '@netlify/functions';
import { analyticsStore, isProductionProcess, keys, REPORT_TZ } from '../lib/store.ts';
import { aggregateDay, ROLLUP_VERSION } from '../lib/rollup.js';

export default async (req: Request, context: any) => {
  const production = isProductionProcess(context);
  const store = analyticsStore(production, { consistency: 'strong' });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ }).format(new Date());

  // `?force=YYYY-MM-DD` recomputes one day even if it already has a rollup.
  const force = new URL(req.url).searchParams.get('force');

  // Which days have raw data at all.
  const { blobs } = await store.list({ prefix: 'raw/' });
  const days = new Set<string>();
  for (const b of blobs) {
    const day = b.key.split('/')[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days.add(day);
  }

  const written: string[] = [];
  const skipped: string[] = [];

  for (const day of [...days].sort()) {
    if (day >= today && day !== force) { skipped.push(`${day} (still open)`); continue; }

    if (day !== force) {
      const existing = (await store.get(keys.rollup(day), { type: 'json' })) as any;
      if (existing?.v === ROLLUP_VERSION) { skipped.push(`${day} (already rolled up)`); continue; }
    }

    const dayBlobs = (await store.list({ prefix: `raw/${day}/` })).blobs;
    const records = [];
    for (const b of dayBlobs) {
      const rec = await store.get(b.key, { type: 'json' });
      if (rec) records.push(rec);
    }

    const rollup = aggregateDay(day, records);
    await store.setJSON(keys.rollup(day), { ...rollup, generatedAt: new Date().toISOString() });
    written.push(day);
  }

  const result = { today, production, written, skipped };
  console.log('[rollup]', JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
};

// Ten minutes before the prune job, so a day is always compacted before its
// raw events become eligible for deletion.
export const config: Config = { schedule: '7 4 * * *' };
