/**
 * Markup for the private dashboard.
 *
 * Lives here rather than under public/ so the pages exist only as a response
 * from an authenticated function — there is no file to leak.
 *
 * Phase 1 deliberately favours verifiability over polish: every number is raw
 * and every claim on the page is something the API actually returns.
 */

const SHELL = `
  :root{--black:#080807;--charcoal:#101010;--mid:#181815;--line:#2c2820;
        --amber:#c87941;--cream:#d5caa8;--dim:#9a8d6e;
        --font:'Cormorant Garamond',Georgia,serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--black);color:var(--cream);font-family:var(--font);
       padding:2rem 1.5rem;line-height:1.6;max-width:1000px;margin:0 auto}
  h1{font-weight:300;font-size:1.8rem;letter-spacing:.02em;margin-bottom:.2rem}
  .sub{color:var(--dim);font-size:.75rem;letter-spacing:.3em;text-transform:uppercase;margin-bottom:2rem}
  .row{display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem}
  .tile{background:var(--charcoal);border:1px solid var(--line);padding:1rem 1.2rem;min-width:150px;flex:1}
  .tile b{display:block;font-size:1.9rem;font-weight:300;color:var(--cream)}
  .tile span{font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:var(--dim)}
  .card{background:var(--charcoal);border:1px solid var(--line);padding:1.2rem;margin-bottom:1.5rem}
  .ok{color:#7fa86a}.no{color:var(--amber)}
  button,input{font-family:var(--font);font-size:.95rem}
  button{background:transparent;border:1px solid var(--amber);color:var(--amber);
         padding:.5rem 1rem;cursor:pointer;letter-spacing:.1em}
  button:hover{background:rgba(200,121,65,.1)}
  input[type=password]{background:var(--mid);border:1px solid var(--line);color:var(--cream);padding:.6rem .8rem;width:100%}
  .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{width:100%;border-collapse:collapse;font-size:.9rem;min-width:20rem}
  /* Horizontal padding is load-bearing, not decoration. With padding:.4rem 0 a
     narrow screen renders "direct / none20" and a header reading
     "ENGAGEDSTREAMING": the columns never overflow, they just compress until
     they touch, so nothing that measures overflow can detect it. */
  th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
  th:first-child,td:first-child{padding-left:0}
  th:last-child,td:last-child{padding-right:0}
  th:not(:first-child),td:not(:first-child){text-align:right;white-space:nowrap}
  td:first-child{overflow-wrap:anywhere}
  th{font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);font-weight:400}
  pre{background:var(--mid);border:1px solid var(--line);padding:1rem;overflow:auto;
      font-size:.75rem;font-family:ui-monospace,monospace;color:var(--dim);line-height:1.5}
  .note{font-size:.8rem;color:var(--dim);font-style:italic}

  /* ---- Phone ------------------------------------------------------------
     Most of this is ordinary tightening. The table rule is not: below 560px
     each row becomes a block with its label on its own line and every figure
     carrying its own heading, because five columns of text cannot share 360px
     minus padding without colliding, and a horizontally scrolling table hides
     the very columns worth reading. Headings come from data-l on each cell, so
     a row is readable without the header it no longer sits under. */
  @media (max-width:640px){
    body{padding:1.25rem 1rem}
    h1{font-size:1.5rem}
    .sub{margin-bottom:1.25rem;letter-spacing:.22em}
    .row{gap:.6rem}
    .tile{flex:1 1 calc(50% - .3rem);min-width:calc(50% - .3rem);padding:.8rem .9rem}
    .tile b{font-size:1.5rem}
    .tile span{font-size:.56rem;letter-spacing:.18em}
    .card{padding:1rem .9rem}
    pre{font-size:.7rem}
    /* Everything you tap is a filter, and a filter that is hard to hit is a
       filter you stop using. 42px is roughly a fingertip. */
    button{min-height:42px}
    .ranges button{padding:.5rem .9rem}
    .ranges input[type=date]{min-height:42px;flex:1 1 8.5rem;min-width:0}
    .ranges{gap:.45rem}
  }
  @media (max-width:560px){
    .tw{overflow-x:visible}
    .tw table,.tw tbody,.tw tr,.tw td{display:block;width:auto}
    .tw thead{position:absolute;left:-9999px}
    .tw table{min-width:0}
    .tw tr{border-bottom:1px solid var(--line);padding:.65rem 0}
    .tw tr:last-child{border-bottom:0}
    .tw td{border:0;padding:0;text-align:left;white-space:normal}
    .tw td:first-child{font-size:.95rem;color:var(--cream);margin-bottom:.4rem}
    .tw td:not(:first-child){display:inline-block;margin:0 1.15rem .1rem 0;font-size:.82rem}
    .tw td:not(:first-child):last-child{margin-right:0}
    .tw td:not(:first-child)::before{content:attr(data-l) " ";color:var(--dim);
      font-size:.55rem;letter-spacing:.14em;text-transform:uppercase;margin-right:.35rem}
  }
`;

/**
 * The head that makes /admin installable, and nothing else.
 *
 * It appears on the sign-in page as well as the dashboard so that a session
 * expiring inside the installed app does not leave Android looking at a
 * document with no manifest.
 */
/**
 * Whether this page may present itself as an installable app depends entirely
 * on which hostname served it.
 *
 * On admin.joeehanson.com it is the only app on the origin, so it installs
 * normally. On joeehanson.com/admin it must not, and the reason is worth
 * keeping: the public app claims the scope https://joeehanson.com/ -- the
 * whole origin -- so a manifest served underneath it was repeatedly adopted by
 * the music app, which then opened the dashboard instead of the music site. It
 * happened twice on a real phone. Meanwhile the dashboard was never offered an
 * install prompt of its own, because Chrome does not offer one for an inner
 * app while the outer one is installed.
 *
 * Same page, same path, two different answers, decided by host.
 */
const INSTALLABLE_HEAD = `
<link rel="manifest" href="/admin/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/icons/admin-180.png">
<link rel="icon" href="/assets/icons/admin-192.png" type="image/png">
<meta name="theme-color" content="#0f0f0e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="Measurement">`;

const PLAIN_HEAD = `
<link rel="icon" href="/assets/icons/admin-192.png" type="image/png">`;

/** Android will not mint a separate app without a worker. It caches nothing. */
const REGISTER_SW = `<script>
if ('serviceWorker' in navigator) {
  addEventListener('load', function () {
    navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin' }).catch(function () {});
  });
}
</script>`;

/**
 * Undo the worker the apex used to register.
 *
 * Two things this must not do. It must not touch the registration at scope
 * "/" -- that is the public music site's worker, which precaches the site and
 * has no part in this. And it must not clear storage: unregister() removes a
 * worker without touching cookies, localStorage or Cache Storage, and Cache
 * Storage is per-origin, so deleting from it here would take the music site's
 * precache with it. Nobody has to clear anything.
 */
const UNREGISTER_SW = `<script>
if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
  addEventListener('load', function () {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) {
        var scope = new URL(r.scope).pathname;
        if (scope === '/admin' || scope.indexOf('/admin/') === 0) r.unregister();
      });
    }).catch(function () {});
  });
}
</script>`;

const pwaHead = (adminHost: boolean) => (adminHost ? INSTALLABLE_HEAD : PLAIN_HEAD);
const pwaScript = (adminHost: boolean) => (adminHost ? REGISTER_SW : UNREGISTER_SW);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The exclusion status strip, drawn by whichever origin holds the cookie.
 *
 * It lives here rather than in the edge function because it is presentation,
 * and because a claim this load-bearing should be testable without a network.
 */
export function ownerBadge(colour: string, label: string, note: string): string {
  // Two tspans in one text element, so the note simply follows the label.
  // Positioning the note by hand -- x = label.length * 8.6 -- put "expires
  // 2027-09-19" on top of "EXCLUDED" the first time this was rendered: glyph
  // widths are not a function of character count in a proportional serif.
  //
  // The tick is an XML entity rather than a literal, so the mark survives any
  // encoding confusion between here, the HTTP layer and the img tag.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="20" viewBox="0 0 440 20" role="img" aria-label="${escapeHtml(label)}. ${escapeHtml(note)}">
  <text x="0" y="15" font-family="Cormorant Garamond,Georgia,serif" font-size="15">
    <tspan fill="${escapeHtml(colour)}">${escapeHtml(label)}</tspan>
    <tspan fill="#9a8d6e" font-size="12.5" font-style="italic" dx="11">${escapeHtml(note)}</tspan>
  </text>
</svg>`;
}

export function renderLogin(error?: string, adminHost = false): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Sign in</title>${pwaHead(adminHost)}<style>${SHELL}
body{max-width:340px;padding-top:12vh}</style></head><body>
<h1>Sign in</h1><p class="sub">joeehanson.com</p>
${error ? `<p class="no" style="margin-bottom:1rem">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/api/login">
  <input type="password" name="password" autocomplete="current-password" autofocus required>
  <p style="margin-top:1rem"><button type="submit">Continue</button></p>
</form>${pwaScript(adminHost)}</body></html>`;
}

export type DashboardView = {
  production: boolean;
  adminHost: boolean;
  /** Origin that holds the owner cookie -- where the badge and the bounce go. */
  publicOrigin: string;
  /** Where the bounce should send the browser back to. */
  returnTo: string;
  badgeToken: string;
  setToken: string;
  nonce: string;
};

export function renderDashboard(owner: DashboardView): string {
  const adminHost = owner.adminHost === true;
  /**
   * Exclusion status is drawn by the origin that holds the cookie.
   *
   * jh_own is host-only on joeehanson.com. Once the dashboard is served from
   * admin.joeehanson.com it cannot read that cookie at all -- not by fetch,
   * because that would need a credentialed cross-origin endpoint, and not by
   * script, because the cookie is HttpOnly. An image can: the two hostnames
   * share a registrable domain, so they are same-SITE, the Lax cookie rides
   * along, and images need no CORS.
   *
   * The cost, stated plainly: the page can display this but cannot read it. So
   * both actions are offered rather than one toggle that knows which way it
   * should point. The badge is the only claim made about exclusion anywhere on
   * this page -- there is no second, server-rendered copy to drift out of step
   * with it.
   *
   * The nonce is per render. Combined with no-store and Vary: Cookie on the
   * response, nothing between here and the cookie can serve one browser the
   * answer belonging to another.
   */
  const badge = `${owner.publicOrigin}/api/owner-badge.svg?t=${encodeURIComponent(owner.badgeToken)}&n=${encodeURIComponent(owner.nonce)}`;

  const ownForm = (exclude: boolean, label: string) => `
    <form method="post" action="${owner.publicOrigin}/api/own" data-own="${exclude ? 'on' : 'off'}">
      <input type="hidden" name="exclude" value="${exclude ? '1' : '0'}">
      <input type="hidden" name="t" value="${escapeHtml(owner.setToken)}">
      <input type="hidden" name="return" value="${escapeHtml(owner.returnTo)}">
      <button type="submit">${label}</button>
    </form>`;

  /**
   * One action, not two -- without being able to read the cookie.
   *
   * The page cannot see jh_own: it is HttpOnly and on another origin, and a
   * credentialed cross-origin endpoint was deliberately not built. But an
   * image's intrinsic size is readable across origins with no CORS, so the
   * apex answers a 1px-wide probe whose HEIGHT carries the state.
   *
   * Both forms are rendered, and the wrong one is removed once the answer
   * arrives. That order matters: if the probe never loads -- offline, blocked,
   * the apex unreachable -- the operator is left with both buttons and can
   * still act, rather than a panel with no way to change anything.
   */
  const probe = `${owner.publicOrigin}/api/owner-badge.svg?probe=1&t=${encodeURIComponent(owner.badgeToken)}&n=${encodeURIComponent(owner.nonce)}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Measurement</title>${pwaHead(adminHost)}<style>${SHELL}
  .ranges{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:1.5rem}
  .ranges button{padding:.4rem .9rem;font-size:.7rem;letter-spacing:.18em;text-transform:uppercase}
  .ranges button[aria-pressed=true]{background:var(--amber);color:var(--black);border-color:var(--amber)}
  .ranges input[type=date]{background:var(--mid);border:1px solid var(--line);color:var(--cream);
    padding:.35rem .5rem;font-family:var(--font);font-size:.8rem;color-scheme:dark}
  .charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.2rem}
  .chart h3{font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);
    font-weight:400;margin-bottom:.1rem}
  .chart .big{font-size:1.5rem;font-weight:300;color:var(--cream);line-height:1.2;margin-bottom:.5rem}
  .bar{fill:var(--amber)}
  .bar:hover{fill:var(--amber-warm,#d9894e)}
  .axis{font-size:9px;fill:var(--cream-dim,#5c5444);font-family:var(--font);letter-spacing:.08em}
  .split{display:flex;height:10px;gap:2px;margin:.5rem 0}
  .split i{display:block;height:100%}
  .legend{display:flex;flex-wrap:wrap;gap:1rem;font-size:.75rem;color:var(--dim)}
  .legend b{color:var(--cream);font-weight:400}
  .swatch{display:inline-block;width:9px;height:9px;margin-right:.4rem;vertical-align:baseline}
  details summary{cursor:pointer;font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:var(--dim)}
  details[open] summary{margin-bottom:.8rem}
  dl{font-size:.85rem;line-height:1.7}
  dt{color:var(--cream);margin-top:.7rem}
  dd{color:var(--dim);margin-left:0}
</style></head><body>

<h1>Measurement</h1>
<p class="sub">joeehanson.com${owner.production ? '' : ' &middot; <span class="no">PREVIEW DATA</span>'}</p>

<div class="card">
  <p><strong>This browser:</strong>
     <img src="${badge}" width="430" height="20" alt="exclusion status"
          style="vertical-align:middle;max-width:100%"></p>
  <div class="row" style="margin:1rem 0 0">
    ${ownForm(true, 'Exclude this browser')}
    ${ownForm(false, 'Stop excluding')}
    <img src="${probe}" alt="" width="1" height="1" id="ownprobe"
         style="position:absolute;opacity:0;pointer-events:none">
    <button type="button" id="test">Send test event</button>
    <form method="get" action="/api/logout"><button type="submit">Sign out</button></form>
  </div>
  <p id="testout" class="note" style="margin-top:.8rem"></p>
  <p id="envline" class="note" style="margin-top:.4rem"></p>
</div>

<div class="ranges">
  <button data-range="today">Today</button>
  <button data-range="7d" aria-pressed="true">7 days</button>
  <button data-range="30d">30 days</button>
  <button data-range="all">All time</button>
  <span class="note" style="margin-left:.5rem">or</span>
  <input type="date" id="from"> <span class="note">to</span> <input type="date" id="to">
  <button type="button" id="apply">Apply</button>
</div>

<p id="rangelabel" class="sub" style="margin-bottom:1rem">&nbsp;</p>

<div class="row" id="tiles"></div>

<div class="card">
  <p class="sub" style="margin:0 0 1rem">Trend</p>
  <div class="charts" id="charts"></div>
</div>

<div class="row">
  <div class="card" style="flex:1;min-width:260px">
    <p class="sub" style="margin:0 0 .8rem">Devices</p>
    <div id="devices"></div>
  </div>
  <div class="card" style="flex:1;min-width:260px">
    <p class="sub" style="margin:0 0 .8rem">New vs returning</p>
    <div id="newret"></div>
  </div>
</div>

<div class="card">
  <p class="sub" style="margin:0 0 .8rem">Where visits came from</p>
  <div id="sources"></div>
</div>

<div class="card">
  <p class="sub" style="margin:0 0 .2rem">Campaign performance</p>
  <p class="note" style="margin-bottom:.8rem">Which post actually sent someone to listen.</p>
  <div id="campaigns"></div>
</div>

<div class="row">
  <div class="card" style="flex:1;min-width:260px">
    <p class="sub" style="margin:0 0 .8rem">Outbound clicks</p>
    <div id="outbound"></div>
  </div>
  <div class="card" style="flex:1;min-width:260px">
    <p class="sub" style="margin:0 0 .8rem">Top streaming destinations</p>
    <div id="destinations"></div>
  </div>
</div>

<div class="card">
  <details>
    <summary>How every number is defined</summary>
    <dl>
      <dt>Visitors <span class="note">(daily unique, summed)</span></dt>
      <dd>Distinct visitors per day, added up across the range. <strong>This
      overcounts anyone who came back on another day.</strong> The visitor hash is
      salted with a random daily key that is destroyed two days later, so linking
      one person across days is cryptographically unavailable by design. Use
      Sessions for an accurate figure over any range longer than a day.</dd>

      <dt>Sessions</dt>
      <dd>A visit. Ends after 30 minutes without activity. Accurate over any range.</dd>

      <dt>Pageviews</dt>
      <dd>Page loads. A retried beacon delivering the same event twice counts once.</dd>

      <dt>Avg engaged</dt>
      <dd>Total engaged time divided by sessions. Engaged time runs only while the
      page is <em>visible</em> and <em>focused</em> and there has been interaction in
      the last 60 seconds — a backgrounded tab and an abandoned-but-open one both
      stop the clock. Reported every 15 seconds of engaged time, so an abandoned
      session still records up to its last heartbeat.</dd>

      <dt>Engagement rate</dt>
      <dd>Share of sessions lasting 10s or more of engaged time, <em>or</em> with two
      or more pageviews.</dd>

      <dt>New vs returning</dt>
      <dd>From a single stored value holding the month a browser first arrived. No
      visitor ID, no cookie, nothing that identifies anyone.</dd>

      <dt>Devices</dt>
      <dd>Counted per batch received, not per session, so it indicates mix rather
      than exact session counts.</dd>

      <dt>Excluded today</dt>
      <dd>Visits from browsers you marked as yours. Never included in anything above.
      Kept 7 days, purely so you can see exclusion working.</dd>

      <dt>To streaming / Intent rate</dt>
      <dd>Outbound clicks to a music service (Spotify, Apple Music, YouTube,
      Deezer, Bandcamp and friends), and the share of sessions that produced at
      least one. Clicks to Instagram or TikTok are counted as outbound but
      <em>not</em> as intent — following is not listening. This is the number
      that separates a clip that got views from a clip that sent someone to
      press play.</dd>

      <dt>How a source is decided</dt>
      <dd>In order: a <code>utm_source</code> on the link, then a platform click
      id, then the referring site, then direct. The table marks which one
      answered. <strong>Tagged links are the only reliable signal</strong> —
      Instagram and TikTok in-app browsers routinely strip the referrer, so
      untagged traffic from exactly the places you care about most tends to
      land in "direct".</dd>

      <dt>Campaign / content</dt>
      <dd>From <code>utm_campaign</code> and <code>utm_content</code>.
      Content is the individual post, which is what separates the Same Damn
      Shame TikTok clip from the Same Damn Shame Instagram post. Untagged
      traffic groups under a single row rather than being scattered.</dd>

      <dt>Attribution is per session, not per pageview</dt>
      <dd>It is fixed when the session opens and stays put, so a click through
      to Spotify five minutes later is still credited to the post that brought
      the visitor in.</dd>

      <dt>What is not here yet</dt>
      <dd>Everything in the approved design is now built. Rollups older than
      Phase 3 are recomputed automatically rather than shown with empty tables.</dd>
    </dl>
  </details>
</div>

<script>
const fmtMs = ms => !ms ? '0s' : ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms/1000).toFixed(1)+'s'
  : Math.floor(ms/60000)+'m '+Math.round((ms%60000)/1000)+'s';
const pct = x => Math.round(x*100) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let current = {range:'7d'};

/* One metric, one colour, one y-scale. Separate charts rather than a dual axis:
   two measures on two scales in one frame is the classic way to imply a
   relationship that is not in the data. */
function barChart(series, key, label, format) {
  const vals = series.map(d => d[key]);
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a,b)=>a+b,0);
  const W = 100, H = 34, n = series.length || 1;
  const slot = W / n, bw = Math.max(0.8, Math.min(slot - 0.6, 6));
  const bars = series.map((d,i) => {
    const h = (d[key] / max) * (H - 6);
    const x = i*slot + (slot-bw)/2;
    return '<rect class="bar" x="'+x.toFixed(2)+'" y="'+(H-h).toFixed(2)+'" width="'+bw.toFixed(2)+
      '" height="'+Math.max(h,0.4).toFixed(2)+'" rx="0.8"><title>'+esc(d.day)+': '+
      esc(format?format(d[key]):d[key])+'</title></rect>';
  }).join('');
  const first = series[0]?.day ?? '', last = series[series.length-1]?.day ?? '';
  return '<div class="chart"><h3>'+esc(label)+'</h3><div class="big">'+
    esc(format?format(total):total)+'</div>'+
    '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="76" preserveAspectRatio="none" role="img" aria-label="'+
    esc(label+' per day, '+first+' to '+last)+'">'+bars+'</svg>'+
    '<div style="display:flex;justify-content:space-between"><span class="axis">'+esc(first)+
    '</span><span class="axis">peak '+esc(format?format(max):max)+'</span><span class="axis">'+esc(last)+'</span></div></div>';
}

function bar2(items, colors) {
  const total = items.reduce((a,[,v])=>a+v,0) || 1;
  const seg = items.map(([k,v],i) =>
    '<i style="flex:'+v+';background:'+colors[i%colors.length]+'" title="'+esc(k+': '+v)+'"></i>').join('');
  const leg = items.map(([k,v],i) =>
    '<span><span class="swatch" style="background:'+colors[i%colors.length]+'"></span>'+
    esc(k)+' <b>'+pct(v/total)+'</b> <span class="note">('+v+')</span></span>').join('');
  return items.length && total
    ? '<div class="split">'+seg+'</div><div class="legend">'+leg+'</div>'
    : '<p class="note">Nothing recorded in this range.</p>';
}

/* Responses can arrive out of order: a 30-day query reads far more than a
   one-day query and can still be in flight when a later click resolves. Without
   a guard the slower, older response would land last and the dashboard would
   show one range's numbers under another range's label -- silently wrong, which
   is the one thing this dashboard must never be. Only the newest request is
   allowed to paint. */
let loadSeq = 0;

/* A sortable-by-nothing, deliberately plain table. Rows are ordered by
   sessions descending so the answer is the top row. */
/* Every cell after the first carries its own heading in data-l. On a phone the
   header row is taken out of the flow and each figure prints its own label
   instead, which is the only reason five columns fit in 360px without running
   into each other. */
function cells(labels, values) {
  return values.map((v,i) => '<td data-l="'+esc(labels[i])+'">'+v+'</td>').join('');
}

function table(rows, firstHeader) {
  if (!rows.length) return '<p class="note">Nothing recorded in this range.</p>';
  const cols = ['Sessions','Avg engaged','To streaming','Intent'];
  const head = '<tr><th>'+esc(firstHeader)+'</th>'+cols.map(c => '<th>'+esc(c)+'</th>').join('')+'</tr>';
  const body = rows.map(([k, v]) => {
    const avg = v.sessions ? Math.round(v.engagedMs / v.sessions) : 0;
    const intent = v.sessions ? v.intentSessions / v.sessions : 0;
    return '<tr><td data-l="'+esc(firstHeader)+'">'+esc(k)+'</td>'+
      cells(cols, [v.sessions, fmtMs(avg), v.streaming, pct(intent)])+'</tr>';
  }).join('');
  return '<div class="tw"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
}

function countTable(obj, firstHeader, transform) {
  const rows = Object.entries(obj || {}).filter(([,n]) => n > 0).sort((a,b) => b[1]-a[1]).slice(0, 12);
  if (!rows.length) return '<p class="note">Nothing recorded in this range.</p>';
  return '<div class="tw"><table><thead><tr><th>'+esc(firstHeader)+'</th><th>Clicks</th></tr></thead><tbody>'+
    rows.map(([k,n]) => '<tr><td data-l="'+esc(firstHeader)+'">'+esc(transform ? transform(k) : k)+'</td>'+
      cells(['Clicks'], [n])+'</tr>').join('')+
    '</tbody></table></div>';
}

const bySessions = (obj) => Object.entries(obj || {}).sort((a,b) => b[1].sessions - a[1].sessions).slice(0, 15);

/* The session lasts seven days and then the cookie is simply gone. Before this,
   a 401 was parsed as if it were stats: the page read a session count off an
   error object, threw, and left half a dashboard with no hint why. In a browser
   you could at least see the address bar; in the installed app there is no
   address bar and no reload button, so that silent break would be the only
   thing an expired session ever showed. Send it to the sign-in screen instead. */
let signedOutAlready = false;
function signedOut() {
  if (signedOutAlready) return;
  signedOutAlready = true;
  document.body.innerHTML =
    '<h1>Signed out</h1><p class="sub">joeehanson.com</p>' +
    '<div class="card"><p>Your session has expired.</p>' +
    '<p style="margin-top:1rem"><button type="button" id="relogin">Sign in</button></p></div>';
  document.getElementById('relogin').addEventListener('click', () => location.assign('/admin'));
  location.assign('/admin');   // which renders the sign-in form
}

/* Every authenticated read goes through here so none of them can miss a 401. */
async function api(url) {
  const res = await fetch(url, {cache:'no-store'});
  if (res.status === 401) { signedOut(); throw new Error('signed out'); }
  return res.json();
}

async function load() {
  const seq = ++loadSeq;
  const qs = new URLSearchParams(current).toString();
  document.getElementById('rangelabel').textContent = 'loading\u2026';
  let d;
  try {
    d = await api('/api/stats?'+qs);
  } catch (err) {
    if (signedOutAlready) return;
    if (seq === loadSeq) document.getElementById('rangelabel').textContent = 'Could not load stats.';
    return;
  }
  if (seq !== loadSeq) return;   // a newer request has already been issued
  const t = d.totals;

  // A custom range's label is already the dates; don't print them twice.
  const span = d.range.from === d.range.to ? d.range.from : d.range.from + ' to ' + d.range.to;
  document.getElementById('rangelabel').textContent =
    (d.range.label === span ? span : d.range.label + ' · ' + span) +
    ' · ' + d.dataFrom.rollups + ' from rollups, ' + d.dataFrom.computedLive + ' computed live';

  document.getElementById('tiles').innerHTML = [
    ['Visitors <span style="opacity:.6">(daily, summed)</span>', t.visitorDaysSummed],
    ['Sessions', t.sessions],
    ['Pageviews', t.pageviews],
    ['Avg engaged', fmtMs(t.avgEngagedMs)],
    ['Engagement rate', pct(t.engagementRate)],
    ['To streaming', t.streamingClicks || 0],
    ['Intent rate', pct(t.intentRate || 0)],
    ['Excluded today', d.ownerExcludedToday]
  ].map(([k,v]) => '<div class="tile"><b>'+v+'</b><span>'+k+'</span></div>').join('');

  document.getElementById('charts').innerHTML = d.byDay.length
    ? barChart(d.byDay,'sessions','Sessions') +
      barChart(d.byDay,'visitors','Visitors (daily unique)') +
      barChart(d.byDay,'pageviews','Pageviews')
    : '<p class="note">Nothing recorded in this range.</p>';

  const AMBER='#c87941', DIM='#6d6350', FAINT='#3a352a';
  document.getElementById('devices').innerHTML =
    bar2(Object.entries(d.devices||{}).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]), [AMBER,DIM,FAINT]);
  document.getElementById('newret').innerHTML =
    bar2([['New', d.newVsReturning.new],['Returning', d.newVsReturning.returning]].filter(([,v])=>v>0), [AMBER,DIM]);

  document.getElementById('sources').innerHTML = table(bySessions(d.sources), 'Source / medium') +
    (d.basis ? '<p class="note" style="margin-top:.7rem">Attributed from: ' +
      Object.entries(d.basis).sort((a,b)=>b[1]-a[1])
        .map(([k,n]) => esc(k) + ' ' + n).join(' \u00b7 ') +
      '. Only <em>utm</em> is a tagged link; the rest are inferred.</p>' : '');

  document.getElementById('campaigns').innerHTML = table(bySessions(d.campaigns), 'Campaign / content');
  document.getElementById('outbound').innerHTML = countTable(d.outboundByService, 'Destination');
  document.getElementById('destinations').innerHTML =
    countTable(d.outboundDestinations, 'Track', k => k.replace('|', '  '));

  if (d.env) document.getElementById('envline').textContent =
    'Reading ' + d.env.store + ' via ' + d.env.host +
    (d.env.production ? ' — production data.' : ' — NOT production; these numbers are test data.');
}

document.querySelectorAll('.ranges button[data-range]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.ranges button[data-range]').forEach(x => x.removeAttribute('aria-pressed'));
    b.setAttribute('aria-pressed','true');
    document.getElementById('from').value = '';
    document.getElementById('to').value = '';
    current = {range: b.dataset.range};
    load();
  });
});
document.getElementById('apply').addEventListener('click', () => {
  const f = document.getElementById('from').value, t2 = document.getElementById('to').value;
  if (!f || !t2) return;
  document.querySelectorAll('.ranges button[data-range]').forEach(x => x.removeAttribute('aria-pressed'));
  current = {from: f, to: t2};
  load();
});

/* Two pixels tall means this browser is excluded; one means it is not. If the
   probe errors we leave both actions in place rather than guessing. */
(function () {
  const probe = document.getElementById('ownprobe');
  if (!probe) return;
  const decide = () => {
    const excluded = probe.naturalHeight === 2;
    const drop = document.querySelector('form[data-own="' + (excluded ? 'on' : 'off') + '"]');
    if (drop) drop.remove();
  };
  if (probe.complete && probe.naturalHeight) decide();
  else probe.addEventListener('load', decide, {once: true});
})();

document.getElementById('test').addEventListener('click', async () => {
  const out = document.getElementById('testout');
  out.textContent = 'checking…';
  try {
    const before = (await api('/api/stats?range=today')).ownerExcludedToday;
    const verdict = await api('/api/test-event');
    await fetch('/api/e', {method:'POST', cache:'no-store',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({events:[{eid:crypto.randomUUID(),sid:'test-'+crypto.randomUUID(),t:'pv',ts:Date.now(),path:'/__test',test:true}]})});
    await new Promise(r => setTimeout(r, 1500));
    const after = (await api('/api/stats?range=today')).ownerExcludedToday;
    out.textContent = verdict.reason + ' — excluded-today went ' + before + ' → ' + after +
      (verdict.wouldBeCounted ? ' (counted as a normal visit)' : ' (diverted to the excluded log)');
  } catch (err) {
    if (!signedOutAlready) out.textContent = 'Could not reach the server.';
    return;
  }
  load();
});

load();
</script>${pwaScript(adminHost)}
</body></html>`;
}
