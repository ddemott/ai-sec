/**
 * ORDER INVARIANCE — throw the same answers at the tracker in EVERY order.
 *
 * WHO: the real platform trees + the real tracker.
 * WHAT: a full call's worth of answers fed in dozens of shuffled orders — plus
 *       the adversarial ones (exact reverse: every leaf before the choice that
 *       makes it relevant) — must always converge to the IDENTICAL final state.
 * WHY: the whole promise of the architecture is that callers answer however
 *      they please ("well it's a job downtown but we have all our people work
 *      remote") and the checklist still fills correctly. Hand-picked orders
 *      prove the cases we thought of; permutations prove the property.
 *
 * Deterministic PRNG (mulberry32, fixed seeds) — same shuffles every CI run, so
 * a failure is reproducible by seed, never a flake.
 */
import { describe, expect, it } from 'vitest';
import { ChecklistTracker } from './tracker.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';

/** The complete Mike-from-Apex call: every answer on the final active path. */
const JOB_CALL_ANSWERS: Array<[string, string]> = [
  ['caller_name', 'Mike'],
  ['caller_phone', '2624979039'],
  ['callers_company', 'Apex Staffing'],
  ['hiring_for', 'placing_with_client'],
  ['client_company', 'Northern Trust'],
  ['role_description', 'senior Java developer'],
  ['employment_type', 'contract'],
  ['rate_range', '65 to 82 an hour'],
  ['contract_length', 'six months'],
  ['work_mode', 'remote'],
  ['team_timezone', 'Central'],
  ['meeting_offer', 'details_only'],
];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function runCall(order: Array<[string, string]>): ChecklistTracker {
  const t = new ChecklistTracker(PLATFORM_TREE_LIBRARY);
  t.select(['identity', 'job']);
  for (const [nodeId, value] of order) {
    // On a consistent answer set nothing is ever DEAD mid-stream (only open or
    // latent), so every record must succeed regardless of position.
    t.record(nodeId, { value });
  }
  t.completeAction('capture', 'ji_1');
  return t;
}

const CANONICAL = JSON.stringify(runCall(JOB_CALL_ANSWERS).snapshot());

describe('order invariance (the property, not the cases)', () => {
  it('the canonical order resolves — baseline sanity', () => {
    const t = runCall(JOB_CALL_ANSWERS);
    expect(t.isResolved()).toBe(true);
    expect(t.status('salary_range')).toBe('not_applicable');
    expect(t.status('position_address')).toBe('not_applicable');
  });

  it('EXACT REVERSE — every leaf arrives before the choice that makes it relevant', () => {
    // timezone first, caller name last: everything rides the pending path and
    // promotes when its branch opens. The end state must be indistinguishable.
    const t = runCall([...JOB_CALL_ANSWERS].reverse());
    expect(t.isResolved()).toBe(true);
    expect(JSON.stringify(t.snapshot())).toBe(CANONICAL);
  });

  it('40 seeded shuffles all converge to the identical final state', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const t = runCall(shuffled(JOB_CALL_ANSWERS, seed));
      expect(t.isResolved(), `seed ${seed}`).toBe(true);
      expect(JSON.stringify(t.snapshot()), `seed ${seed}`).toBe(CANONICAL);
    }
  });

  it('interleaved mind-changes still converge once the FINAL answers are in', () => {
    // The caller flip-flops mid-stream — full_time, back to contract — with
    // branch answers landing between the flips. Discards happen along the way;
    // what must hold is the END state given the final answer set.
    const t = new ChecklistTracker(PLATFORM_TREE_LIBRARY);
    t.select(['identity', 'job']);
    t.record('team_timezone', { value: 'Eastern' }); // volunteered before any branch is open — held
    t.record('employment_type', { value: 'full_time' });
    t.record('salary_range', { value: '120k' });
    t.record('caller_name', { value: 'Mike' });
    t.record('employment_type', { value: 'contract' }); // mind-change: salary_range discarded
    expect(t.status('salary_range')).toBe('not_applicable');
    t.record('work_mode', { value: 'onsite' }); // timezone hold dies with the branch
    expect(t.value('team_timezone')).toBeUndefined();
    t.record('work_mode', { value: 'remote' }); // …and back: timezone must be RE-ASKED
    expect(t.status('team_timezone')).toBe('open');
    // Finish with the same facts as the canonical call.
    t.record('caller_phone', { value: '2624979039' });
    t.record('callers_company', { value: 'Apex Staffing' });
    t.record('hiring_for', { value: 'placing_with_client' });
    t.record('client_company', { value: 'Northern Trust' });
    t.record('role_description', { value: 'senior Java developer' });
    t.record('rate_range', { value: '65 to 82 an hour' });
    t.record('contract_length', { value: 'six months' });
    t.record('team_timezone', { value: 'Central' });
    t.record('meeting_offer', { value: 'details_only' });
    t.completeAction('capture', 'ji_1');
    expect(t.isResolved()).toBe(true);
    expect(JSON.stringify(t.snapshot())).toBe(CANONICAL);
  });

  it('every answer in ONE breath then silence — nothing left to ask but the write', () => {
    const t = new ChecklistTracker(PLATFORM_TREE_LIBRARY);
    t.select(['identity', 'job']);
    for (const [nodeId, value] of JOB_CALL_ANSWERS) t.record(nodeId, { value });
    // The frontier must contain ONLY the capture action — zero questions left.
    expect(t.frontier()).toEqual([expect.objectContaining({ node_id: 'capture', kind: 'action' })]);
  });
});
