# Vertical preset / block architecture — implementation spec

**Status:** initial implementation checkpoint plus Step 5/6 proof and first preset-catalog slice completed; broader preset rollout still in progress. **Date:** 2026-08-12. **Owner:** Dale.

Related docs:
- [VERTICAL-PRESET-BLOCK-ARCHITECTURE](../../VERTICAL-PRESET-BLOCK-ARCHITECTURE.md)
- [ROADMAP](../../ROADMAP.md)
- [QUESTION_TREE_ARCHITECTURE](../../QUESTION_TREE_ARCHITECTURE.md)

## Checkpoint outcome now implemented

This spec is no longer just a plan. The following slice is now real in the repo:

- `agent/src/checklist/blockTypes.ts`
- `agent/src/checklist/blockSchemas.ts`
- `agent/src/checklist/runtimeConfig.ts`
- `agent/src/checklist/blockLibrary.ts`
- `agent/src/checklist/blockCompiler.ts`
- `agent/src/checklist/presets.ts`
- `agent/src/checklist/presets.test.ts`
- `agent/src/checklist/presetCatalog.test.ts`
- `agent/src/checklist/blockCompiler.test.ts`
- `agent/src/checklist/checklistRuntimeConfig.test.ts`
- `supabase/migrations/20260811160000_intake_submissions.sql`
- `supabase/baseline.sql` regenerated to include the new table/policies

Verified behavior for this checkpoint:
- checklist runtime accepts `runtimeConfig`
- enabled conversation blocks compile into selectable live tree ids
- full live tree library remains available for tracker invariants
- `capture-job-inquiry` writes `intake_submissions` before the existing `job_inquiries` projection
- `src/services/jobInquiryCapture.ts` now splits generic capture + `job_inquiry` projection out of the route shell
- `attach-meeting-notes` now writes `submission_type='meeting_notes'` into `intake_submissions` before projecting to the appointment description
- `intake_submissions` ships with FORCE RLS and repo-standard tenant/admin policies
- first three real preset definitions now exist in code (`auto_shop_front_desk`, `salon_front_desk`, `local_service_front_desk`)
- preset catalog tests now verify lookup, schema validation, runtime materialization, and compile-to-live-tree output

Still pending relative to the full spec:
- preset-specific call-path tests beyond compile/runtime coverage
- setup/onboarding preset selection
- tenant-safe override surface

## 1. Goal

Take the current live question-tree system and add a higher-level configuration layer that supports:
- reusable typed block definitions
- vertical preset compositions
- tenant runtime configs derived from presets
- generic intake submission capture
- specialized projectors for domain-specific persistence

Without:
- building a second runtime
- breaking the current live `JOB_TREE` path
- introducing tenant-authored executable logic

## 2. Non-negotiable architecture constraints

1. `agent/src/checklist/` remains the only call runtime.
2. Presets/blocks compile into existing question-tree structures.
3. Existing live behavior must be preserved before expansion.
4. Generic submission capture lands before new specialized flows proliferate.
5. Every extraction step gets parity tests before the next abstraction layer is added.

## 3. Canonical internal vocabulary

These names should be used consistently in code, tests, and docs.

- `ConversationBlockDef`
  - reusable caller-interaction unit
  - closest analogue to current question trees / subtrees
- `PolicyBlockDef`
  - behavior rule that constrains or shapes conversation/runtime decisions
- `KnowledgeBlockDef`
  - category of answerable business facts
- `OutcomeBlockDef`
  - post-conversation write/trigger behavior
- `VerticalPresetDef`
  - business-type preset bundle of blocks + defaults
- `TenantRuntimeConfig`
  - actual active per-tenant call configuration
- `IntakeSubmission`
  - generic persisted captured payload for one completed intake flow
- `Projector`
  - specialized adapter that maps a generic submission to a domain-specific record or side effect

Do not use vague stand-ins like "script object" or "flow blob" in code.

## 4. Scope of first implementation slice

The delivered checkpoint stayed deliberately narrow.

Completed in this slice:
- schema/types for definitions and runtime config
- compiler layer from defs/config to question-tree defs
- extraction of the current live `job` path into defs
- generic `intake_submissions` capture
- route-level preservation of current `job_inquiries` behavior after the generic envelope write
- service extraction for the live `job_inquiry` projector path
- second-path proof via `attach-meeting-notes` on the `buy_service` meeting-context path
- first real preset catalog with three shipped preset definitions and compile/runtime tests

Not completed in this slice:
- preset-specific call-path tests proving user journeys through those presets

Still out of scope:
- dashboard UI for preset editing
- end-user visual flow builder
- tenant-authored branching logic
- arbitrary custom code hooks
- broad preset catalog beyond first three presets

## 5. File plan

### Existing files likely to modify
- `agent/src/checklist/types.ts`
- `agent/src/checklist/trees.ts`
- `agent/src/checklist/tracker.ts`
- `agent/src/checklist/checklistTools.ts`
- `agent/src/tools.ts`
- `src/routes/agentTools/schemas.ts`
- `src/routes/agentTools/messaging.ts`
- `src/routes/agentTools/*.test.ts` (exact files depend on current layout)

### Files created in this checkpoint
Agent/runtime side:
- `agent/src/checklist/blockTypes.ts`
- `agent/src/checklist/blockSchemas.ts`
- `agent/src/checklist/blockCompiler.ts`
- `agent/src/checklist/blockLibrary.ts`
- `agent/src/checklist/presets.ts`
- `agent/src/checklist/runtimeConfig.ts`
- `agent/src/checklist/blockCompiler.test.ts`
- `agent/src/checklist/presets.test.ts`
- `agent/src/checklist/presetCatalog.test.ts`
- `agent/src/checklist/checklistRuntimeConfig.test.ts`

Backend/persistence side:
- `supabase/migrations/20260811160000_intake_submissions.sql`
- `supabase/baseline.sql` regenerated

Still pending after this checkpoint:
- setup/onboarding preset selection
- preset-specific call-path tests

Docs/tests:
- update `docs/VERTICAL-PRESET-BLOCK-ARCHITECTURE.md` only if names or scope move
- update `docs/ROADMAP.md` only if ordering changes materially

## 6. Data contracts — first pass

### 6.1 ConversationBlockDef
Minimum fields:
- `block_id: string`
- `kind: 'conversation'`
- `description: string`
- `selection_hints?: string[]`
- `tree_refs?: string[]`
- `node_defs?: ...` only if/when blocks stop being direct wrappers over current tree defs
- `pairs_with?: string[]`
- `requires?: string[]`
- `conflicts_with?: string[]`

First implementation advice:
- do **not** over-design a whole new node language immediately
- start by wrapping/annotating current tree defs rather than replacing their internal shape on day one
- compiler can initially compose existing `QuestionTreeDef`s from referenced tree ids

### 6.2 PolicyBlockDef
Minimum fields:
- `block_id: string`
- `kind: 'policy'`
- `description: string`
- `policy_type: string`
- `settings: Record<string, unknown>`

Examples:
- booking mode
- cancellation window
- transfer-preferred vs message-first
- consent requirements

### 6.3 KnowledgeBlockDef
Minimum fields:
- `block_id: string`
- `kind: 'knowledge'`
- `description: string`
- `knowledge_keys: string[]`

This is mostly classification/config metadata at first; it does not need to mutate the question-tree runtime in phase one.

### 6.4 OutcomeBlockDef
Minimum fields:
- `block_id: string`
- `kind: 'outcome'`
- `description: string`
- `outcome_type: string`
- `projector?: string`
- `settings: Record<string, unknown>`

### 6.5 VerticalPresetDef
Minimum fields:
- `preset_id: string`
- `vertical: string`
- `description: string`
- `conversation_blocks: string[]`
- `policy_blocks: string[]`
- `knowledge_blocks: string[]`
- `outcome_blocks: string[]`
- `defaults: Record<string, unknown>`

### 6.6 TenantRuntimeConfig
Minimum fields:
- `tenant_id?: string` in runtime objects; required in persistence objects
- `preset_id: string`
- `enabled_conversation_blocks: string[]`
- `enabled_policy_blocks: string[]`
- `enabled_knowledge_blocks: string[]`
- `enabled_outcome_blocks: string[]`
- `overrides: Record<string, unknown>`
- `version: number`

### 6.7 IntakeSubmission
Minimum fields:
- `submission_id`
- `tenant_id`
- `call_id`
- `preset_id`
- `block_ids`
- `submission_type`
- `caller_name`
- `caller_phone`
- `appointment_id?`
- `payload_json`
- `rendered_summary`
- `created_at`

### 6.8 Projector contract
Suggested shape:
- `project(submission, context) => Promise<ProjectorResult>`

Where `ProjectorResult` includes:
- `success: boolean`
- `projected_record_id?: string`
- `projected_record_type?: string`
- `notifications_sent?: string[]`
- `warnings?: string[]`

## 7. Compiler strategy

Do not try to replace question-tree internals immediately.

Phase-one compiler should:
1. load `TenantRuntimeConfig`
2. resolve enabled conversation block ids
3. map them to existing `QuestionTreeDef` instances or thin wrappers
4. return the same shape current checklist runtime already expects

This means the first compiler is mostly a composition/resolution layer, not a deep transform.

That is good. It lowers blast radius.

### First compile target
Use these current tree ids first:
- `identity`
- `booking`
- `message`
- `job`

Second wave:
- `buy_service`
- `qa`
- `generic_subject`
- `schedule_change`
- `fix_computer`

## 8. Migration strategy for current job flow

Current live job path is the proof case.

### Current source pieces
- tree/runtime: `agent/src/checklist/trees.ts` (`JOB_TREE`)
- persistence contract: `src/routes/agentTools/schemas.ts`
- write path: `src/routes/agentTools/messaging.ts` (`capture-job-inquiry`)

### Extraction sequence
1. create block/preset schemas
2. represent current job flow as definition data
3. compile definition data back into current runtime shape
4. prove behavior parity in tests
5. add generic intake submission write
6. invoke `jobInquiryProjector`
7. preserve existing output/side effects exactly

## 9. Persistence strategy

### 9.1 Generic capture first
Add `intake_submissions` table.

Suggested columns:
- `submission_id UUID PK`
- `tenant_id UUID NOT NULL`
- `call_id TEXT NULL`
- `preset_id TEXT NOT NULL`
- `submission_type TEXT NOT NULL`
- `block_ids JSONB NOT NULL`
- `caller_name TEXT NULL`
- `caller_phone TEXT NULL`
- `appointment_id UUID NULL`
- `payload JSONB NOT NULL`
- `rendered_summary TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Minimum indexes:
- `(tenant_id, created_at DESC)`
- `(tenant_id, call_id)` where useful for retry lookup / traceability

RLS:
- same tenant isolation pattern as other tenant-scoped business tables

### 9.2 Projector second
`job_inquiries` remains alive, but is no longer the first persistence target.

New flow:
1. validate inputs
2. write generic `intake_submissions` row
3. run `jobInquiryProjector`
4. projector writes `job_inquiries`
5. projector stamps appointment / triggers owner notification

### 9.3 Idempotency rule
Current duplicate-call protection in `capture-job-inquiry` must survive.

Parity requirement:
- same call retried due to agent timeout or transport retry must not:
  - duplicate inquiry row
  - duplicate generic submission row
  - duplicate appointment stamp
  - duplicate owner notification

This likely means one of:
- unique partial index on `(tenant_id, call_id, submission_type)` where `call_id IS NOT NULL`
- or explicit get-or-create path before insert
- or both, same pattern as current inquiry protections

## 10. Step-by-step implementation tasks

Status note: tasks 1-6 landed in this checkpoint, task 7 is only partially landed at the route level, and tasks 8-9 remain pending. The bullets below preserve the implementation plan shape; for the exact files that actually shipped, use §5 above.

### Task 1 — Add code-facing naming comments and scaffold files *(completed)*
Objective:
- create home for new types without disturbing runtime behavior yet

Files:
- Create: `agent/src/checklist/blockTypes.ts`
- Create: `agent/src/checklist/blockSchemas.ts`
- Create: `agent/src/checklist/runtimeConfig.ts`

Verification:
- `cd agent && npm run typecheck`

### Task 2 — Define minimal block/preset/runtime interfaces *(completed)*
Objective:
- encode canonical vocabulary in types and schemas

Files:
- Modify: `agent/src/checklist/blockTypes.ts`
- Modify: `agent/src/checklist/blockSchemas.ts`
- Test: `agent/src/checklist/presets.test.ts`

Verification:
- invalid preset missing a conversation block list fails schema validation
- invalid block kind fails schema validation
- `cd agent && npm test -- presets`
- `cd agent && npm run typecheck`

### Task 3 — Create thin wrappers for current live trees *(completed)*
Objective:
- represent current trees as reusable definitions without changing actual call behavior

Files:
- Create: `agent/src/checklist/blockLibrary.ts`
- Modify: `agent/src/checklist/trees.ts` only if exporting references is necessary
- Test: `agent/src/checklist/blockCompiler.test.ts`

Verification:
- block library contains entries for `identity`, `booking`, `message`, `job`
- compiler returns the same tree ids expected by runtime

### Task 4 — Build first compiler path *(completed)*
Objective:
- compile `TenantRuntimeConfig` → selected `QuestionTreeDef[]`

Files:
- Create: `agent/src/checklist/blockCompiler.ts`
- Test: `agent/src/checklist/blockCompiler.test.ts`

Verification:
- config selecting `identity+job+booking` resolves those exact tree defs
- invalid block refs fail deterministically
- no runtime changes yet

### Task 5 — Introduce parity path for JOB_TREE *(completed)*
Objective:
- allow checklist runtime to source selected trees through compiler for the job flow

Files:
- Modify: likely `agent/src/checklist/checklistTools.ts` and/or call setup path where selected trees are assembled
- Test: targeted checklist tests covering current job flow

Verification:
- current job flow still asks the same core questions
- meeting-offer behavior preserved
- duplicate-answer / already-answered behavior preserved

### Task 6 — Add generic intake submission persistence *(completed at route + migration level)*
Objective:
- add generic durable envelope before projector split

Files:
- Create migration: `supabase/migrations/<timestamp>_intake_submissions.sql`
- Create: `src/services/intake/types.ts`
- Create: `src/services/intake/intakeSubmissionService.ts`
- Test: backend service tests

Verification:
- inserts generic submission row
- RLS isolation mirrors current tenant tables
- duplicate-call path tested

### Task 7 — Split job inquiry into projector pattern *(completed)*
Objective:
- preserve current inquiry behavior while making it a reusable outcome adapter

Files:
- Create: `src/services/jobInquiryCapture.ts`
- Modify: `src/routes/agentTools/messaging.ts`
- Test: existing capture-job-inquiry route tests + new service tests

Verification:
- generic row + projected inquiry row both created
- owner notification still works
- appointment stamping still exact-once
- same retry does not duplicate either row

### Task 8 — Prove second path through same architecture *(completed)*
Objective:
- validate reuse before preset rollout

Chosen target:
- `buy_service` via `attach-meeting-notes`

Files:
- Create: `src/services/meetingNotesCapture.ts`
- Modify: `src/routes/agentTools/scheduling.ts`
- Test: `tests/services/meetingNotesCapture.test.ts`
- Test: `tests/routes/agentTools/agentTools.test.ts`

Verification:
- second path works without bespoke compiler branch
- no one-off persistence hack is needed; the generic envelope now feeds a non-`job_inquiry` projection

### Task 9 — Define first three presets in code *(pending)*
Objective:
- ship preset definitions that map to current product direction

Presets:
- `autoshop_default`
- `salon_default`
- `local_service_default`

Files:
- Create/modify: `agent/src/checklist/presets.ts`
- Test: `agent/src/checklist/presets.test.ts`

Verification:
- each preset validates
- each preset compiles into known block composition
- each preset has at least one scenario test

## 11. Test plan

### Agent/runtime tests
Targeted tests should cover:
- schema rejection of malformed defs
- compiler rejection of missing block refs
- compile parity for `job`
- no-repeat behavior for already answered nodes
- branch selection behavior remains intact

Likely commands:
- `cd agent && npm run typecheck`
- `cd agent && npm test`

### Backend tests
Targeted tests should cover:
- `intake_submissions` insert
- tenant isolation for generic submissions
- job projector exact-once behavior
- duplicate retry does not duplicate rows
- appointment stamp exact-once behavior

Likely commands:
- `npm test`
- targeted vitest/jest command for agent-tools and intake service tests

### E2E / simulation
Before calling the slice complete, run at least:
- recruiter path with booking
- recruiter path details-only
- missing callback number recovery path
- second-path proof scenario (`buy_service` or equivalent)

If available in current harness, reuse:
- `scripts/simulate.sh` flows relevant to these paths

## 12. Risks and tripwires

### Risk 1 — building a second runtime by accident
Tripwire:
- new compiler invents its own execution semantics instead of returning `QuestionTreeDef`s

Mitigation:
- compiler output must stay close to current runtime shape in phase one

### Risk 2 — over-designing the block language too early
Tripwire:
- custom node DSL before parity exists

Mitigation:
- wrap current trees first, deepen abstraction later only if real need appears

### Risk 3 — persistence duplication under retries
Tripwire:
- generic capture + projector each insert independently on retries

Mitigation:
- explicit idempotency strategy before merge
- regression tests must prove exact-once behavior

### Risk 4 — mixing policy and conversation concerns again
Tripwire:
- policy settings hidden in conversation block prose instead of typed config

Mitigation:
- keep policy block definitions explicit even if only a few exist at first

### Risk 5 — preset theater without product value
Tripwire:
- lots of preset names, no concrete tested flows

Mitigation:
- do not add more than first three presets until second-path proof is green

## 13. Success criteria for this implementation slice

This slice is done when all of the following are true:
1. current job flow can be sourced through block/preset/compiler path
2. behavior parity is proven by targeted tests
3. generic `intake_submissions` exists and is used
4. `job_inquiries` is produced via projector path, not only via one-off route logic
5. retries remain idempotent
6. one second path proves reuse
7. first three presets validate in code

If any of those are missing, the slice is not done. It is merely dressed better.
