/* ============================================================
   INTERSECTION OBSERVER — reveal on scroll
   ============================================================ */

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
);

function observeAll(root = document) {
  root.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
}

observeAll();

/* ============================================================
   DATA — fetch and render
   ============================================================ */

async function loadData() {
  try {
    const [releases, fragments, socials] = await Promise.all([
      fetch('data/releases.json').then((r) => r.json()),
      fetch('data/fragments.json').then((r) => r.json()),
      fetch('data/socials.json').then((r) => r.json()),
    ]);

    renderLatest(releases[0]);
    renderMusic(releases.slice(1));
    renderFragments(fragments);
    renderSocials(socials);
  } catch (err) {
    console.warn('Could not load site data:', err);
  }
}

function renderLatest(release) {
  if (!release) return;
  const el = document.getElementById('latest-content');
  if (!el) return;

  const primaryCtas = [
    release.spotify
      ? `<a class="latest__cta latest__cta--listen" href="${escape(release.spotify)}" target="_blank" rel="noopener noreferrer">Listen on Spotify</a>`
      : '',
    release.youtube
      ? `<a class="latest__cta latest__cta--watch" href="${escape(release.youtube)}" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>`
      : '',
  ].filter(Boolean).join('');

  const secondaryLinks = release.links
    ? Object.entries(release.links)
        .map(([platform, url]) =>
          `<a class="latest__link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(platform)}</a>`
        )
        .join('')
    : '';

  const meta = [release.year, release.type].filter(Boolean).join(' · ');

  el.innerHTML = `
    <img
      class="latest__art"
      src="${escape(release.image)}"
      alt="${escape(release.title)}"
      loading="eager"
    >
    <div class="latest__info">
      <h2 class="latest__title">${escape(release.title)}</h2>
      ${meta ? `<p class="latest__meta">${escape(meta)}</p>` : ''}
      ${release.description ? `<p class="latest__desc">${escape(release.description)}</p>` : ''}
      ${primaryCtas ? `<div class="latest__primary-ctas">${primaryCtas}</div>` : ''}
      ${secondaryLinks ? `<div class="latest__links">${secondaryLinks}</div>` : ''}
    </div>
  `;
}

function renderMusic(releases) {
  const grid = document.getElementById('music-grid');
  if (!grid) return;

  grid.innerHTML = releases
    .map((r, i) => {
      const tracklist = (r.tracks || [])
        .map((t, ti) => `
          <li class="catalog__track">
            <span class="catalog__track-num" aria-hidden="true">${String(ti + 1).padStart(2, '0')}</span>
            <a class="catalog__track-link" href="${escape(t.url)}" target="_blank" rel="noopener noreferrer">${escape(t.title)}</a>
          </li>`)
        .join('');

      return `
        <article class="catalog__album reveal" style="--d:${(i * 0.14).toFixed(2)}s">
          <a class="catalog__art-wrap" href="${escape(r.spotify)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
            <img class="catalog__art" src="${escape(r.image)}" alt="${escape(r.title)}" loading="lazy">
          </a>
          <div class="catalog__detail">
            <h3 class="catalog__album-title">
              <a href="${escape(r.spotify)}" target="_blank" rel="noopener noreferrer">${escape(r.title)}</a>
            </h3>
            ${tracklist ? `<ol class="catalog__tracks">${tracklist}</ol>` : ''}
            <a class="catalog__cta" href="${escape(r.spotify)}" target="_blank" rel="noopener noreferrer">Listen on Spotify &nbsp;&rarr;</a>
          </div>
        </article>`;
    })
    .join('');

  observeAll(grid);
}

function renderFragments(fragments) {
  const list = document.getElementById('fragments-list');
  if (!list) return;

  list.innerHTML = fragments
    .map(
      (f, i) => `
    <div class="fragment reveal" style="--d:${(i * 0.14).toFixed(2)}s">
      <span class="fragment__dot" aria-hidden="true"></span>
      <p class="fragment__text">&ldquo;${escape(f.text)}&rdquo;</p>
      <span class="fragment__time">${escape(f.date)}</span>
    </div>
  `
    )
    .join('');

  observeAll(list);
}

function renderSocials(socials) {
  const el = document.getElementById('footer-socials');
  if (!el) return;

  el.innerHTML = socials
    .map(
      (s) =>
        `<a class="footer__social" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.platform)}</a>`
    )
    .join('');
}

/* ============================================================
   UTILITY — minimal HTML escape for data values
   ============================================================ */

function escape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   YEAR
   ============================================================ */

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ============================================================
   PWA — install prompt
   ============================================================ */

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('pwa-install');
  if (btn) btn.hidden = false;
});

const installBtn = document.getElementById('pwa-install');
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installBtn.hidden = true;
      const sub = document.getElementById('pwa-installed');
      if (sub) sub.hidden = false;
    }
    deferredPrompt = null;
  });
}

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('pwa-install');
  if (btn) btn.hidden = true;
  const sub = document.getElementById('pwa-installed');
  if (sub) sub.hidden = false;
});

/* ============================================================
   SERVICE WORKER
   ============================================================ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

/* ============================================================
   INIT
   ============================================================ */

loadData();
