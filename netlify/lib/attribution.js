/**
 * Where a visit came from, and where it went.
 *
 * All classification happens here, on the server, not in the page. The client
 * captures raw values and passes them through; this file decides what they
 * mean. One implementation, one place to test, and the page script — which is
 * inlined into the site's own script.js — stays small.
 *
 * Plain ESM, imported unchanged by the Deno edge runtime and the Node test
 * runner, same as rollup.js.
 */

/**
 * The canonical vocabulary. PorchLight generates links against this list.
 *
 * Unknown values are never silently accepted and never silently dropped: they
 * are kept verbatim and flagged, so a typo shows up as a typo on the dashboard
 * instead of quietly becoming "other" and taking its traffic with it.
 */
export const SOURCES = [
  'instagram', 'tiktok', 'facebook', 'youtube', 'x', 'bluesky', 'threads',
  'spotify', 'apple_music', 'email', 'sms', 'qr', 'print', 'direct', 'other',
];

export const MEDIUMS = [
  'social', 'paid_social', 'bio', 'email', 'sms', 'referral', 'qr', 'print', 'none',
];

/** Referrer host → source. Longest suffix wins, so m.facebook.com resolves. */
const REFERRER_HOSTS = [
  ['instagram.com', 'instagram'], ['l.instagram.com', 'instagram'],
  ['tiktok.com', 'tiktok'], ['vm.tiktok.com', 'tiktok'],
  ['facebook.com', 'facebook'], ['fb.com', 'facebook'], ['fb.me', 'facebook'],
  ['youtube.com', 'youtube'], ['youtu.be', 'youtube'],
  ['twitter.com', 'x'], ['x.com', 'x'], ['t.co', 'x'],
  ['bsky.app', 'bluesky'], ['bsky.social', 'bluesky'],
  ['threads.net', 'threads'], ['threads.com', 'threads'],
  ['open.spotify.com', 'spotify'], ['spotify.com', 'spotify'],
  ['music.apple.com', 'apple_music'],
  ['google.com', 'other'], ['bing.com', 'other'], ['duckduckgo.com', 'other'],
];

/**
 * Platform click ids, used only when there is no UTM and no usable referrer.
 *
 * In-app browsers on Instagram and TikTok routinely strip the referrer, which
 * is exactly the traffic we most want to attribute, so these are worth reading.
 * They are a weaker signal than a UTM and are labelled as such.
 */
const CLICK_IDS = [
  ['igshid', 'instagram'], ['igsh', 'instagram'],
  ['ttclid', 'tiktok'], ['tt_medium', 'tiktok'],
  ['fbclid', 'facebook'],
  ['twclid', 'x'],
  ['gclid', 'other'], ['msclkid', 'other'],
];

/** Outbound destination host → streaming service. */
const SERVICES = [
  ['open.spotify.com', 'spotify'], ['spotify.com', 'spotify'],
  ['music.apple.com', 'apple_music'], ['itunes.apple.com', 'apple_music'],
  ['youtube.com', 'youtube'], ['youtu.be', 'youtube'], ['music.youtube.com', 'youtube'],
  ['deezer.com', 'deezer'],
  ['music.amazon.com', 'amazon_music'], ['amazon.com', 'amazon_music'],
  ['tidal.com', 'tidal'],
  ['soundcloud.com', 'soundcloud'],
  ['bandcamp.com', 'bandcamp'],
  ['pandora.com', 'pandora'],
];

/** Which outbound services count as listening intent rather than a social follow. */
export const STREAMING_SERVICES = new Set([
  'spotify', 'apple_music', 'youtube', 'deezer', 'amazon_music', 'tidal',
  'soundcloud', 'bandcamp', 'pandora',
]);

const SOCIAL_HOSTS = [
  ['instagram.com', 'instagram'], ['tiktok.com', 'tiktok'], ['facebook.com', 'facebook'],
  ['x.com', 'x'], ['twitter.com', 'x'], ['bsky.app', 'bluesky'], ['threads.net', 'threads'],
];

/** Lowercase, trim, collapse separators. Values are compared normalised. */
export function normaliseToken(value, max = 64) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._\-]/g, '');
  return v ? v.slice(0, max) : null;
}

function matchHost(host, table) {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  let best = null;
  for (const [suffix, value] of table) {
    if (h === suffix || h.endsWith('.' + suffix)) {
      if (!best || suffix.length > best[0].length) best = [suffix, value];
    }
  }
  return best ? best[1] : null;
}

function hostOf(url) {
  if (typeof url !== 'string' || !url) return null;
  try { return new URL(url).hostname; } catch { return null; }
}

/**
 * Decide where a session came from.
 *
 * Precedence is utm > click id > referrer > direct, strongest signal first.
 * `basis` records which one was used, because "we know because the link was
 * tagged" and "we guessed from a referrer" are different claims and the
 * dashboard shows them differently.
 *
 * @param raw  what the page captured: {s,m,c,ct,t,r,cid}
 * @param siteHost the site's own hostname, so self-referrals read as direct
 */
export function classifyAttribution(raw, siteHost) {
  const a = raw ?? {};
  const utmSource = normaliseToken(a.s);
  const utmMedium = normaliseToken(a.m);
  const campaign = normaliseToken(a.c, 80);
  const content = normaliseToken(a.ct, 80);
  const term = normaliseToken(a.t, 80);

  const refHost = hostOf(a.r);
  const selfReferral = refHost && siteHost &&
    refHost.replace(/^www\./, '') === String(siteHost).replace(/^www\./, '');

  if (utmSource) {
    return {
      source: utmSource,
      medium: utmMedium ?? 'none',
      campaign, content, term,
      basis: 'utm',
      known: SOURCES.includes(utmSource) && (!utmMedium || MEDIUMS.includes(utmMedium)),
      refHost: selfReferral ? null : refHost,
    };
  }

  const clickId = normaliseToken(a.cid);
  if (clickId) {
    const fromClick = CLICK_IDS.find(([k]) => k === clickId);
    if (fromClick) {
      return { source: fromClick[1], medium: 'social', campaign, content, term,
               basis: 'clickid', known: true, refHost: selfReferral ? null : refHost };
    }
  }

  if (refHost && !selfReferral) {
    const fromRef = matchHost(refHost, REFERRER_HOSTS);
    return {
      source: fromRef ?? 'other',
      medium: fromRef && fromRef !== 'other' ? 'social' : 'referral',
      campaign, content, term,
      basis: 'referrer',
      known: true,
      refHost,
    };
  }

  return { source: 'direct', medium: 'none', campaign, content, term,
           basis: 'direct', known: true, refHost: null };
}

/** Classify an outbound destination. */
export function classifyOutbound(host, path) {
  const service = matchHost(host, SERVICES);
  const social = matchHost(host, SOCIAL_HOSTS);
  return {
    host: typeof host === 'string' ? host.toLowerCase().slice(0, 120) : null,
    path: typeof path === 'string' ? path.slice(0, 200) : null,
    service: service ?? (social ? social : 'other'),
    kind: service ? (STREAMING_SERVICES.has(service) ? 'streaming' : 'other')
        : social ? 'social' : 'other',
  };
}

/** `source / medium`, the pair the sources table is keyed by. */
export function sourceKey(attr) {
  const a = attr ?? {};
  return `${a.source ?? 'direct'} / ${a.medium ?? 'none'}`;
}

/**
 * `campaign / content`, the pair that distinguishes one post from another.
 * Untagged traffic groups under a single explicit label rather than being
 * scattered across blank keys.
 */
export function campaignKey(attr) {
  const a = attr ?? {};
  if (!a.campaign && !a.content) return '(untagged)';
  return `${a.campaign ?? '(none)'} / ${a.content ?? '(none)'}`;
}
