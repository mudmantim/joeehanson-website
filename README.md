# joeehanson.com

**A porch light left on in the dark.**

---

## Philosophy

This is not a normal artist website.

It's a quiet place. The kind someone visits at midnight with headphones on, when they need to feel less alone. It doesn't sell anything. It doesn't demand attention. It just stays on — the way a porch light stays on when there's no one home yet.

The design choices follow from that feeling:

- **Deep black.** Not dramatic black. Just dark, the way a room is dark at 2 AM.
- **Warm amber.** One light source. A single glow. The porch light.
- **Faded cream.** Text that's been read before. Words that don't shout.
- **Slow fades.** Nothing snaps into place. Everything arrives the way a memory does.
- **Empty space.** What's not there matters as much as what is.

The site should feel like an album cover became a webpage and forgot to be a webpage.

---

## Structure

```
/
├── index.html          — single page, all sections
├── style.css           — design system, mobile-first
├── script.js           — data loading, scroll reveals, PWA install
├── manifest.json       — PWA manifest
├── sw.js               — service worker (cache-first)
├── data/
│   ├── releases.json   — music releases (featured song first)
│   ├── fragments.json  — short timeless observations
│   └── socials.json    — platform links
└── assets/
    └── images/         — album art and photography
```

**Sections, in order:**

1. **Hero** — name, tagline, Listen / Watch
2. **Featured Song** — current focus, Spotify + YouTube primary
3. **Music** — back catalog, all linking to Spotify artist page
4. **About** — two sentences. That's enough.
5. **Fragments** — short timeless observations. Not quotes. Not lyrics. Just things.
6. **Take it with you** — PWA install, porch light behind the words
7. **Footer** — Spotify, YouTube, Instagram, TikTok, Facebook

---

## Tech

- Static HTML / CSS / JS. No build step. No framework.
- [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) via Google Fonts.
- Mobile-first. Works without JavaScript (structure remains).
- PWA: installable, service worker caches all assets for offline use.
- JSON data files — update content without touching markup.

---

## Running locally

```bash
python3 -m http.server 8743
# open http://localhost:8743
```

Or any static file server. No build required.

---

## Updating content

**To change the featured song** — edit `data/releases.json`, first entry.

**To add a release** — append to `data/releases.json`. The first item is always the featured song; the rest populate the Music section.

**To update fragments** — edit `data/fragments.json`. Keep them short. Keep them timeless. No names. No specific places. Just the thing that's true.

**To update social links** — edit `data/socials.json`.

---

## Images

| File | Used as |
|---|---|
| `110.png` | Hero background (wide performance scene) |
| `109.webp` | Featured song / About portrait (performer silhouette) |
| `104.png` | *Fourteen Years* album cover |
| `123.png` | *When I'm Gone* album cover |
| `126.jpg` | *The Man Under the Ash* album cover |
| `111.webp` | PWA section background (porch lantern) |

---

## Deploying

Drop the directory on any static host — Netlify, Vercel, GitHub Pages, Cloudflare Pages. No server required.

For PWA to work, the site must be served over HTTPS.

---

*"The porch light was still on."*
