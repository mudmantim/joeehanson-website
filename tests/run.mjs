/**
 * The whole test runner. No dependencies, no config, no build.
 *
 * Add a file to tests/, default-export a function taking `t`, list it below.
 */

const FILES = ['./precache.test.mjs', './engagement.test.mjs', './deploy-shape.test.mjs', './rollup.test.mjs', './attribution.test.mjs', './environment.test.mjs', './admin-pwa.test.mjs'];

let passed = 0;
const failures = [];

const t = {
  ok(cond, msg) {
    if (cond) { passed++; return; }
    failures.push(msg);
  },
  equal(actual, expected, msg) {
    if (actual === expected) { passed++; return; }
    failures.push(`${msg}\n      expected: ${expected}\n      actual:   ${actual}`);
  },
};

for (const file of FILES) {
  const mod = await import(file);
  const name = file.replace('./', '').replace('.test.mjs', '');
  const before = failures.length;
  try {
    await mod.default(t);
    // Named extra suites in the same file.
    for (const [name, fn] of Object.entries(mod)) {
      if (name !== 'default' && typeof fn === 'function') await fn(t);
    }
  } catch (err) {
    failures.push(`${name} threw: ${err.message}`);
  }
  const failed = failures.length - before;
  console.log(`${failed === 0 ? '  ok  ' : ' FAIL '} ${name}${failed ? ` (${failed} failed)` : ''}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  × ${f}`);
  process.exit(1);
}
