/**
 * Checks every outbound link in releases.json.
 *
 *   node scripts/verify-links.mjs [--full]
 *
 * A link that 200s is not necessarily the right link, so where a service has a
 * public API this also confirms the artist and the title behind the id. Spotify
 * and Amazon have no usable public API here; those are status-checked only and
 * were opened by hand during research.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releases = JSON.parse(readFileSync(join(root, 'public/data/releases.json'), 'utf8'));

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const EXPECTED_ARTIST = 'Joe E. Hanson';

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function status(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } });
    return r.status;
  } catch (e) { return `err:${e.message.slice(0, 40)}`; }
}

/** Apple: confirm the collection id really is this artist and title. */
async function verifyApple(url, expectedTitle) {
  const id = url.match(/\/(\d{6,})/)?.[1];
  if (!id) return { ok: false, why: 'no id in url' };
  const r = await (await fetch(`https://itunes.apple.com/lookup?id=${id}`)).json();
  const c = r.results?.[0];
  if (!c) return { ok: false, why: 'lookup returned nothing' };
  return {
    ok: c.artistName === EXPECTED_ARTIST && c.collectionName.startsWith(expectedTitle.split(' - ')[0].slice(0, 12)),
    why: `${c.artistName} / ${c.collectionName}`,
    tracks: c.trackCount,
  };
}

/** Deezer: same idea. */
async function verifyDeezer(url, expectedTitle) {
  const id = url.match(/\/album\/(\d+)/)?.[1];
  if (!id) return { ok: false, why: 'no id in url' };
  const a = await (await fetch(`https://api.deezer.com/album/${id}`)).json();
  if (a.error) return { ok: false, why: JSON.stringify(a.error).slice(0, 60) };
  return {
    ok: a.artist?.name === EXPECTED_ARTIST && a.title === expectedTitle,
    why: `${a.artist?.name} / ${a.title}`,
    tracks: a.nb_tracks,
  };
}

console.log(`\nVerifying ${releases.length} releases\n`);

for (const rel of releases) {
  console.log(`${rel.title}  (${rel.type ?? '?'}, ${rel.tracks?.length ?? 0} tracks)`);

  for (const [service, url] of Object.entries(rel.links ?? {})) {
    if (service === 'Apple Music') {
      const v = await verifyApple(url, rel.title);
      check(`${service}: artist + title match`, v.ok, v.why);
      check(`${service}: track count is ${rel.tracks.length}`, v.tracks === rel.tracks.length, `api says ${v.tracks}`);
    } else if (service === 'Deezer') {
      const v = await verifyDeezer(url, rel.title);
      check(`${service}: artist + title match`, v.ok, v.why);
      check(`${service}: track count is ${rel.tracks.length}`, v.tracks === rel.tracks.length, `api says ${v.tracks}`);
    } else {
      const s = await status(url);
      check(`${service}: resolves`, s === 200, `HTTP ${s}`);
    }
    check(`${service}: is a direct release url, not a search page`,
      !/\/search|\?q=|\/artist\/?$/.test(url) || /\/albums\//.test(url), url.slice(0, 70));
  }

  // Track links: status only; these are individual songs on a service already
  // verified above.
  const withUrls = (rel.tracks ?? []).filter((t) => t.url);
  if (withUrls.length) {
    const statuses = await Promise.all(withUrls.map((t) => status(t.url)));
    const bad = statuses.filter((s) => s !== 200).length;
    check(`${withUrls.length} track links resolve`, bad === 0, `${bad} failed`);
  }
  console.log('');
}

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  × ${f}`); process.exit(1); }
