/**
 * Which hostnames are real, and which are the dashboard's.
 *
 * These are two different questions and this file insists they stay that way.
 *
 * The dashboard is moving to admin.joeehanson.com. It must read the SAME blob
 * store as the site it reports on, so a second hostname becomes production.
 * The migration is tested on a branch deploy served from
 * `admin--joeehanson.netlify.app`, which shares a prefix with the real host and
 * must NOT be production.
 *
 * A check written as `hostname.startsWith('admin')` satisfies the feature and
 * points every test write at real visitor data. That is the CONTEXT bug again:
 * that one also looked correct, and merged production with preview until a
 * preview write turned up in the production rollup. So this file calls the
 * real function with real hostnames rather than reading the source and hoping.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = (url) => new Request(url);

export default async function run(t) {
  const { isProductionRequest, isAdminHost, storeNameFor, PRODUCTION_HOSTS } =
    await import('../netlify/lib/store.ts');

  // ---- Production: exactly two hostnames, and nothing that resembles them --
  const production = [
    'https://joeehanson.com/',
    'https://joeehanson.com/admin',
    'https://admin.joeehanson.com/admin',
    'https://admin.joeehanson.com/api/stats?range=7d',
  ];
  for (const u of production) {
    t.ok(isProductionRequest(req(u)), `production: ${u}`);
  }

  const notProduction = [
    // The branch deploy this whole migration is tested on. If this one ever
    // returns true, test traffic is being written into real visitor data.
    'https://admin--joeehanson.netlify.app/admin',
    'https://deploy-preview-12--joeehanson.netlify.app/admin',
    'https://main--joeehanson.netlify.app/',
    'https://joeehanson.netlify.app/',
    'http://localhost:8888/admin',
    'http://127.0.0.1:8799/',
    // Prefix and suffix look-alikes, which an .includes() or .endsWith() check
    // would wave through.
    'https://admin.joeehanson.com.evil.test/admin',
    'https://joeehanson.com.evil.test/',
    'https://notjoeehanson.com/',
    'https://www.joeehanson.com/',
    'https://joeehanson.org/',
  ];
  for (const u of notProduction) {
    t.ok(!isProductionRequest(req(u)), `NOT production: ${u}`);
  }

  t.equal(PRODUCTION_HOSTS.length, 2, 'exactly two production hostnames are allowed');
  t.ok(PRODUCTION_HOSTS.includes('joeehanson.com'), 'the public site is production');
  t.ok(PRODUCTION_HOSTS.includes('admin.joeehanson.com'), 'the dashboard subdomain is production');

  // ---- Admin host: a separate question with a separate answer -------------
  for (const u of ['https://admin.joeehanson.com/admin', 'https://admin--joeehanson.netlify.app/admin']) {
    t.ok(isAdminHost(req(u)), `admin surface: ${u}`);
  }
  for (const u of ['https://joeehanson.com/admin', 'https://joeehanson.com/',
                   'https://admin.joeehanson.com.evil.test/', 'http://localhost:8888/admin']) {
    t.ok(!isAdminHost(req(u)), `NOT the admin surface: ${u}`);
  }

  // ---- The combination that matters --------------------------------------
  // The branch deploy is the admin surface AND is not production. Answering
  // one of these with the other is precisely the mistake to avoid.
  const branch = req('https://admin--joeehanson.netlify.app/admin');
  t.ok(isAdminHost(branch) && !isProductionRequest(branch),
       'the branch deploy serves the dashboard while writing to the preview store');
  const real = req('https://admin.joeehanson.com/admin');
  t.ok(isAdminHost(real) && isProductionRequest(real),
       'the real subdomain serves the dashboard and writes to the production store');

  // ---- and the stores stay distinct --------------------------------------
  t.ok(storeNameFor(true) !== storeNameFor(false), 'production and preview stores differ');
  t.equal(storeNameFor(isProductionRequest(branch)), storeNameFor(false),
          'branch-deploy traffic resolves to the preview store by name');
  t.equal(storeNameFor(isProductionRequest(real)), storeNameFor(true),
          'subdomain traffic resolves to the production store by name');
}

/**
 * The shape of the check, not just its answers.
 *
 * A future edit could satisfy every assertion above with a prefix match that
 * happens to get these cases right and the next one wrong.
 */
export function noFuzzyHostMatching(t) {
  const src = readFileSync(join(root, 'netlify/lib/store.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  t.ok(/PRODUCTION_HOSTS\.includes\(new URL\(req\.url\)\.hostname\)/.test(code),
       'production is exact membership of a fixed list');
  t.ok(!/hostname\.startsWith|hostname\.endsWith|hostname\.includes|hostname\.match/.test(code),
       'no prefix, suffix or substring matching is used on the hostname');
  t.ok(!/Netlify\.env\.get\(['"]CONTEXT['"]\)/.test(code),
       'the environment is still not read from CONTEXT');
}
