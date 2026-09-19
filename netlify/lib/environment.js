/**
 * Which environment a job is running against.
 *
 * Plain ESM so the Deno edge runtime, the Node functions and the test runner
 * all import this exact file — same arrangement as rollup.js and
 * attribution.js. There is no second copy to drift.
 *
 * The decision can be **unknown**, and that is the whole point. The original
 * check returned a boolean, so "cannot tell" was indistinguishable from
 * "definitely preview" — and preview is an instruction to go and maintain the
 * other store. That is how the nightly rollup skipped production for a day and
 * how the prune stopped destroying production's daily salts while the
 * documentation said it was doing so.
 *
 * Callers must refuse to act on an unknown answer. Doing nothing and saying so
 * is recoverable; quietly maintaining the wrong store is not.
 */

/** Deploy contexts Netlify uses. Anything else means we do not know. */
export const KNOWN_CONTEXTS = ['production', 'deploy-preview', 'branch-deploy', 'dev'];

/** What each available signal reports. Surfaced in logs and diagnostics. */
export function environmentSignals(fnContext, globals = globalThis, env = undefined) {
  const processEnv =
    env ?? (typeof process !== 'undefined' && process.env ? process.env : {});
  return {
    fnContext: fnContext?.deploy?.context ?? null,
    netlifyGlobal: globals?.Netlify?.context?.deploy?.context ?? null,
    // CONTEXT is a BUILD variable and is usually absent at runtime. It is
    // consulted last and only as corroboration.
    envCONTEXT: processEnv.CONTEXT ?? null,
  };
}

/**
 * @returns {{known:true, production:boolean, signal:string, value:string}
 *          |{known:false, reason:string, signals:object}}
 */
export function resolveProcessEnvironment(fnContext, globals = globalThis, env = undefined) {
  const signals = environmentSignals(fnContext, globals, env);

  const seen = [
    ['fnContext', signals.fnContext],
    ['netlifyGlobal', signals.netlifyGlobal],
    ['envCONTEXT', signals.envCONTEXT],
  ].filter(([, v]) => v != null);

  if (seen.length === 0) {
    return { known: false, reason: 'no deploy-context signal was available', signals };
  }

  // An unrecognised value is not "not production". It is not knowing.
  const unrecognised = seen.filter(([, v]) => !KNOWN_CONTEXTS.includes(v));
  if (unrecognised.length > 0) {
    return {
      known: false,
      reason: `unrecognised deploy context: ${unrecognised.map(([k, v]) => `${k}=${v}`).join(', ')}`,
      signals,
    };
  }

  // Signals that disagree mean an assumption here is wrong, not that one of
  // them should win.
  if (new Set(seen.map(([, v]) => v)).size > 1) {
    return {
      known: false,
      reason: `signals disagree: ${seen.map(([k, v]) => `${k}=${v}`).join(', ')}`,
      signals,
    };
  }

  const [signal, value] = seen[0];
  return { known: true, production: value === 'production', signal, value };
}
