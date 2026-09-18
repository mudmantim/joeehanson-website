# Measurement

Private, first-party measurement for joeehanson.com. Phase 1.

Nothing here is visible to an ordinary visitor: no link in the navigation or
the footer, nothing in `sitemap.xml`, nothing in the PWA, and no counter on the
page. Knowing that `/admin` exists grants nothing — every route behind it
requires a signed session.

---

## Shape

```
public/            the only directory Netlify serves
  script.js        site behaviour + the collector (one file, on purpose)
  sw.js            service worker; /api/ and /admin bypass the cache
netlify/
  edge-functions/
    collect.ts     POST /api/e — the only public write endpoint
    admin.ts       /admin and its API; onError "fail"
  functions/
    prune.mts      nightly retention
  lib/             crypto, store conventions, dashboard markup
tests/             run with `npm test`
scripts/           secret generation, end-to-end verification
```

The admin HTML is returned by `admin.ts` and does not exist as a file. There is
nothing under `public/` to leak if the gate ever misbehaves.

## Environment

Three variables on the Netlify project. Generate them with
`node scripts/gen-admin-secrets.mjs`.

| Variable | Purpose |
|---|---|
| `JH_SECRET` | Signs the admin session cookie and the owner-exclusion cookie |
| `JH_ADMIN_PW_SALT` | PBKDF2 salt for the admin password |
| `JH_ADMIN_PW_HASH` | PBKDF2 hash; the password itself is stored nowhere |

Changing `JH_SECRET` signs you out everywhere and un-marks every browser you
had excluded.

**Edge functions resolve environment variables at deploy time.** Adding or
changing any of these requires a new deploy before it takes effect — an
existing deploy will keep reporting "Analytics is not configured".

They are currently stored unmarked rather than as Netlify "secret" values. If
you flip them to secret in the Netlify UI, redeploy and re-run
`scripts/verify-collection.mjs`: secret values are not exposed everywhere
unmarked ones are, and this has not been tested.

## What is stored

Per event: the visitor hash, session id, event type, timestamp, path, referrer
**host**, device/browser/OS **family**, country, a new-vs-returning boolean,
engaged milliseconds, and a quality flag.

Never stored: the IP address, the full User-Agent, the full referrer URL, the
city, screen dimensions, or any fingerprint.

The IP is an HMAC input, in memory, and is never written to a blob or a log.
The salt is random per day and deleted after two days, so once a day has aged
out its visitor hashes cannot be recomputed from anything we still hold.

Ordinary visitors get **no cookies at all**. New-vs-returning comes from one
`localStorage` value, `jh_fs`, holding the month of first arrival.

## Keys and retention

| Prefix | Holds | Kept |
|---|---|---|
| `raw/<day>/<hour>/<uuid>.json` | One accepted batch | 90 days |
| `rollup/daily/<day>.json` | One compacted day | indefinitely |
| `owner/<day>/<uuid>.json` | Owner-excluded hits, diagnostic only | 7 days |
| `salt/<day>` | That day's visitor-hash salt | 2 days |

Everything is append-only under a unique key. **Netlify Blobs has no
concurrency control and last write wins**, so a read-increment-write counter
would silently lose events. Nothing in this system increments anything.

Production writes to `jh-analytics`. Every other context — branch deploys,
deploy previews, local `netlify dev` — writes to `jh-analytics-preview`, so
verification can never pollute real numbers.

## Engagement time

The clock runs only while the page is **visible** and **focused** and there has
been interaction within the last 60 seconds. Backgrounded time is not
engagement, and neither is a visible tab nobody is looking at.

Heartbeats fire every 15 seconds *of engaged time*, not wall time. That is what
makes an abandoned session measurable: a closed laptop lid never sends a final
flush, so without heartbeats it would record nothing.

The final flush is on `pagehide` via `sendBeacon`. Not `beforeunload` and not
`unload` — both are unreliable and both disqualify the page from bfcache.

The implementation lives between the `@engagement-core` markers in
`public/script.js` and the tests extract and run that exact source, so there is
no second copy to drift.

## Owner exclusion

Sign in, press **Exclude this browser**. That sets `jh_own`, an HMAC-signed
HttpOnly cookie with a one-year life. The collector verifies the signature
server-side, so it cannot be forged and the page script has no say in it.

Excluded hits are written to `owner/` and never reach the metrics. They are
kept for seven days, which is what lets the dashboard show *your visits
excluded today* and lets **Send test event** prove — rather than assert — which
side of the line the current browser is on.

The cookie is per browser profile, so mark each device you test from. Private
windows cannot keep it and will always be counted.

## Verifying

```bash
npm test                                          # 470 assertions, no network
node scripts/verify-collection.mjs <url> <pass>   # drives the real endpoints
```

`verify-collection.mjs` asserts on deltas in `/api/stats`: that a normal visit
counts, that the same event id delivered three times counts once, that owner
traffic adds zero, that a forged owner cookie is rejected, and that malformed
payloads are dropped.

Run it against a deploy preview, never production — it writes real events.

## Things that will bite

- **One 404 in `PRECACHE` breaks the service worker entirely.** `cache.addAll`
  is atomic; install fails and the worker never activates, silently, with the
  site still working. `tests/precache.test.mjs` exists for this.
- **Bump `CACHE` in `sw.js` whenever precached content changes**, or returning
  visitors keep the old copies indefinitely.
- The dashboard reads raw events with strong consistency. That is fine at
  current volume and will need rollups (Phase 2) long before it is slow.
- Day boundaries are `America/New_York`, everywhere, deliberately.

## Rollups and ranges

`netlify/functions/rollup.mts` runs nightly at 04:07 ET, ten minutes before the
prune job, so a day is always compacted before its raw events become eligible
for deletion. Each closed day becomes one small blob kept permanently, which is
what lets "all time" stay fast while raw events expire at 90 days.

**Today is never rolled up.** It is still accumulating, and an aggregate written
at noon would be wrong by evening, so the dashboard always recomputes today from
raw. `dataFrom` on `/api/stats` reports how many days came from rollups and how
many were computed live.

Scheduled functions cannot be invoked by hand in production. The escape hatch if
a rollup is ever wrong is to bump `ROLLUP_VERSION` in `netlify/lib/rollup.js`:
every stored rollup then fails the version check, each day is recomputed from raw
on the next read, and the nightly run rewrites them.

All aggregation lives in `netlify/lib/rollup.js` -- plain ESM, imported unchanged
by both the Deno edge runtime and the Node test runner, so the logic the
dashboard runs is the logic the tests check.

Ranges: `/api/stats?range=today|7d|30d|all` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
A reversed custom range is swapped rather than rejected; a future end date is
clamped to today. All day boundaries are America/New_York.

## Reading the dashboard honestly

**Visitors overcounts on any range longer than a day.** It is the sum of daily
uniques, and the visitor hash is salted per day with a key that is destroyed, so
recognising someone across days is cryptographically unavailable by design.
Sessions is the figure that is accurate over any range. The dashboard labels the
tile and the definitions panel says so in full.

Devices are counted per batch received rather than per session, so they indicate
mix rather than exact session counts.

A session that spans midnight is counted in both days.

## Attribution

Standard UTMs. The vocabulary PorchLight generates links against is
`docs/CAMPAIGN-TAXONOMY.md`; the canonical list in code is
`netlify/lib/attribution.js`.

Precedence is **utm > platform click id > referrer > direct**, and every session
records which one answered in `basis`. The dashboard prints the mix, because "we
know, the link was tagged" and "we guessed from a referrer" are different claims.

An unrecognised source is **kept verbatim and flagged**, never folded into
"other" -- a typo should look like a typo rather than quietly taking its traffic
somewhere else.

**Attribution is fixed when a session opens and does not move.** A visitor
arrives on a tagged link, reads for five minutes, then clicks through to
Spotify: that click is credited to the post that brought them. Per-pageview
attribution would lose exactly the thing worth knowing.

Campaign parameters are stripped from the address bar with `history.replaceState`
once recorded, so a shared URL does not carry someone else's tags.

The page captures raw values only; classification happens in the collector, so
there is one implementation and it is tested.

## Outbound clicks

A capture-phase listener on `click` and `auxclick` beacons any cross-origin
link. **Never preventDefault-then-navigate** -- that breaks cmd-click and
middle-click and makes every outbound link feel slower. `sendBeacon` does not
delay or cancel the navigation.

Only the destination host and path are stored, both public URLs.

Clicks to a music service count as **intent**; clicks to Instagram or TikTok are
recorded as outbound but not as intent, because following is not listening.
`intentRate` is the share of sessions producing at least one streaming click --
the number that separates a clip that got views from a clip that sent someone to
press play.

## Not built yet

Everything in the approved design is built. Natural next steps, none committed:
per-song landing pages, a scheduled export for backup, and a summary endpoint if
Mudman Command should ever consume metrics.
