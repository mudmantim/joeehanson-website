/**
 * Nightly retention job.
 *
 *   raw/    90 days — per-visitor rows have a hard expiry
 *   owner/   7 days — diagnostic only; enough to show exclusion is working
 *   salt/    2 days — once a day's salt is gone, that day's visitor hashes
 *                     cannot be recomputed from anything we still hold
 *
 * Deletions are driven by the day embedded in the key, so a partially
 * completed run simply resumes next time. Nothing here rewrites data.
 */

import type { Config } from '@netlify/functions';
import { analyticsStore, resolveProcessEnvironment, REPORT_TZ } from '../lib/store.ts';

const RETENTION_DAYS = { raw: 90, owner: 7, salt: 2 } as const;

function daysAgo(day: string, today: string): number {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return -1;
  return Math.round((b - a) / 86_400_000);
}

export default async (req: Request, context: any) => {
  // Refuse to run rather than guess. This job deletes; getting the store wrong
  // means deleting the wrong data, and it already meant production's daily
  // salts were never destroyed at all.
  const env = resolveProcessEnvironment(context);
  if (!env.known) {
    const refusal = { refused: true, reason: env.reason, signals: env.signals };
    console.error('[prune] refusing to run:', JSON.stringify(refusal));
    return new Response(JSON.stringify(refusal), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  const production = env.production;
  const store = analyticsStore(production);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ }).format(new Date());
  const deleted: Record<string, number> = { raw: 0, owner: 0, salt: 0 };
  const kept: Record<string, number> = { raw: 0, owner: 0, salt: 0 };

  for (const prefix of ['raw', 'owner', 'salt'] as const) {
    const { blobs } = await store.list({ prefix: `${prefix}/` });
    for (const blob of blobs) {
      // keys look like raw/2026-09-18/14/<uuid>.json or salt/2026-09-18
      const day = blob.key.split('/')[1];
      const age = daysAgo(day, today);
      if (age < 0) continue; // unparseable key: leave it alone rather than guess
      if (age >= RETENTION_DAYS[prefix]) {
        await store.delete(blob.key);
        deleted[prefix]++;
      } else {
        kept[prefix]++;
      }
    }
  }

  console.log('[prune]', JSON.stringify({ today, deleted, kept }));
  return new Response(JSON.stringify({ today, deleted, kept }), {
    headers: { 'content-type': 'application/json' },
  });
};

export const config: Config = { schedule: '17 4 * * *' };
