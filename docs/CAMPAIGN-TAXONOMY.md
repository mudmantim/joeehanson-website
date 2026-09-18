# Campaign taxonomy

The shared vocabulary for tagging links to joeehanson.com. PorchLight generates
links against this list; the collector validates against it.

This exists so that `tiktok`, `TikTok` and `tik-tok` do not become three rows in
a table that should have one. Values are lowercased and normalised on arrival,
but an unrecognised value is **kept verbatim and flagged**, never silently
folded into "other" — a typo should look like a typo on the dashboard, not
quietly take its traffic somewhere else.

Canonical list in code: `netlify/lib/attribution.js`.

---

## The five parameters

| Parameter | Answers | Example |
|---|---|---|
| `utm_source` | Which platform | `tiktok` |
| `utm_medium` | What kind of placement | `social` |
| `utm_campaign` | Which push | `hmha-launch` |
| `utm_content` | **Which individual post** | `sds-clip-01` |
| `utm_term` | Which song | `same-damn-shame` |

`utm_content` is the one that matters most and the one most often left off. It
is what separates the Same Damn Shame TikTok clip from the Same Damn Shame
Instagram post. Without it, both collapse into one row and the question "which
post actually worked" cannot be answered.

## `utm_source`

```
instagram   tiktok   facebook   youtube   x   bluesky   threads
spotify     apple_music
email       sms      qr         print
```

`direct` and `other` are produced by the system; never set them by hand.

Use the platform, not the account or the format. A Reel, a Story and a grid post
are all `instagram` — the format belongs in `utm_content`.

## `utm_medium`

```
social        organic posting
paid_social   anything boosted or behind ad spend
bio           link-in-bio, profile links
email         newsletters
sms           direct messages, texts
qr            printed or on-screen codes
print         physical media with a written URL
referral      produced by the system for unknown referrers
```

Keeping `social` and `paid_social` apart is the only way to ever answer whether
spend did anything.

## `utm_campaign`

Kebab-case, stable for the life of the push. One campaign spans many posts.

```
hmha-launch          the Half Married, Half Alone release
hmha-preorder        anything before release day
hmha-tiktok-q4       a sustained platform-specific push
```

Do not put the platform in the campaign name unless the campaign genuinely only
exists on that platform — `utm_source` already carries it.

## `utm_content`

The individual post. Must be unique within a campaign. Suggested shape:

```
<song-or-subject>-<format>-<nn>
```

```
sds-clip-01          Same Damn Shame, short video, first
sds-post-01          Same Damn Shame, static post, first
hmha-cover-reveal    artwork reveal
weight-lyric-02      The Weight of Staying, lyric card, second
```

Numbering matters. `sds-clip-01` and `sds-clip-02` being separate rows is how
you find out that the second cut outperformed the first.

## `utm_term`

The song, as a slug. Use it whenever a post is about one song, even if the
campaign covers the album — it is what rolls every clip about a song together.

```
im-still-here            I'm Still Here
say-it-back              Say It Back
forgive-yourself         Forgive Yourself
i-dont-know-how-to-do-this   I Don't Know How to Do This
the-ghost-of-the-board   The Ghost of the Board
half-married-half-alone  Half Married, Half Alone
if-i-disappeared-tonight If I Disappeared Tonight
the-weight-of-staying    The Weight of Staying
same-damn-shame          Same Damn Shame
```

## A complete link

```
https://joeehanson.com/?utm_source=tiktok&utm_medium=social
  &utm_campaign=hmha-launch&utm_content=sds-clip-01&utm_term=same-damn-shame
```

The site strips these from the address bar once recorded, so anyone who copies
the URL afterwards shares a clean link rather than one carrying someone else's
campaign tags.

## Why tagging is not optional

Instagram and TikTok in-app browsers routinely strip the referrer. Untagged
traffic from the two platforms that matter most therefore arrives looking like
`direct`, and no amount of cleverness on the receiving end recovers it.

Platform click ids (`igshid`, `ttclid`, `fbclid`) are read as a fallback and
will usually identify the platform — but they say nothing about *which post*,
which is the question worth asking.

**A tagged link is the only way the post is ever known.**

## Rules of thumb

- Tag every link, every time, including bio links and Stories.
- Never invent a source outside the list. Extend the list instead, in
  `netlify/lib/attribution.js` and here, in the same change.
- Never reuse a `utm_content` value for a different post.
- Lowercase, hyphens, no spaces, no punctuation beyond `-` `_` `.`.
- Attribution is per session, so one tagged landing covers everything that
  visitor does afterwards, including clicking through to Spotify.
