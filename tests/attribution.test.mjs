/**
 * Attribution correctness.
 *
 * These decide which social platform and which PorchLight post gets credit for
 * a visit, so a wrong answer here is a wrong answer about where Joe's audience
 * actually comes from.
 */

import {
  classifyAttribution, classifyOutbound, normaliseToken, sourceKey, campaignKey,
  SOURCES, MEDIUMS, STREAMING_SERVICES,
} from '../netlify/lib/attribution.js';

const HOST = 'joeehanson.com';
const at = (raw) => classifyAttribution(raw, HOST);

export default function run(t) {
  // ------------------------------------------------------------- tokens ----
  t.equal(normaliseToken('  TikTok  '), 'tiktok', 'tokens are trimmed and lowercased');
  t.equal(normaliseToken('Same Damn Shame'), 'same-damn-shame', 'spaces become hyphens');
  t.equal(normaliseToken('sds<script>'), 'sdsscript', 'unsafe characters are stripped');
  t.equal(normaliseToken(''), null, 'an empty string is null, not an empty token');
  t.equal(normaliseToken(null), null, 'null stays null');
  t.equal(normaliseToken(123), null, 'a non-string is null');
  t.equal(normaliseToken('a'.repeat(200)).length, 64, 'tokens are length-capped');

  // ---------------------------------------------------------------- utm ----
  {
    const a = at({ s: 'tiktok', m: 'social', c: 'hmha-launch', ct: 'sds-clip-01', t: 'same-damn-shame' });
    t.equal(a.source, 'tiktok', 'utm_source wins');
    t.equal(a.medium, 'social', 'utm_medium carried');
    t.equal(a.campaign, 'hmha-launch', 'campaign carried');
    t.equal(a.content, 'sds-clip-01', 'content carried — this is what separates one post from another');
    t.equal(a.term, 'same-damn-shame', 'term carries the song');
    t.equal(a.basis, 'utm', 'basis records that the link was tagged');
    t.ok(a.known, 'a vocabulary source is marked known');
  }
  {
    // A tagged link beats the referrer it arrived with.
    const a = at({ s: 'instagram', m: 'social', r: 'https://t.co/abc' });
    t.equal(a.source, 'instagram', 'utm beats referrer');
    t.equal(a.basis, 'utm', 'and the basis says so');
  }
  {
    const a = at({ s: 'TikTok', m: 'Social' });
    t.equal(a.source, 'tiktok', 'utm values are normalised');
    t.equal(a.medium, 'social', 'medium normalised too');
  }
  {
    // A typo must be visible as a typo, not silently folded into "other".
    const a = at({ s: 'tik-tok', m: 'social' });
    t.equal(a.source, 'tik-tok', 'an unknown source is kept verbatim');
    t.ok(!a.known, 'and flagged as outside the vocabulary');
  }
  {
    const a = at({ s: 'tiktok' });
    t.equal(a.medium, 'none', 'a source with no medium gets an explicit none');
  }

  // ----------------------------------------------------------- click ids ---
  {
    const a = at({ cid: 'igshid', r: '' });
    t.equal(a.source, 'instagram', 'an Instagram click id attributes when nothing else can');
    t.equal(a.basis, 'clickid', 'basis records the weaker signal');
    t.equal(a.medium, 'social', 'click ids imply social');
  }
  t.equal(at({ cid: 'ttclid' }).source, 'tiktok', 'TikTok click id');
  t.equal(at({ cid: 'fbclid' }).source, 'facebook', 'Facebook click id');
  {
    const a = at({ s: 'youtube', cid: 'fbclid' });
    t.equal(a.source, 'youtube', 'a utm outranks a click id');
  }
  t.equal(at({ cid: 'not-a-real-click-id' }).source, 'direct',
    'an unrecognised click id does not invent a source');

  // ----------------------------------------------------------- referrer ---
  t.equal(at({ r: 'https://www.instagram.com/p/x' }).source, 'instagram', 'instagram referrer');
  t.equal(at({ r: 'https://l.instagram.com/?u=x' }).source, 'instagram', "instagram's link shim");
  t.equal(at({ r: 'https://m.facebook.com/' }).source, 'facebook', 'facebook subdomain');
  t.equal(at({ r: 'https://t.co/abc' }).source, 'x', "x's link shortener");
  t.equal(at({ r: 'https://vm.tiktok.com/abc' }).source, 'tiktok', 'tiktok short domain');
  t.equal(at({ r: 'https://bsky.app/profile/x' }).source, 'bluesky', 'bluesky');
  t.equal(at({ r: 'https://youtu.be/abc' }).source, 'youtube', 'youtube short domain');
  {
    const a = at({ r: 'https://www.instagram.com/p/x' });
    t.equal(a.basis, 'referrer', 'basis records that this was inferred');
    t.equal(a.medium, 'social', 'a known social referrer implies social');
  }
  {
    const a = at({ r: 'https://some-blog.example/post' });
    t.equal(a.source, 'other', 'an unknown referrer is other');
    t.equal(a.medium, 'referral', 'and referral, not social');
    t.equal(a.refHost, 'some-blog.example', 'the host is kept for inspection');
  }

  // ------------------------------------------------------ self and direct --
  {
    const a = at({ r: 'https://joeehanson.com/' });
    t.equal(a.source, 'direct', 'a self-referral is direct, not a referral from ourselves');
    t.equal(a.refHost, null, 'and the self-referrer host is dropped');
  }
  t.equal(at({ r: 'https://www.joeehanson.com/' }).source, 'direct', 'www self-referral too');
  t.equal(at({}).source, 'direct', 'nothing at all is direct');
  t.equal(at({}).basis, 'direct', 'basis direct');
  t.equal(at(null).source, 'direct', 'null input does not throw');
  t.equal(at({ r: 'not a url' }).source, 'direct', 'an unparseable referrer is direct');
  {
    // The in-app-browser case: no referrer, but the link was tagged.
    const a = at({ s: 'instagram', m: 'social', c: 'hmha-launch', ct: 'sds-post-01', r: '' });
    t.equal(a.source, 'instagram', 'a tagged link survives a stripped referrer');
    t.equal(a.content, 'sds-post-01', 'and still identifies the post');
  }

  // ----------------------------------------------------------- outbound ---
  {
    const o = classifyOutbound('open.spotify.com', '/track/abc');
    t.equal(o.service, 'spotify', 'spotify recognised');
    t.equal(o.kind, 'streaming', 'spotify counts as listening intent');
    t.equal(o.path, '/track/abc', 'track path kept — it is a public url, not personal data');
  }
  t.equal(classifyOutbound('music.apple.com', '/us/album/x').service, 'apple_music', 'apple music');
  t.equal(classifyOutbound('youtu.be', '/abc').service, 'youtube', 'youtube short link');
  t.equal(classifyOutbound('www.deezer.com', '/album/1').service, 'deezer', 'deezer with www');
  t.equal(classifyOutbound('bandcamp.com', '/').kind, 'streaming', 'bandcamp counts as intent');
  {
    const o = classifyOutbound('www.instagram.com', '/joeehansonmusic');
    t.equal(o.service, 'instagram', 'a social destination is identified');
    t.equal(o.kind, 'social', 'but is not listening intent');
  }
  {
    const o = classifyOutbound('example.com', '/');
    t.equal(o.service, 'other', 'unknown destination');
    t.equal(o.kind, 'other', 'and not counted as intent');
  }
  t.equal(classifyOutbound(null, null).service, 'other', 'null host does not throw');
  t.ok(STREAMING_SERVICES.has('spotify') && !STREAMING_SERVICES.has('instagram'),
    'the streaming set excludes social follows');

  // --------------------------------------------------------------- keys ---
  t.equal(sourceKey({ source: 'tiktok', medium: 'social' }), 'tiktok / social', 'source key');
  t.equal(sourceKey({}), 'direct / none', 'source key defaults');
  t.equal(campaignKey({ campaign: 'hmha-launch', content: 'sds-clip-01' }),
    'hmha-launch / sds-clip-01', 'campaign key');
  t.equal(campaignKey({}), '(untagged)', 'untagged traffic groups under one explicit label');
  t.equal(campaignKey({ campaign: 'hmha-launch' }), 'hmha-launch / (none)',
    'a campaign with no content still separates from untagged');

  // -------------------------------------------------------- vocabulary ----
  for (const s of ['instagram', 'tiktok', 'facebook', 'youtube', 'x', 'bluesky', 'threads']) {
    t.ok(SOURCES.includes(s), `the vocabulary covers ${s}`);
  }
  t.ok(MEDIUMS.includes('social') && MEDIUMS.includes('paid_social'), 'mediums cover organic and paid social');
}
