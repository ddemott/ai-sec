/**
 * TEMPORARY — deliberately failing test.
 *
 * Exists to prove, end-to-end, that GitHub branch protection on `main` actually
 * refuses a PR whose CI is red. docs/TODO.md P0 §3 asserts the rule works
 * because it was configured on 2026-06-15; nobody had ever watched it stop a
 * real red PR. An unverified gate is indistinguishable from a broken one — the
 * CI paths-filter in #226 had been silently inert for exactly that reason.
 *
 * This file is deleted in the next commit of the same PR, which is what proves
 * the other half: green unblocks the merge.
 *
 * If you are reading this on `main`, something went very wrong: the gate let a
 * red commit through. Delete the file and investigate branch protection.
 */
import { describe, it, expect } from 'vitest';

describe('branch-protection gate proof (temporary)', () => {
  it('FAILS ON PURPOSE: proves a red check blocks the merge', () => {
    // WHO: the CI Backend job running on this PR
    // WHAT: a guaranteed-red assertion, so the "Backend" required check fails
    // WHEN: only on the first commit of PR "prove branch protection"
    // WHERE: the Backend (typecheck + tests + integration) job
    // WHY: branch protection must refuse the merge while this is red. The next
    //      commit deletes this file; the merge must then unblock.
    expect(1 + 1).toBe(3);
  });
});
