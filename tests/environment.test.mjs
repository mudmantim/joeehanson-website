/**
 * Environment resolution must fail closed.
 *
 * The original check returned a boolean, so "cannot tell" was indistinguishable
 * from "definitely preview" — and "preview" is an instruction to go and
 * maintain the other store. That is how the nightly rollup skipped production
 * for a day and how the prune stopped destroying production's daily salts.
 *
 * The rule these pin: an uncertain answer is never an answer.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

import { resolveProcessEnvironment } from '../netlify/lib/environment.js';

export default function run(t) {
  const ctx = (context) => ({ deploy: { context } });

  // --- confident answers -------------------------------------------------
  {
    const d = resolveProcessEnvironment(ctx('production'));
    t.ok(d.known, 'a production context is a known answer');
    t.equal(d.production, true, 'and it is production');
    t.equal(d.signal, 'fnContext', 'attributed to the function context');
  }
  for (const c of ['deploy-preview', 'branch-deploy', 'dev']) {
    const d = resolveProcessEnvironment(ctx(c));
    t.ok(d.known, `${c} is a known answer`);
    t.equal(d.production, false, `${c} is not production`);
  }

  // --- the failure that caused all of this -------------------------------
  {
    const d = resolveProcessEnvironment(undefined);
    t.ok(!d.known, 'no signal at all is UNKNOWN, not "preview"');
    t.ok(/no deploy-context signal/.test(d.reason), 'and says why');
  }
  {
    const d = resolveProcessEnvironment({});
    t.ok(!d.known, 'an empty context object is unknown');
  }
  {
    const d = resolveProcessEnvironment({ deploy: {} });
    t.ok(!d.known, 'a context with no deploy.context is unknown');
  }

  // --- ambiguity is not resolved by preference ---------------------------
  {
    const d = resolveProcessEnvironment(ctx('something-new'));
    t.ok(!d.known, 'an unrecognised context is unknown, not "not production"');
    t.ok(/unrecognised/.test(d.reason), 'and says so');
  }
  {
    // A future Netlify context name must not silently read as preview.
    const d = resolveProcessEnvironment(ctx('PRODUCTION'));
    t.ok(!d.known, 'case does not sneak through as a non-production answer');
  }

  // --- the decision is never a bare boolean ------------------------------
  {
    const d = resolveProcessEnvironment(undefined);
    t.equal(d.production, undefined, 'an unknown decision carries no production flag to misread');
  }

  // --- both jobs must refuse on unknown ----------------------------------
  for (const f of ['netlify/functions/rollup.mts', 'netlify/functions/prune.mts']) {
    const src = readFileSync(join(root, f), 'utf8');
    t.ok(/resolveProcessEnvironment\(context\)/.test(src), `${f} resolves the environment from its context`);
    t.ok(/if \(!env\.known\)/.test(src), `${f} checks for an unknown environment`);
    t.ok(/refused: true/.test(src), `${f} refuses rather than proceeding`);
    t.ok(!/isProductionProcess/.test(src), `${f} no longer uses the boolean check`);
  }
}

/** The maintenance endpoint's safeguards. */
export function maintenanceSafeguards(t) {
  const src = readFileSync(join(root, 'netlify/edge-functions/admin.ts'), 'utf8');
  const maint = src.slice(src.indexOf("path === '/api/maintenance'"), src.indexOf('// ---- Stats'));

  t.ok(/req\.method === 'POST'/.test(maint), 'maintenance is POST only');
  t.ok(/expect !== actual/.test(maint), 'the caller must assert which environment it expects');
  t.ok(/MAX_DELETE/.test(maint), 'prune has a blast-radius cap');
  t.ok(/age < 1/.test(maint), "today's data is never eligible for deletion");
  t.ok(/!DAY_RE\.test\(day\)/.test(maint), 'unparseable keys are retained, not guessed at');
  t.ok(/if \(!confirmed\) return json\(\{ \.\.\.summary, dryRun: true \}\)/.test(maint),
       'prune is dry-run unless explicitly confirmed');
  t.ok(/day >= today/.test(maint), 'an open day is never rolled up');

  // It must sit behind the session gate, not before it.
  const gate = src.indexOf('if (!session.valid)');
  const endpoint = src.indexOf("path === '/api/maintenance'");
  t.ok(gate !== -1 && gate < endpoint, 'maintenance is declared after the authentication gate');
  t.ok(/'\/api\/maintenance'/.test(src.slice(src.indexOf('export const config'))),
       'the route is declared in the edge function config');
}
