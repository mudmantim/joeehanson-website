/**
 * End-to-end proof that collection is actually correct.
 *
 *   node scripts/verify-collection.mjs <baseUrl> <adminPassword>
 *
 * Drives the real endpoints over HTTP and asserts on deltas in /api/stats.
 * Every claim on the dashboard should be reproducible by running this.
 */

const BASE = process.argv[2];
const PASSWORD = process.argv[3];
if (!BASE || !PASSWORD) {
  console.error('usage: node scripts/verify-collection.mjs <baseUrl> <adminPassword>');
  process.exit(2);
}

let pass = 0;
const fails = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal cookie jar: the whole point is to control exactly which cookies go out. */
const jar = new Map();
function storeCookies(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === '' || /Max-Age=0/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
}
const cookieHeader = (only) => {
  const entries = [...jar.entries()].filter(([k]) => !only || only.includes(k));
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
};

async function req(path, { method = 'GET', body, cookies, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    body,
    redirect: 'manual',
    headers: { ...headers, ...(cookieHeader(cookies) ? { cookie: cookieHeader(cookies) } : {}) },
  });
  storeCookies(res);
  return res;
}

const stats = async () => (await req('/api/stats', { cookies: ['jh_adm'] })).json();

function batch(events, extra = {}) {
  return JSON.stringify({ events, ref: '', new: false, ...extra });
}
const pv = (sid = `s-${uuid()}`, eid = uuid()) => ({ eid, sid, t: 'pv', ts: Date.now(), path: '/', eng_ms: 0, pv: 1 });

console.log(`\nVerifying ${BASE}\n`);

// ---------------------------------------------------------------- auth ----
console.log('authentication');
check('/admin is 401 without a session', (await req('/admin')).status === 401);
check('/api/stats is 401 without a session', (await req('/api/stats')).status === 401);
check('/api/whoami is 401 without a session', (await req('/api/whoami')).status === 401);
check('/api/own is 401 without a session',
  (await req('/api/own', { method: 'POST', body: new URLSearchParams({ exclude: '1' }) })).status === 401);
check('wrong password is rejected',
  (await req('/api/login', { method: 'POST', body: new URLSearchParams({ password: 'not-the-password' }) })).status === 401);

const login = await req('/api/login', { method: 'POST', body: new URLSearchParams({ password: PASSWORD }) });
check('correct password issues a session', login.status === 303 && jar.has('jh_adm'));
check('/admin is reachable once authenticated', (await req('/admin', { cookies: ['jh_adm'] })).status === 200);

// ------------------------------------------------------- normal visit ----
console.log('\ncollection');
const before = await stats();

const sid1 = `s-${uuid()}`;
await req('/api/e', {
  method: 'POST', cookies: [], headers: { 'content-type': 'application/json' },
  body: batch([pv(sid1)]),
});
await sleep(1500);
const afterVisit = await stats();

check('a normal visit is counted',
  afterVisit.totals.pageviews === before.totals.pageviews + 1,
  `pageviews ${before.totals.pageviews} -> ${afterVisit.totals.pageviews}`);
check('the visit creates exactly one session',
  afterVisit.totals.sessions === before.totals.sessions + 1,
  `sessions ${before.totals.sessions} -> ${afterVisit.totals.sessions}`);

// --------------------------------------------------- duplicate events ----
const dupEid = uuid();
const dupSid = `s-${uuid()}`;
const dupEvent = { ...pv(dupSid, dupEid) };
for (let i = 0; i < 3; i++) {
  await req('/api/e', {
    method: 'POST', cookies: [], headers: { 'content-type': 'application/json' },
    body: batch([dupEvent]),
  });
}
await sleep(1500);
const afterDup = await stats();
check('the same event id delivered 3 times counts once',
  afterDup.totals.pageviews === afterVisit.totals.pageviews + 1,
  `pageviews ${afterVisit.totals.pageviews} -> ${afterDup.totals.pageviews} (expected +1)`);
check('duplicate delivery does not inflate unique events',
  afterDup.totals.uniqueEvents === afterVisit.totals.uniqueEvents + 1,
  `uniqueEvents ${afterVisit.totals.uniqueEvents} -> ${afterDup.totals.uniqueEvents}`);

// ------------------------------------------------- engagement rollup -----
const engSid = `s-${uuid()}`;
await req('/api/e', {
  method: 'POST', cookies: [], headers: { 'content-type': 'application/json' },
  body: batch([
    { eid: uuid(), sid: engSid, t: 'pv', ts: Date.now(), path: '/', eng_ms: 0, pv: 1 },
    { eid: uuid(), sid: engSid, t: 'eng', ts: Date.now(), path: '/', eng_ms: 15000, pv: 1 },
    { eid: uuid(), sid: engSid, t: 'end', ts: Date.now(), path: '/', eng_ms: 42000, pv: 1 },
  ]),
});
await sleep(1500);
const afterEng = await stats();
check('engagement uses the largest cumulative value per session, not the sum',
  afterEng.totals.avgEngagedMs > 0 && afterEng.totals.avgEngagedMs < 42000,
  `avgEngagedMs = ${afterEng.totals.avgEngagedMs} (42000 for one of ${afterEng.totals.sessions} sessions)`);
check('a 42s session counts as engaged', afterEng.totals.engagementRate > 0);

// ---------------------------------------------------- owner exclusion ----
console.log('\nowner exclusion');
const whoamiBefore = await (await req('/api/whoami', { cookies: ['jh_adm'] })).json();
check('this browser starts NOT excluded', whoamiBefore.excluded === false);

const testBefore = await (await req('/api/test-event', { cookies: ['jh_adm'] })).json();
check('test event reports it would be counted', testBefore.wouldBeCounted === true);

await req('/api/own', {
  method: 'POST', cookies: ['jh_adm'],
  body: new URLSearchParams({ exclude: '1' }),
});
check('marking the browser sets an owner cookie', jar.has('jh_own'));

const whoamiAfter = await (await req('/api/whoami', { cookies: ['jh_adm', 'jh_own'] })).json();
check('whoami now reports EXCLUDED', whoamiAfter.excluded === true);
check('the exclusion has an expiry', typeof whoamiAfter.expiresAt === 'string');

const testAfter = await (await req('/api/test-event', { cookies: ['jh_adm', 'jh_own'] })).json();
check('test event now reports it would NOT be counted', testAfter.wouldBeCounted === false);

const preOwner = await stats();
for (let i = 0; i < 3; i++) {
  await req('/api/e', {
    method: 'POST', cookies: ['jh_own'], headers: { 'content-type': 'application/json' },
    body: batch([pv()]),
  });
}
await sleep(1500);
const postOwner = await stats();

check('owner visits add ZERO pageviews',
  postOwner.totals.pageviews === preOwner.totals.pageviews,
  `pageviews ${preOwner.totals.pageviews} -> ${postOwner.totals.pageviews}`);
check('owner visits add ZERO sessions',
  postOwner.totals.sessions === preOwner.totals.sessions,
  `sessions ${preOwner.totals.sessions} -> ${postOwner.totals.sessions}`);
check('the owner-excluded diagnostic counter increased by 3',
  postOwner.ownerExcludedToday === preOwner.ownerExcludedToday + 3,
  `ownerExcludedToday ${preOwner.ownerExcludedToday} -> ${postOwner.ownerExcludedToday}`);

// A forged owner cookie must not work.
jar.set('jh_own', '9999999999.' + 'a'.repeat(64));
const preForge = await stats();
await req('/api/e', {
  method: 'POST', cookies: ['jh_own'], headers: { 'content-type': 'application/json' },
  body: batch([pv()]),
});
await sleep(1500);
const postForge = await stats();
check('a forged owner cookie does NOT exclude (signature is checked)',
  postForge.totals.pageviews === preForge.totals.pageviews + 1,
  `pageviews ${preForge.totals.pageviews} -> ${postForge.totals.pageviews}`);

// ------------------------------------------------------ input hygiene ----
console.log('\ninput validation');
const preJunk = await stats();
const junk = [
  ['oversized body', 'x'.repeat(5000)],
  ['malformed json', '{not json'],
  ['empty batch', JSON.stringify({ events: [] })],
  ['unknown event type', batch([{ eid: uuid(), sid: 's', t: 'evil', ts: Date.now() }])],
  ['missing ids', batch([{ t: 'pv', ts: Date.now() }])],
  ['too many events', JSON.stringify({ events: Array.from({ length: 50 }, () => pv()) })],
];
for (const [, body] of junk) {
  await req('/api/e', { method: 'POST', cookies: [], headers: { 'content-type': 'application/json' }, body });
}
await sleep(1500);
const postJunk = await stats();
check('malformed and oversized payloads are all rejected',
  postJunk.totals.pageviews === preJunk.totals.pageviews,
  `pageviews ${preJunk.totals.pageviews} -> ${postJunk.totals.pageviews}`);

// The edge config filters on method, so a GET never reaches the function at
// all and falls through to a 404. Either way it must not be accepted.
const getCollector = (await req('/api/e')).status;
check('GET on the collector is rejected', getCollector === 404 || getCollector === 405, `got ${getCollector}`);
const putCollector = (await req('/api/e', { method: 'PUT' })).status;
check('PUT on the collector is rejected', putCollector === 404 || putCollector === 405, `got ${putCollector}`);

// --------------------------------------------------------------- done ----
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  × ${f}`); process.exit(1); }
