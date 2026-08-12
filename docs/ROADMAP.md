# ROADMAP

**Status:** active execution. Initial block/compiler + generic-intake checkpoint, first `job_inquiry` projector split, second reusable intake path proof, and first real preset-catalog slice are implemented; rollout steps beyond that remain open. **Date:** 2026-08-12. **Owner:** Dale.

This roadmap turns the vertical-preset/block architecture into an execution sequence. It is intentionally ordered by risk: prove the architecture against the current live runtime before widening scope.

Related doc:

- `docs/VERTICAL-PRESET-BLOCK-ARCHITECTURE.md`

---

## 1. Objective

Build configurable, reusable receptionist behavior for different business types without creating a second call engine.

Target shape:

- reusable typed block library
- vertical preset compositions
- tenant runtime config generated from presets
- generic intake submission layer
- specialized projectors where needed

Hard rule:

- this must compile into the existing `agent/src/checklist/` runtime
- do **not** build a parallel call-flow engine

## Checkpoint completed on 2026-08-12

The roadmap is no longer hypothetical from step zero.

Implemented and verified in this checkpoint:

- Step 1 vocabulary freeze: `ConversationBlockDef`, `PolicyBlockDef`, `KnowledgeBlockDef`, `OutcomeBlockDef`, `VerticalPresetDef`, `TenantRuntimeConfig`, and `IntakeSubmission` now exist in `agent/src/checklist/blockTypes.ts`
- Step 2 canonical schemas: Zod schemas now exist in `agent/src/checklist/blockSchemas.ts`, with tests covering acceptance/rejection cases
- Step 3 definition/compiler layer: `agent/src/checklist/blockLibrary.ts`, `agent/src/checklist/blockCompiler.ts`, and the checklist runtime `runtimeConfig` path now compile the first parity-set block ids into live selectable tree ids while keeping the full tree library for tracker invariants
- Step 4 generic intake envelope: `supabase/migrations/20260811160000_intake_submissions.sql` created `intake_submissions`, and `capture-job-inquiry` now writes that envelope before the specialized `job_inquiries` row
- Step 5 first projector split: `src/services/jobInquiryCapture.ts` now owns generic capture + `job_inquiry` projection persistence while `src/routes/agentTools/messaging.ts` keeps validation / spoken reply / email side effects; route, route-unit, and real-DB tests pass against the split path
- Step 6 second reusable path proof: `src/services/meetingNotesCapture.ts` now lands `attach-meeting-notes` into the same generic `intake_submissions` envelope with `submission_type='meeting_notes'` before projecting to appointment description, and route + service tests pass against that split path
- Step 7 first preset-catalog slice: `agent/src/checklist/presets.ts` now defines `auto_shop_front_desk`, `salon_front_desk`, and `local_service_front_desk`; `agent/src/checklist/blockLibrary.ts` now exposes the additional live conversation-block wrappers those presets need; `agent/src/checklist/presetCatalog.test.ts` proves schema validation, lookup, runtime materialization, and compile-to-live-tree behavior for all three presets

Still open after this checkpoint:

- preset-specific call-path coverage beyond compile/runtime tests
- onboarding wiring for preset selection
- tenant-safe override UI and activation controls

---

## 2. Big steps

### Step 1 — Freeze vocabulary and boundaries

Goal:

- stop "block" from meaning six different things

Define and use exact internal nouns:

- `ConversationBlockDef`
- `PolicyBlockDef`
- `KnowledgeBlockDef`
- `OutcomeBlockDef`
- `VerticalPresetDef`
- `TenantRuntimeConfig`
- `IntakeSubmission`
- `Projector`

Exit criteria:

- names documented in code-facing spec
- implementation notes use exact terms consistently
- no ambiguous umbrella language left in the active design docs

Why first:

- if naming is mush, implementation gets mushy fast

---

### Step 2 — Define canonical schemas

Goal:

- turn architecture into typed contracts before touching runtime behavior

Build:

- TypeScript interfaces and/or Zod schemas for:
  - block definitions
  - preset definitions
  - tenant runtime config
  - generic intake submission envelope
  - projector result contracts

Likely files:

- adjacent to `agent/src/checklist/types.ts` or in new shared schema files

Exit criteria:

- schemas compile
- invalid shapes are rejected in tests
- at least one example preset validates cleanly

---

### Step 3 — Extract current trees into a definition layer

Goal:

- prove this is a compiler layer over the current runtime, not a second runtime

Start with:

- `identity`
- `booking`
- `message`
- `job`

Build:

- internal definition source for these live pieces
- compiler: preset/config → existing question-tree structures

Exit criteria:

- compiled output is behavior-equivalent to current tree path
- no runtime behavior change
- targeted tests prove parity

This is first real knife cut.

---

### Step 4 — Introduce generic intake submission envelope

Goal:

- stop persistence from being only domain-specific one-offs

Build:

- generic `intake_submissions` table or equivalent
- generic submission write before any specialized projection
- preserve current `job_inquiries` write path as projection behavior

Exit criteria:

- one completed job inquiry creates:
  - generic intake submission
  - projected `job_inquiries` row
- duplicate-call retry is still idempotent
- appointment stamping still happens exactly once

Why now:

- without the generic envelope, every new preset drags bespoke storage behind it

---

### Step 5 — Refactor current job inquiry route into projector pattern

Goal:

- separate durable generic capture from domain-specific side effects

Refactor current `capture_job_inquiry` flow into parts:

- validation / normalization
- generic submission write
- `job_inquiry` projector
- notification/stamping hooks

Current source of truth:

- orchestration / spoken contract: `src/routes/agentTools/messaging.ts`
- generic capture + projection persistence: `src/services/jobInquiryCapture.ts`

Exit criteria:

- existing route still works end to end
- internal architecture is split cleanly
- regression tests still pass

---

### Step 6 — Prove a second reusable path

Status:

- implemented and verified on 2026-08-12 via the `attach-meeting-notes` / `buy_service` meeting-context path

Goal:

- catch architecture lies before rollout

Chosen path:

- `attach-meeting-notes` as the second reusable capture/projection path
- rationale: it is already a live path tied to `buy_service` demo booking flow and proves the same generic envelope can feed a non-`job_inquiry` projection without inventing a second runtime or a fake domain table

What shipped:

- `src/services/meetingNotesCapture.ts` owns generic submission capture plus appointment-description projection
- `src/routes/agentTools/scheduling.ts` now keeps spoken contract / route shell while delegating persistence to that service
- generic envelope rows land in `intake_submissions` with `submission_type='meeting_notes'`
- existing appointment description stamp remains the projection output (`Caller notes: …`)

Exit criteria:

- second path uses same config/compiler/projector model
- no bespoke runtime is introduced
- no new special-case persistence mess appears

Verification:

- `npx vitest run tests/services/meetingNotesCapture.test.ts tests/routes/agentTools/agentTools.test.ts --run`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test`

Result:

- passed

---

### Step 7 — Define first three vertical presets

Status:

- first implementation slice shipped and verified on 2026-08-12

Goal:

- turn primitives into product-ready starting points

Start with:

- auto shop
- salon
- generic local service / home services

For each preset, define:

- included conversation blocks
- policy blocks
- knowledge categories
- outcomes
- required overrides
- forbidden combinations

Exit criteria:

- each preset validates
- each preset has one example tenant runtime config
- each preset has at least one call-path test

What shipped in the first slice:

- `agent/src/checklist/presets.ts` defines:
  - `auto_shop_front_desk`
  - `salon_front_desk`
  - `local_service_front_desk`
- `agent/src/checklist/blockLibrary.ts` now exposes reusable wrappers for additional already-live trees used by those presets (`generic_subject`, `qa`, `buy_service`, `schedule_change`, `fix_computer`)
- `agent/src/checklist/presetCatalog.test.ts` verifies preset catalog shape, lookup, runtime materialization, and compile-to-live-tree ids

Still open inside Step 7:

- richer per-vertical blocks beyond current live-tree wrappers
- preset-specific call-path tests proving user journeys, not just compile/runtime selection

---

### Step 8 — Wire preset selection into setup/onboarding

Goal:

- make this a real product surface, not an internal toy

Add:

- business-type / preset choice during setup
- generated tenant runtime config from the selected preset
- preview of active blocks and policies

Exit criteria:

- new tenant can choose preset during setup
- runtime config is generated deterministically
- safe fallback/default exists

---

### Step 9 — Add safe tenant overrides

Goal:

- allow customization without letting tenants create chaos

Allow:

- enable/disable supported blocks
- tweak approved wording
- mark fields required/optional where supported
- choose booking/message policy modes

Do not allow yet:

- arbitrary custom logic
- custom code hooks
- unrestricted branching authoring

Exit criteria:

- override validation exists
- invalid configs are blocked before activation
- preview/dry-run exists

---

### Step 10 — Build coverage before expansion

Goal:

- keep the architecture honest before adding more presets and flows

Must-have tests:

- schema validation failures
- compile-to-tree parity
- already-answered values are not re-asked
- duplicate retries do not duplicate rows
- booking/message policy interactions
- service unavailable → available alternatives offered
- auto-shop and salon happy + edge flows

Required E2E before claiming done:

- one recruiter path
- one auto-shop path
- one salon path
- one details-only path
- one missing-phone recovery path

The bar is behavior, not percentages.

---

## 3. Execution phases

### Phase A — Contract freeze

Includes:

- step 1
- step 2

Deliverables:

- exact internal names
- typed schemas
- validation tests

Why this phase exists:

- implementation without contract discipline will rot immediately

---

### Phase B — Runtime parity

Includes:

- step 3

Deliverables:

- current `JOB_TREE` path compiled from definitions
- no behavior change
- parity tests

Why this phase exists:

- if this fails, the whole architecture is lying

---

### Phase C — Generic capture + projector split

Includes:

- step 4
- step 5

Deliverables:

- generic intake envelope
- `job_inquiries` projector
- preserved idempotency + appointment stamping

Why this phase exists:

- future presets need common persistence bones

---

### Phase D — Reuse proof + preset definitions

Includes:

- step 6
- step 7

Deliverables:

- second reusable flow
- first three presets
- preset validation and scenario coverage

Why this phase exists:

- one flow proves little; two proves architecture has a pulse

---

### Phase E — Product surface

Includes:

- step 8
- step 9
- step 10

Deliverables:

- setup integration
- tenant-safe overrides
- minimum E2E confidence for rollout

Why this phase exists:

- internal elegance means nothing if onboarding and safety are missing

---

## 4. Recommended immediate order

Remaining immediate order from the current checkpoint:

1. add preset-specific call-path tests for auto shop, salon, and local-service behavior
2. wire preset selection into setup/onboarding
3. add tenant-safe overrides and preview/activation guardrails
4. widen block depth where current presets still rely on generic live-tree wrappers

---

## 5. What must not happen

Do not:

- build a second runtime beside `agent/src/checklist/`
- jump straight to vertical presets without parity proof
- let tenant-authored executable code into the runtime
- create giant per-vertical scripts
- skip regression coverage because the config "looks right"

That is how you get a prettier way to ship regressions.

---

## 6. Success definition

This roadmap succeeds when:

- new business types are composed from reusable primitives instead of custom call engines
- the current live job path still works after extraction
- one generic capture layer supports multiple flows
- preset setup is fast and safe
- tenant overrides are constrained and validated
- tests prove behavior across unit, regression, and E2E layers

In one sentence:

**Turn one-off live call flows into a typed, testable preset system without breaking the existing question-tree runtime.**
