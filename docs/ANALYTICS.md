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

## 2026-09-18 is verification traffic, not audience

The day the system was built is contaminated, and there is no safe way to
remove it. Read any range that includes **2026-09-18** with that in mind; real
measurement starts 2026-09-19.

What is in that day's production figures (18 sessions, 20 pageviews):

| | |
|---|---|
| 5 tagged sessions | Definitively synthetic. Campaigns `zzz-verification-20260918/*` and `iso6-*`, created to verify attribution, outbound clicks and store isolation. Identifiable forever by name. |
| 13 untagged sessions | Overwhelmingly synthetic -- plain pageview writes from the Phase 1/2/3 verification scripts. **Not separable from real traffic.** |
| 20 owner-excluded hits | Correctly excluded. Never in any metric. |

One honest uncertainty: 4 of the day's 37 batches came from mobile
user-agents, and none of the verification traffic was mobile. Those are
plausibly real release-day visitors. It is not possible to confirm.

**Why it was not cleaned up.** There is no delete-by-key admin endpoint, and
adding one that removes events matching a campaign prefix would put a mechanism
capable of deleting genuine visitor data next to a store that has no backup and
no point-in-time recovery. The cost of leaving one clearly-labelled bad day is
much lower than the cost of that mechanism existing.

Raw events for the day expire after 90 days. The daily rollup does not -- so
the contaminated figures for 2026-09-18 are permanent in the aggregate, which
is precisely why this section exists.

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

## The installed app

`/admin` installs on Android as its own app, separate from the public site's
PWA. Two files make that work, and both are served by the admin edge function
rather than from `public/`, so the dashboard still has no file to leak:

| Route | What it is |
|---|---|
| `/admin/manifest.webmanifest` | name, icons, `start_url`, `scope` |
| `/admin/sw.js` | a service worker that stores nothing |

Neither sits behind the session cookie, and that is deliberate rather than an
oversight. Chrome does not build the installed app itself — it hands the
manifest and icon URLs to Google's WebAPK service, which fetches them from its
own network with no cookies. Anything needed for installation that requires the
session simply fails to install. Nothing is lost by leaving them open: the
manifest is a name and an icon path, the worker is a constant, and every route
that returns a number is still behind the gate.

**It is a separate app because of one field.** `id` is `/admin`; the public
manifest's is `/`. Make them equal and the installed dashboard replaces the
artist's app on the home screen rather than sitting beside it.
`tests/admin-pwa.test.mjs` fails if they ever converge.

**It caches nothing.** The worker exists only because Android will not mint a
separate app without one. It never touches the Cache Storage API — no cache
name, no precache list, no `put`, no `match` — so no dashboard HTML, API
response, cookie or figure is ever written to the phone. The only thing it
generates is a plain "no connection" page for a failed page load, because in an
installed app there is no address bar and no reload button. The public worker
in `public/sw.js` separately bypasses `/admin` and `/api/`, as it has since
Phase 0.

**Opening it records nothing.** The dashboard has never loaded `script.js` and
still does not, so looking at the numbers does not change them. The owner
cookie is a second, independent layer under that.

**Icons** are `public/assets/icons/admin-*.png` — a flat bar mark, deliberately
nothing like the porch-lantern photograph the public app uses, so the two are
not confused on a home screen. They live under `public/` because the WebAPK
service has to be able to fetch them.

**Sessions still last seven days.** On day eight the dashboard clears the
figures off the screen, says the session expired, and goes to the sign-in form.
Before this it parsed the 401 as if it were data and left half a dashboard
behind, which inside an app with no address bar was the only thing an expired
session ever showed.

## Not built yet

Everything in the approved design is built. Natural next steps, none committed:
per-song landing pages, a scheduled export for backup, and a summary endpoint if
Mudman Command should ever consume metrics.
