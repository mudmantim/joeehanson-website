/**
 * Blob store access and the day/key conventions every other file relies on.
 *
 * Two rules hold everywhere:
 *
 *   1. Writes are append-only under a unique key. Netlify Blobs has no
 *      concurrency control and last write wins, so a read-increment-write
 *      counter would silently lose events under any concurrency at all.
 *
 *   2. Production data only ever lands in the global store. Any non-production
 *      context (branch deploys, deploy previews, local dev) writes to a
 *      deploy-scoped store, so preview verification cannot pollute real numbers.
 */

import { getStore } from '@netlify/blobs';

export const STORE_NAME = 'jh-analytics';
/**
 * Everything that is not a production deploy writes here instead.
 *
 * Isolation is by store *name* rather than by `getDeployStore`, because a
 * deploy-scoped store requires an explicit region when it is opened from an
 * edge function and a global store does not. One name per environment keeps
 * branch-deploy and local traffic out of the real numbers with no extra
 * configuration to get wrong.
 */
export const PREVIEW_STORE_NAME = 'jh-analytics-preview';

/** Reporting timezone. Every day boundary in this system is New York's. */
export const REPORT_TZ = 'America/New_York';

type StoreOpts = { consistency?: 'strong' | 'eventual' };

/** The canonical public hostname. */
export const PRODUCTION_HOST = 'joeehanson.com';

/**
 * Every hostname whose traffic is real. Exact strings, never prefixes.
 *
 * The dashboard lives at admin.joeehanson.com and must read and write the same
 * store as the site it reports on -- it is the same analytics, seen from a
 * second door.
 *
 * The literal-ness matters more than it looks. Branch deploys and previews are
 * served from names like `admin--joeehanson.netlify.app`, which share a prefix
 * with the real host and are NOT production. A check written as
 * `hostname.startsWith('admin')` would satisfy the feature and point every
 * preview write at real visitor data -- the CONTEXT bug over again in a new
 * costume, and that one also looked right while quietly merging two
 * environments. So: exact membership, with tests that feed this function those
 * look-alike hosts by name and require the answer to be false.
 */
export const PRODUCTION_HOSTS: readonly string[] = [
  'joeehanson.com',
  'admin.joeehanson.com',
];

/**
 * Whether this request is production traffic.
 *
 * Derived from the hostname, NOT from the CONTEXT environment variable.
 * CONTEXT is a build-time variable and is not readable from the edge runtime:
 * `Netlify.env.get('CONTEXT')` returns undefined there, so a context check
 * silently reported "not production" on production and every deploy wrote to
 * one shared store. That was caught only because verifying production found a
 * preview write showing up in it.
 *
 * The hostname cannot drift the same way: a deploy preview is served from
 * deploy-preview-N--joeehanson.netlify.app, a branch deploy from
 * branch--joeehanson.netlify.app, and local dev from localhost. Only the
 * canonical domain is production.
 */
export function isProductionRequest(req: Request): boolean {
  try {
    return PRODUCTION_HOSTS.includes(new URL(req.url).hostname);
  } catch {
    return false;
  }
}

/** Whether this request is for the private dashboard's own hostname. */
export function isAdminHost(req: Request): boolean {
  try {
    const h = new URL(req.url).hostname;
    // One hostname. The branch-deploy hosts used to prove this out before DNS
    // existed have been removed now that the real subdomain does.
    //
    // This stays a separate question from PRODUCTION_HOSTS even though the two
    // lists now overlap. What this function gates is non-secret -- a manifest
    // naming an icon, and a worker that stores nothing -- whereas that one
    // decides whether a write lands in real visitor data. Answering one with
    // the other is how a plausible `hostname.startsWith('admin')` would put
    // test traffic into the analytics.
    return h === 'admin.joeehanson.com';
  } catch {
    return false;
  }
}

/**
 * The origin that holds the owner-exclusion cookie.
 *
 * `jh_own` is host-only on joeehanson.com and stays that way: the collector
 * reads it there, and every exclusion already marked on a real device is that
 * cookie. Nothing here re-scopes it, gives it a Domain, or re-issues it. What
 * moves is only the place the operator presses the button, so the dashboard
 * has to know where to send them.
 *
 * On the branch deploy the dashboard and the site share one hostname, so this
 * returns that same host and the badge and bounce are same-origin. That
 * exercises the tokens, the redirect allowlist, the cookie write and the
 * caching headers -- everything except the cross-origin leg itself, which
 * cannot exist until admin.joeehanson.com does.
 */
export function publicOriginFor(req: Request): string {
  const h = new URL(req.url).hostname;
  return h === 'admin.joeehanson.com' ? 'https://joeehanson.com' : `https://${h}`;
}

/** The origin the dashboard is served from, used to allowlist redirects back. */
export function adminOriginFor(req: Request): string {
  return `https://${new URL(req.url).hostname}`;
}

export { resolveProcessEnvironment, environmentSignals, KNOWN_CONTEXTS } from './environment.js';

export function storeNameFor(production: boolean): string {
  return production ? STORE_NAME : PREVIEW_STORE_NAME;
}

export function analyticsStore(production: boolean, opts: StoreOpts = {}) {
  return getStore({ name: storeNameFor(production), ...opts });
}

/** `YYYY-MM-DD` in the reporting timezone, not UTC and not the visitor's zone. */
export function reportDay(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ }).format(at);
}

/** `HH` in the reporting timezone, used only to keep day directories shallow. */
export function reportHour(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TZ,
    hour: '2-digit',
    hour12: false,
  }).format(at);
}

export const keys = {
  /** One blob per accepted batch. Unique key, never overwritten. */
  raw: (day: string, hour: string, id: string) => `raw/${day}/${hour}/${id}.json`,
  /** Owner-excluded hits. Diagnostic only, pruned after 7 days. */
  owner: (day: string, id: string) => `owner/${day}/${id}.json`,
  /** The visitor-hash salt for one day. Random, and deleted on rotation. */
  salt: (day: string) => `salt/${day}`,
  /** One compacted day. Written once by the nightly job; kept indefinitely. */
  rollup: (day: string) => `rollup/daily/${day}.json`,
};

/**
 * The daily salt for visitor hashing.
 *
 * Random per day and deleted by the prune job two days later, so yesterday's
 * hashes cannot be recomputed from anything we still hold — the property that
 * makes the visitor id genuinely unlinkable across days rather than merely
 * un-joined.
 *
 * Read with strong consistency because a stale miss would mint a second salt
 * for the same day. A race is still possible in the first moments of a new day;
 * its only effect is that a handful of visitors could be counted twice that
 * day, which is why nothing in the system treats the visitor id as an identity.
 */
export async function dailySalt(production: boolean, day: string): Promise<string> {
  const store = analyticsStore(production, { consistency: 'strong' });
  const existing = await store.get(keys.salt(day));
  if (existing) return existing;

  const fresh = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await store.set(keys.salt(day), fresh);
  return fresh;
}
