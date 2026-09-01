/**
 * T-008: every vertical a real owner can pick must reach its own intake tree.
 *
 * WHY THIS EXISTS
 * The 30 vertical intake trees shipped in #388 with unit tests on the trees
 * themselves, but nothing walked the whole chain a live call actually walks:
 *
 *     tenants.business_type
 *       → defaultChecklistPresetIdForBusinessType()   (shared/)
 *       → deriveChecklistRuntimeConfig()              (shared/)
 *       → compileRuntimeConfig()                      (agent/, block → tree_refs)
 *       → the QuestionTreeDef list ChecklistAgent runs
 *
 * Any break in that chain is invisible until a real call: a tree missing from
 * the preset is UNREACHABLE no matter what the caller asks for, because
 * ChecklistOverrides can only SUBTRACT blocks. That is not hypothetical — it is
 * exactly the 2026-08-13 job-tree outage, where `job` sat in `forbidden_trees`
 * on every preset and two recruiter calls to a line whose greeting says "Dale
 * is available for hire" wrote zero job_inquiries rows.
 *
 * WHO: an owner picking their business type in the setup wizard.
 * WHAT: their business_type resolves to <slug>_front_desk, that preset enables
 *       <slug>_intake, and that block's tree_refs resolve to real trees.
 * WHEN: every CI run — this is the regression net for a silent unreachable tree.
 * WHERE: shared/checklistPresetDerivation.ts + agent/src/checklist/blockCompiler.ts.
 *        This test lives in the ROOT suite, not the agent's, because the agent
 *        build sets `rootDir: src` and deliberately excludes shared/ — the agent
 *        never derives a preset, it receives `checklist_runtime_config` over the
 *        wire. The root suite is the only one that can see both halves at once,
 *        which is precisely why the two halves could drift unnoticed.
 * WHY: green tree unit tests plus a green preset catalog still allowed the two
 *      halves to disagree about which blocks a business_type gets.
 */
import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_PRESET_IDS,
  defaultChecklistPresetIdForBusinessType,
  deriveChecklistRuntimeConfig,
} from '../shared/checklistPresetDerivation';
import { compileRuntimeConfig } from '../agent/src/checklist/blockCompiler';

/**
 * The presets that are NOT a single vertical's front desk, and so legitimately
 * carry no `<slug>_intake` block. Kept as an explicit allowlist rather than a
 * pattern: adding to it is the thing that should be argued about, not the test
 * failure that catches a vertical whose intake block silently went missing.
 */
const NOT_A_VERTICAL_INTAKE = new Set([
  // The catch-all for any business_type with no vertical of its own. It runs the
  // generic_subject tree instead of a tailored intake, on purpose.
  'local_service_front_desk',
  // Solo professionals whose line takes work offers — carries `job`, not an intake.
  'owner_for_hire_front_desk',
  // The only tree whose intake ends in a human take-or-decline decision, so it
  // uses `case_intake` rather than the `<slug>_intake` shape.
  'law_firm_front_desk',
  // Reachable catalog entry that NO business_type resolves to, deliberately:
  // 'answering-service' is Thinking Hammer's own business_type and stays mapped
  // to owner_for_hire_front_desk so the owner-for-hire lane and its `job` tree
  // survive (the 2026-08-13 regression). Asserted explicitly below rather than
  // merely skipped — a silent re-route would take the `job` tree away again.
  'answering_service_front_desk',
]);

/** preset id → the business_type an owner would have picked to land on it. */
const businessTypeForPreset = (presetId: string) =>
  presetId.replace(/_front_desk$/, '').replace(/_/g, '-');

describe('vertical intake wiring (business_type → preset → blocks → trees)', () => {
  it('HAPPY: every preset in the catalog is reachable from a business_type and compiles to real trees', () => {
    for (const presetId of CHECKLIST_PRESET_IDS) {
      const businessType = businessTypeForPreset(presetId);
      const derivedPreset = defaultChecklistPresetIdForBusinessType(businessType);
      const config = deriveChecklistRuntimeConfig(businessType, derivedPreset, {});

      // compileRuntimeConfig THROWS on an unknown block or an unresolvable
      // tree_ref, which is the "tree not found" failure this test exists to
      // catch. Assert it produced trees rather than merely not throwing.
      const trees = compileRuntimeConfig(config);
      expect(
        trees.length,
        `preset '${presetId}' (business_type '${businessType}') compiled to zero trees — ` +
          `a call on this vertical would have no questions to ask`
      ).toBeGreaterThan(0);

      // identity is the one block overrides can never disable, so it must be
      // present on every preset or the call cannot learn who is speaking.
      expect(
        trees.map((tree) => tree.tree_id),
        `preset '${presetId}' does not compile to the identity tree`
      ).toContain('identity');
    }
  });

  it('HAPPY: every vertical front desk enables its own <slug>_intake block, and that block resolves', () => {
    const checked: string[] = [];
    for (const presetId of CHECKLIST_PRESET_IDS) {
      if (NOT_A_VERTICAL_INTAKE.has(presetId)) continue;
      const slug = presetId.replace(/_front_desk$/, '');
      const businessType = businessTypeForPreset(presetId);
      const config = deriveChecklistRuntimeConfig(
        businessType,
        defaultChecklistPresetIdForBusinessType(businessType),
        {}
      );

      expect(
        config.enabled_conversation_blocks,
        `business_type '${businessType}' does not enable '${slug}_intake' — the ` +
          `vertical's own questions are unreachable, and overrides cannot ADD a block back`
      ).toContain(`${slug}_intake`);

      // The block existing is not the same as its trees existing.
      const treeIds = compileRuntimeConfig(config).map((tree) => tree.tree_id);
      expect(
        treeIds.some((id) => id.startsWith(slug)),
        `'${slug}_intake' enabled for '${businessType}' but compiled to no tree named for it ` +
          `(got: ${treeIds.join(', ')})`
      ).toBe(true);
      checked.push(slug);
    }
    // Guard the guard: if the allowlist above ever swallowed the whole catalog,
    // this test would pass while asserting nothing.
    expect(checked.length).toBeGreaterThanOrEqual(26);
  });

  it("SAD: 'answering-service' still routes to owner-for-hire, not to its own front desk", () => {
    // WHO: Thinking Hammer, whose business_type literally is 'answering-service'.
    // WHAT: it maps to owner_for_hire_front_desk, which carries the `job` tree.
    // WHEN: every call to a line whose greeting says the owner is available for hire.
    // WHERE: defaultChecklistPresetIdForBusinessType.
    // WHY: answering_service_front_desk exists in the catalog and is the
    //      name-obvious match. Routing to it would drop `job` and reproduce the
    //      2026-08-13 outage, where two recruiter calls wrote zero job_inquiries
    //      rows (CALL1.md / CALL2.md). The name-obvious answer is the wrong one
    //      here, so it is pinned.
    expect(defaultChecklistPresetIdForBusinessType('answering-service')).toBe(
      'owner_for_hire_front_desk'
    );
    const treeIds = compileRuntimeConfig(
      deriveChecklistRuntimeConfig('answering-service', null, {})
    ).map((tree) => tree.tree_id);
    expect(treeIds).toContain('job');
  });

  it("SAD: a business_type with no vertical of its own falls back, it does not compile to nothing", () => {
    // WHO: an owner whose trade isn't one of the 30 (e.g. "artisanal cheesemonger").
    // WHAT: they land on the local-service catch-all, which still compiles.
    // WHY: an unmatched business_type must never yield an empty tree list — that
    //      is a call where the agent has no questions and cannot resolve anything.
    const config = deriveChecklistRuntimeConfig('artisanal-cheesemonger', null, {});
    expect(config.preset_id).toBe('local_service_front_desk');
    const treeIds = compileRuntimeConfig(config).map((tree) => tree.tree_id);
    expect(treeIds).toContain('identity');
    expect(treeIds).toContain('generic_subject');
  });

  it('SAD: an unknown conversation block fails loudly instead of yielding a silently smaller call', () => {
    // WHO: whoever adds a preset block and forgets to add the block definition.
    // WHAT: compileRuntimeConfig throws, naming the block.
    // WHY: the alternative — skipping what it cannot resolve — is how a vertical
    //      loses its intake questions with every test still green.
    const config = deriveChecklistRuntimeConfig('salon', 'salon_front_desk', {});
    const broken = {
      ...config,
      enabled_conversation_blocks: [...config.enabled_conversation_blocks, 'no_such_block'],
    };
    expect(() => compileRuntimeConfig(broken)).toThrow(/no_such_block/);
  });
});
