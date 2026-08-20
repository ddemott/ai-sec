/**
 * Unit tests for the background-worker gate.
 *
 * 5W:
 *   WHO  — the three 60s workers: reminders, voice-session reaper, schedule extender
 *   WHAT — whether each starts, given an env flag and the environment
 *   WHEN — process boot (src/index.ts)
 *   WHERE— src/services/workerEnabled.ts
 *   WHY  — production used to IGNORE the flag entirely
 *          (`isProduction || flag === 'true'` is just `true` in prod), so a
 *          misbehaving worker could only be stopped by shipping a deploy. The
 *          asymmetry itself is deliberate and must not be "tidied" into
 *          symmetry: defaulting a worker OFF in prod because nobody set a
 *          variable is the failure this project has already lived through —
 *          thirteen days of zero reminders while the worker reported healthy.
 */
import { describe, it, expect } from 'vitest';
import { workerEnabled } from '../../src/services/workerEnabled';

describe('workerEnabled — production', () => {
  it('HAPPY: runs when the flag is unset (the normal production case)', () => {
    // WHY: prod must not depend on someone remembering an env var. A missing
    //      variable silently disabling reminders is exactly the 13-day outage.
    expect(workerEnabled(undefined, true)).toBe(true);
  });

  it('HAPPY: runs when the flag is explicitly "true"', () => {
    expect(workerEnabled('true', true)).toBe(true);
  });

  it('SAD: does NOT run when the flag is exactly "false" — the new kill switch', () => {
    // WHO: an operator watching a worker misbehave in prod.
    // WHY: before 2026-08-21 this returned true and the only way to stop a
    //      worker was a deploy. This single case is the whole point of the change.
    expect(workerEnabled('false', true)).toBe(false);
  });

  it('SAD: near-misses do NOT disable it — only the exact string "false"', () => {
    // WHY: a kill switch that fires on a fat-fingered value is worse than one
    //      that never fires, because the result is a silently-stopped worker
    //      and nothing says so. Fail toward RUNNING.
    for (const v of ['False', 'FALSE', '0', 'no', 'off', 'disabled', ' false', 'false ']) {
      expect(workerEnabled(v, true)).toBe(true);
    }
  });
});

describe('workerEnabled — non-production', () => {
  it('SAD: does NOT run by default', () => {
    // WHY: otherwise every local `npm start` and every test run schedules
    //      reminders on a 60s tick against whatever DB is configured.
    expect(workerEnabled(undefined, false)).toBe(false);
  });

  it('HAPPY: runs when explicitly enabled — how the real-DB tests drive it', () => {
    expect(workerEnabled('true', false)).toBe(true);
  });

  it('SAD: anything other than "true" leaves it off', () => {
    for (const v of ['false', 'True', '1', 'yes', '']) {
      expect(workerEnabled(v, false)).toBe(false);
    }
  });
});
