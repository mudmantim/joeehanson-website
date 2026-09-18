/**
 * Engagement-time correctness.
 *
 * These tests run the *shipped* implementation: the source between the
 * @engagement-core markers is extracted from public/script.js and evaluated.
 * There is no second copy to drift out of sync, and no build step to add.
 *
 * Every timestamp is supplied explicitly, so a timeline replays exactly.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadTracker(t) {
  const src = readFileSync(join(root, 'public', 'script.js'), 'utf8');
  const start = src.indexOf('/* @engagement-core:start');
  const end = src.indexOf('/* @engagement-core:end */');
  t.ok(start !== -1 && end > start, 'engagement core markers present in public/script.js');

  const core = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${core}; return createEngagementTracker;`)();
}

const SEC = 1000;

export default function run(t) {
  const createEngagementTracker = loadTracker(t);
  const mk = (over = {}) => createEngagementTracker({ now: 0, idleMs: 60 * SEC, ...over });

  // --- the basic case ----------------------------------------------------
  {
    const e = mk();
    e.activity(1 * SEC);
    t.equal(e.read(10 * SEC), 10 * SEC, 'visible and active for 10s counts 10s');
  }

  // --- hidden time is not engagement -------------------------------------
  {
    const e = mk();
    e.setVisible(false, 10 * SEC);
    t.equal(e.read(40 * SEC), 10 * SEC, 'clock stops when the page is hidden');
    e.setVisible(true, 40 * SEC);
    t.equal(e.read(45 * SEC), 15 * SEC, 'visible 10s + hidden 30s + visible 5s = 15s');
  }

  // --- blur counts as disengagement --------------------------------------
  {
    const e = mk();
    e.setFocused(false, 5 * SEC);
    t.equal(e.read(60 * SEC), 5 * SEC, 'clock stops on blur even while visible');
    e.setFocused(true, 60 * SEC);
    t.equal(e.read(63 * SEC), 8 * SEC, 'clock resumes on focus');
  }

  // --- an abandoned but visible tab stops counting ------------------------
  {
    const e = mk();
    t.equal(e.read(90 * SEC), 60 * SEC, 'idle cutoff caps a visible-but-untouched tab at idleMs');
    t.equal(e.read(600 * SEC), 60 * SEC, 'idle engagement does not keep growing');
  }

  // --- activity after idle restarts the clock ----------------------------
  {
    const e = mk();
    t.equal(e.read(90 * SEC), 60 * SEC, 'went idle at 60s');
    e.activity(95 * SEC);
    t.equal(e.read(100 * SEC), 65 * SEC, 'activity after idle resumes, without back-filling the idle gap');
  }

  // --- engagement never decreases as time advances -----------------------
  {
    const e = mk();
    e.activity(5 * SEC);
    let prev = 0;
    for (let now = 0; now <= 200 * SEC; now += 7 * SEC) {
      const v = e.read(now);
      t.ok(v >= prev, `engagement never decreases (at ${now / SEC}s: ${v} >= ${prev})`);
      t.ok(v <= now, `engagement never exceeds elapsed time (at ${now / SEC}s)`);
      prev = v;
    }
  }

  // --- hidden at start ----------------------------------------------------
  {
    const e = mk({ visible: false });
    t.equal(e.read(30 * SEC), 0, 'a tab opened in the background accrues nothing');
    e.setVisible(true, 30 * SEC);
    t.equal(e.read(35 * SEC), 5 * SEC, 'and starts counting only when it becomes visible');
  }

  // --- rapid toggling does not leak time ---------------------------------
  {
    const e = mk();
    for (let i = 1; i <= 10; i++) {
      e.setVisible(false, i * 2 * SEC - SEC);
      e.setVisible(true, i * 2 * SEC);
    }
    t.equal(e.read(20 * SEC), 10 * SEC, 'alternating 1s visible / 1s hidden for 20s counts 10s');
  }
}
