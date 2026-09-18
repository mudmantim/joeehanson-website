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
  table{width:100%;border-collapse:collapse;font-size:.9rem}
  th,td{text-align:left;padding:.4rem 0;border-bottom:1px solid var(--line)}
  th{font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);font-weight:400}
  pre{background:var(--mid);border:1px solid var(--line);padding:1rem;overflow:auto;
      font-size:.75rem;font-family:ui-monospace,monospace;color:var(--dim);line-height:1.5}
  .note{font-size:.8rem;color:var(--dim);font-style:italic}
`;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderLogin(error?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Sign in</title><style>${SHELL}
body{max-width:340px;padding-top:18vh}</style></head><body>
<h1>Sign in</h1><p class="sub">joeehanson.com</p>
${error ? `<p class="no" style="margin-bottom:1rem">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/api/login">
  <input type="password" name="password" autocomplete="current-password" autofocus required>
  <p style="margin-top:1rem"><button type="submit">Continue</button></p>
</form></body></html>`;
}

export function renderDashboard(owner: { excluded: boolean; expiresAt: number | null; production: boolean }): string {
  const status = owner.excluded
    ? `<span class="ok">EXCLUDED &#10003;</span> <span class="note">expires ${
        owner.expiresAt ? escapeHtml(new Date(owner.expiresAt * 1000).toISOString().slice(0, 10)) : 'unknown'
      }</span>`
    : `<span class="no">NOT EXCLUDED</span> <span class="note">visits from this browser are being counted</span>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Measurement</title><style>${SHELL}</style></head><body>

<h1>Measurement</h1>
<p class="sub">joeehanson.com &middot; phase 1${
   owner.production ? '' : ' &middot; <span class="no">PREVIEW DATA</span>'
 }</p>

<div class="card">
  <p><strong>This browser:</strong> ${status}</p>
  <div class="row" style="margin:1rem 0 0">
    <form method="post" action="/api/own">
      <input type="hidden" name="exclude" value="${owner.excluded ? '0' : '1'}">
      <button type="submit">${owner.excluded ? 'Stop excluding this browser' : 'Exclude this browser'}</button>
    </form>
    <button type="button" id="test">Send test event</button>
    <form method="get" action="/api/logout"><button type="submit">Sign out</button></form>
  </div>
  <p id="testout" class="note" style="margin-top:.8rem"></p>
  <p id="envline" class="note" style="margin-top:.4rem"></p>
</div>

<div class="row" id="tiles"></div>

<div class="card">
  <p class="sub" style="margin:0 0 .8rem">Events by day</p>
  <table><thead><tr><th>Day</th><th>Batches</th></tr></thead><tbody id="days"></tbody></table>
</div>

<div class="card">
  <p class="sub" style="margin:0 0 .8rem">Raw response</p>
  <pre id="raw">loading…</pre>
  <p class="note">Phase 1 shows the unaggregated API response on purpose: every
  tile above must be traceable to a number in here.</p>
</div>

<script>
const fmtMs = ms => ms < 1000 ? ms + 'ms' : (ms/1000).toFixed(1) + 's';
async function load() {
  const r = await fetch('/api/stats', {cache:'no-store'});
  const d = await r.json();
  document.getElementById('raw').textContent = JSON.stringify(d, null, 2);
  const t = d.totals;
  document.getElementById('tiles').innerHTML = [
    ['Visitor-days', t.visitorDays], ['Sessions', t.sessions], ['Pageviews', t.pageviews],
    ['Avg engaged', fmtMs(t.avgEngagedMs)],
    ['Engagement rate', Math.round(t.engagementRate*100) + '%'],
    ['Your visits excluded today', d.ownerExcludedToday]
  ].map(([k,v]) => '<div class="tile"><b>'+v+'</b><span>'+k+'</span></div>').join('');
  if (d.env) document.getElementById('envline').textContent =
    'Reading ' + d.env.store + ' via ' + d.env.host +
    (d.env.production ? ' — production data.' : ' — NOT production; these numbers are test data.');
  document.getElementById('days').innerHTML =
    (d.byDay||[]).map(x => '<tr><td>'+x.day+'</td><td>'+x.batches+'</td></tr>').join('')
    || '<tr><td colspan=2 class="note">Nothing recorded yet.</td></tr>';
}
document.getElementById('test').addEventListener('click', async () => {
  const out = document.getElementById('testout');
  out.textContent = 'checking…';
  const before = (await (await fetch('/api/stats',{cache:'no-store'})).json()).ownerExcludedToday;
  const verdict = await (await fetch('/api/test-event',{cache:'no-store'})).json();
  await fetch('/api/e', {method:'POST', cache:'no-store',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({events:[{eid:crypto.randomUUID(),sid:'test-'+crypto.randomUUID(),t:'pv',ts:Date.now(),path:'/__test',test:true}]})});
  await new Promise(r => setTimeout(r, 1200));
  const after = (await (await fetch('/api/stats',{cache:'no-store'})).json()).ownerExcludedToday;
  out.textContent = verdict.reason + ' — excluded-today went ' + before + ' \\u2192 ' + after +
    (verdict.wouldBeCounted ? ' (event was counted as a normal visit)' : ' (event was diverted to the excluded log)');
  load();
});
load();
</script>
</body></html>`;
}
