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

  const meta = [release.type, release.label, release.year].filter(Boolean).join(' · ');

  // Reuses the catalog track styles. A track without a url renders as plain
  // text — the release links may not exist yet.
  const tracklist = (release.tracks || [])
    .map((t, ti) => {
      const name = t.url
        ? `<a class="catalog__track-link" href="${escape(t.url)}" target="_blank" rel="noopener noreferrer">${escape(t.title)}</a>`
        : `<span class="catalog__track-link catalog__track-link--plain">${escape(t.title)}</span>`;

      return `
          <li class="catalog__track">
            <span class="catalog__track-num" aria-hidden="true">${String(ti + 1).padStart(2, '0')}</span>
            ${name}
          </li>`;
    })
    .join('');

  const player = release.audio
    ? `
      <div class="player">
        <audio class="player__audio" src="${escape(release.audio)}" preload="metadata"></audio>
        <button class="player__toggle" type="button" aria-label="Play">
          <svg class="player__icon player__icon--play" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,4 20,12 6,20"></polygon></svg>
          <svg class="player__icon player__icon--pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16"></rect><rect x="14" y="4" width="5" height="16"></rect></svg>
        </button>
        <div class="player__main">
          <input class="player__seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="Seek">
          <div class="player__time">
            <span class="player__current">0:00</span>
            <span class="player__duration">0:00</span>
          </div>
        </div>
      </div>
    `
    : '';

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
      ${player}
      ${tracklist ? `<ol class="catalog__tracks">${tracklist}</ol>` : ''}
      ${primaryCtas ? `<div class="latest__primary-ctas">${primaryCtas}</div>` : ''}
      ${secondaryLinks ? `<div class="latest__links">${secondaryLinks}</div>` : ''}
    </div>
  `;

  if (release.audio) {
    initPlayer(el.querySelector('.player'));
  }
}

function initPlayer(root) {
  if (!root) return;

  const audio = root.querySelector('.player__audio');
  const toggle = root.querySelector('.player__toggle');
  const seek = root.querySelector('.player__seek');
  const currentEl = root.querySelector('.player__current');
  const durationEl = root.querySelector('.player__duration');
  let seeking = false;

  const formatTime = (sec) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  audio.addEventListener('loadedmetadata', () => {
    seek.max = audio.duration;
    durationEl.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('timeupdate', () => {
    if (!seeking) seek.value = audio.currentTime;
    currentEl.textContent = formatTime(audio.currentTime);
  });

  audio.addEventListener('play', () => {
    root.classList.add('is-playing');
    toggle.setAttribute('aria-label', 'Pause');
  });

  audio.addEventListener('pause', () => {
    root.classList.remove('is-playing');
    toggle.setAttribute('aria-label', 'Play');
  });

  audio.addEventListener('ended', () => {
    root.classList.remove('is-playing');
    toggle.setAttribute('aria-label', 'Play');
    seek.value = 0;
    currentEl.textContent = '0:00';
  });

  toggle.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  seek.addEventListener('input', () => {
    seeking = true;
    currentEl.textContent = formatTime(Number(seek.value));
  });

  seek.addEventListener('change', () => {
    audio.currentTime = Number(seek.value);
    seeking = false;
  });
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

/* ============================================================
   MEASUREMENT

   First-party, cookieless for ordinary visitors. Sends a small
   batch to /api/e: a pageview, periodic engagement heartbeats,
   and a final flush when the page goes away.

   Stores nothing about the visitor beyond one localStorage value
   holding the month they first arrived, which is what answers
   new-versus-returning without creating an identifier.
   ============================================================ */

/* @engagement-core:start
   Pure, dependency-free, and driven entirely by timestamps passed in, so the
   test suite can replay an exact timeline without a browser or a clock.

   The clock runs only while the page is visible AND focused AND there has been
   interaction within idleMs. Backgrounded time is not engagement, and neither
   is a visible tab nobody is looking at. */
function createEngagementTracker(options) {
  var idleMs = (options && options.idleMs) || 60000;
  var engagedMs = 0;
  var runningSince = null;
  var lastActivity = options.now;
  var visible = options.visible !== false;
  var focused = options.focused !== false;

  function stopAt(t) {
    if (runningSince !== null) {
      var d = t - runningSince;
      if (d > 0) engagedMs += d;
      runningSince = null;
    }
  }

  // Commit any engagement that is already settled as of `now`. If the idle
  // deadline passed while the clock was running, engagement stops at the
  // deadline rather than at `now`.
  function settle(now) {
    if (runningSince === null) return;
    var idleAt = lastActivity + idleMs;
    if (now >= idleAt) stopAt(idleAt);
  }

  function maybeStart(now) {
    if (runningSince === null && visible && focused && now - lastActivity < idleMs) {
      runningSince = now;
    }
  }

  // Start counting immediately when the page opens visible and focused.
  // Without this the clock only ever started on the first interaction, so a
  // visitor who read without touching anything registered zero engagement.
  maybeStart(options.now);

  return {
    activity: function (now) {
      settle(now);
      lastActivity = now;
      maybeStart(now);
    },
    setVisible: function (v, now) {
      settle(now);
      if (!v) stopAt(now);
      visible = v;
      if (v) lastActivity = now;
      maybeStart(now);
    },
    setFocused: function (f, now) {
      settle(now);
      if (!f) stopAt(now);
      focused = f;
      if (f) lastActivity = now;
      maybeStart(now);
    },
    read: function (now) {
      settle(now);
      return engagedMs + (runningSince !== null ? Math.max(0, now - runningSince) : 0);
    }
  };
}
/* @engagement-core:end */

/* @session-core:start
   When a session begins, and when the attribution attached to it is stale.
   Pure so the rules can be replayed in tests without a browser. */
function shouldStartNewSession(sid, lastActivity, now, gapMs, taggedLanding) {
  if (!sid) return true;                       // nothing to continue
  if (taggedLanding) return true;              // a campaign link is a new acquisition
  return (now - lastActivity) > gapMs;         // idled out
}

function attributionIsStale(storedAttr, sid) {
  // Attribution belongs to one session. Left unbound it survived for the whole
  // tab, so a visitor who arrived direct and returned hours later through a
  // campaign link kept the old attribution and the campaign got no credit.
  if (!storedAttr) return true;
  return storedAttr.sid !== sid;
}
/* @session-core:end */

(function measurement() {
  var ENDPOINT = '/api/e';
  var HEARTBEAT_MS = 15000;      // of engaged time, not wall time
  var SESSION_GAP_MS = 30 * 60 * 1000;
  var IDLE_MS = 60000;

  var uuid = function () {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  };

  var safe = function (fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  };

  // ---- Attribution parameters present on this URL ------------------------
  var CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CLICK_ID_KEYS = ['igshid', 'igsh', 'ttclid', 'tt_medium', 'fbclid', 'twclid', 'gclid', 'msclkid'];
  var params = new URLSearchParams(location.search);
  var taggedLanding = CAMPAIGN_KEYS.concat(CLICK_ID_KEYS).some(function (key) { return params.has(key); });

  // ---- Session: 30 minutes of inactivity starts a new one ----------------
  // A tagged landing also starts one. Arriving on a campaign link is a new
  // acquisition even if the tab was already open, and without this the
  // engagement from whatever the visitor was doing beforehand would be
  // credited to the campaign.
  var now = Date.now();
  var sid = safe(function () { return sessionStorage.getItem('jh_sid'); }, null);
  var last = Number(safe(function () { return sessionStorage.getItem('jh_last'); }, 0)) || 0;
  if (shouldStartNewSession(sid, last, now, SESSION_GAP_MS, taggedLanding)) sid = uuid();
  var touch = function () {
    safe(function () {
      sessionStorage.setItem('jh_sid', sid);
      sessionStorage.setItem('jh_last', String(Date.now()));
    });
  };
  touch();

  // ---- Attribution: captured once, at the start of a session -------------
  // Session-scoped on purpose. A visitor lands on a tagged link, reads for a
  // while, then clicks through to Spotify -- and that click has to be
  // attributable to the post that brought them. Per-pageview attribution would
  // lose it, which is the whole question this is here to answer.
  //
  // Only raw values are captured. Deciding what they mean happens on the
  // server, so there is one implementation of that logic and it is tested.
  // Attribution is bound to the session it was captured for. Without that
  // binding it survived for the whole tab: a visitor who arrived direct in the
  // morning and came back through a campaign link in the afternoon started a
  // new session but kept the old attribution, so the campaign got no credit
  // and the visit read as direct.
  var attr = null;
  try { attr = JSON.parse(sessionStorage.getItem('jh_attr') || 'null'); } catch (e) { attr = null; }
  if (attributionIsStale(attr, sid)) attr = null;

  if (!attr) {
    var clickId = null;
    for (var ci = 0; ci < CLICK_ID_KEYS.length; ci++) {
      if (params.has(CLICK_ID_KEYS[ci])) { clickId = CLICK_ID_KEYS[ci]; break; }
    }
    attr = {
      sid: sid,
      s: params.get('utm_source'), m: params.get('utm_medium'),
      c: params.get('utm_campaign'), ct: params.get('utm_content'),
      t: params.get('utm_term'), r: document.referrer || '', cid: clickId
    };
    safe(function () { sessionStorage.setItem('jh_attr', JSON.stringify(attr)); });

    // Take the campaign parameters out of the address bar once they are
    // recorded. Someone sharing the URL then shares a clean link rather than
    // one carrying another person's campaign tags, and the bar stays quiet,
    // which this site cares about.
    safe(function () {
      var dirty = false;
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
        .concat(CLICK_ID_KEYS)
        .forEach(function (k) { if (params.has(k)) { params.delete(k); dirty = true; } });
      if (dirty && history.replaceState) {
        var q = params.toString();
        history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
      }
    });
  }

  // ---- New vs returning, without an identifier ---------------------------
  var month = new Date().toISOString().slice(0, 7);
  var firstSeen = safe(function () { return localStorage.getItem('jh_fs'); }, null);
  var isNew = !firstSeen;
  if (!firstSeen) safe(function () { localStorage.setItem('jh_fs', month); });

  var tracker = createEngagementTracker({
    now: now,
    visible: document.visibilityState === 'visible',
    focused: document.hasFocus()
  });

  var queue = [];
  var sentEngagedMs = 0;
  var pageviews = 0;

  function enqueue(type, extra) {
    var e = {
      eid: uuid(),
      sid: sid,
      t: type,
      ts: Date.now(),
      path: location.pathname,
      eng_ms: tracker.read(Date.now()),
      pv: pageviews
    };
    if (extra) for (var k in extra) e[k] = extra[k];
    queue.push(e);
  }

  function send(useBeacon) {
    if (!queue.length) return;
    var payload = JSON.stringify({
      events: queue.splice(0, queue.length),
      ref: document.referrer || '',
      attr: attr,
      new: isNew,
      wd: navigator.webdriver === true
    });
    touch();

    // sendBeacon is fire-and-forget: it does not block navigation and it
    // survives the page being torn down, which is the whole reason the final
    // flush happens on pagehide rather than beforeunload.
    if (useBeacon && navigator.sendBeacon) {
      var ok = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'text/plain' }));
      if (ok) return;
    }
    safe(function () {
      fetch(ENDPOINT, { method: 'POST', body: payload, keepalive: true, headers: { 'content-type': 'application/json' } });
    });
  }

  // ---- Pageview ----------------------------------------------------------
  pageviews = 1;
  enqueue('pv');
  send(false);

  // ---- Activity signals --------------------------------------------------
  var lastMove = 0;
  function activity() {
    var t = Date.now();
    if (t - lastMove < 1000) return;   // throttle pointermove
    lastMove = t;
    tracker.activity(t);
  }
  ['scroll', 'pointerdown', 'keydown', 'touchstart', 'pointermove'].forEach(function (ev) {
    addEventListener(ev, activity, { passive: true });
  });

  addEventListener('visibilitychange', function () {
    var visible = document.visibilityState === 'visible';
    tracker.setVisible(visible, Date.now());
    if (!visible) { enqueue('eng'); send(true); }
  });
  addEventListener('blur', function () { tracker.setFocused(false, Date.now()); });
  addEventListener('focus', function () { tracker.setFocused(true, Date.now()); });

  // ---- Heartbeat: every 15s of *engaged* time ----------------------------
  // Without this an abandoned session would record nothing, because the final
  // flush never arrives when a laptop lid closes.
  setInterval(function () {
    var engaged = tracker.read(Date.now());
    if (engaged - sentEngagedMs >= HEARTBEAT_MS) {
      sentEngagedMs = engaged;
      enqueue('eng');
      send(true);
    }
  }, 5000);

  // ---- Outbound clicks ---------------------------------------------------
  // sendBeacon is fire-and-forget: it does not delay or cancel the navigation.
  // Deliberately NOT preventDefault-then-navigate, which breaks cmd-click and
  // middle-click and makes every outbound link feel slower.
  function onOutbound(e) {
    var el = e.target;
    var a = el && el.closest ? el.closest('a[href]') : null;
    if (!a) return;
    var u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (!/^https?:$/.test(u.protocol) || u.host === location.host) return;

    enqueue('out', { out: { host: u.host, path: u.pathname } });
    send(true);
  }
  addEventListener('click', onOutbound, true);
  addEventListener('auxclick', onOutbound, true);   // middle-click opens a tab too

  // ---- Final flush -------------------------------------------------------
  addEventListener('pagehide', function () {
    enqueue('end');
    send(true);
  });
})();
