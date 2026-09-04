# Wizard Phase B — draft-commit architecture + phone go-live strategy

**Date:** 2026-07-05
**Status:** Design settled (two judge-panel syntheses + one follow-up finding, all decisions locked with Dale). Not yet implemented.
**Scope:** `dashboard/components/SetupWizard/` (SetupWizard only — SoloWizard is a later, separate PR) + a new backend commit endpoint + a new phone go-live UX layer.
**Related:** `docs/planning/TODO.md` UX backlog → "Wizard Phase B". PR #203 (`POST /coverage/dry-run`, merged) is the foundation this design builds on.

## Background

The wizard is live-DB CRUD today: every add/edit/delete of a service/resource/employee/mapping calls the backend immediately and refetches. Phase B converts it to draft-commit: everything stays in local React state until the owner reaches a real commit point; dismissing the wizard before that point has zero DB side effects.

This spec consolidates three pieces of design work, done in this order:

1. A judge panel (3 independent architecture proposals + 3 blind judges + synthesis) on the **entity-graph draft-commit mechanics**.
2. A **follow-up finding**, made while implementing nothing yet, that the entity-graph commit must fire earlier than the panel initially assumed — on the transition into the wizard's phone-activation step, not on the final "Done" click.
3. A second judge panel on the **phone-number go-live strategy** — provoked by the discovery that step 9 provisions a _brand-new_ phone number with no explanation of how real customers would ever learn to call it.

Each panel used 3 independent proposals (mixed Opus/Fable models for genuine diversity) scored by 3 blind judges on different lenses, then one Opus max-effort synthesis. Full transcripts live in this session; this doc captures the settled conclusions only.

---

## 1. Entity-graph draft-commit design (Panel 1)

### Unanimous across all 3 proposals + all 3 judges

- **Option B wins, Option A is disqualified.** A new backend bulk-commit endpoint (one DB transaction, COMMIT instead of ROLLBACK) beats client-orchestrated sequential commits — the latter's compensating rollback DELETEs run over the same flaky network as the forward writes, so it _adds_ a second failure surface instead of removing one.
- **Reuse the shipped `POST /coverage/dry-run` transaction body** (PR #203). Commit is that body with `COMMIT` instead of `ROLLBACK`. Extract the shared insert logic into a helper both endpoints call.
- **tmp-ids live in the existing `*_id` string fields** (`service_id`, `employee_id`, `resource_id`) — zero changes needed to any `Step*.tsx` component; the schema only requires `z.string().min(1)`.
- **Shift expansion is forced into the commit transaction** — employees have no real id until commit, so today's step-8→9 `expandWeekly` loop (which persists shifts one step before Done) is deleted.
- **Coverage rows match to draft services by name**, not id (dry-run's ids are rolled back and never real).
- **`handleBackToPicker`'s DB-cleanup block is deleted, not adapted** — nothing was ever written, so there's nothing to delete.
- Rewrite (don't delete) the two existing test files to the new intent.

### The critical catch (from Proposal 1, confirmed by both other judges)

The dry-run endpoint's INSERTs are **deliberately lossy** — it writes `NULL` for `description`/`price`/`subtitle` on services and `first_name`/`last_name`/`email`/`phone` on employees (coverage doesn't need those columns). **If commit reuses that INSERT verbatim, every description, price, and employee-contact field the owner typed vanishes on Done, and dry-run's own passing tests never catch it.** The extracted helper must take the full column set as parameters — dry-run passes them absent, commit passes them populated. The commit happy-path test must assert price + employee email round-trip.

### Final recommendation: Proposal 1 (MVP-first) as the spine, with grafts

**Reject:** Proposal 3's standalone `draftGraph.ts` module and its read-only-persisted-rows re-entrancy model for reopened tenants — all three judges independently flagged this as unearned complexity for a scenario with a simpler answer (see below).

**Graft in from Proposal 2:** the explicit "row counts are 0 after a forced mid-graph failure" atomicity test; the **soft-delete-aware idempotency guard** (`WHERE is_deleted=false`, not raw `count(*)`); confirmed `finalize-setup` is promotion-only (safe to remove just the team-wizard's call to it, keep the route for SoloWizard's later PR); no `persist:true|false` flag on the wire (two separate routes, COMMIT/ROLLBACK decision never crosses HTTP).

**Graft in from Proposal 3:** honest scoping that Steps 7/8 (website scan, custom Q&A) fire **live** `Api.knowledge.*` writes on user action, independent of the entity-graph commit — the "dismiss = zero side effects" guarantee is scoped to the _entity graph_ only, not the knowledge base. (Decided low-risk: no phone number exists yet during onboarding, so no real caller could ever reach a half-set-up KB.)

### Implementation plan

- **New `src/routes/setup.ts`**: `POST /setup/commit`. `requireTenantId` → parse `CommitSchema` (= `CoverageDryRunSchema` + optional `description`/`price`/`subtitle` on services, `description` on resources, `first_name`/`last_name`/`email`/`phone` on employees) → tmp-id referential-integrity check (reused from dry-run) → idempotency guard (`SELECT count(*) FROM services WHERE tenant_id=$1 AND is_deleted=false` → `>0` → 409 `"Setup already completed — edit in My Business"`) → `BEGIN` → `insertDraftGraph(client, tenantId, draft, opts)` (extracted from `analytics.ts`, full column set) → `COMMIT` → `logEvent('setup_committed', {counts})` → `{success:true, counts}`.
- **`src/routes/analytics.ts`**: dry-run handler calls the same extracted `insertDraftGraph` helper, passing the optional fields as absent; behavior otherwise identical.
- **`src/routes/setup.commit.test.ts`** (real-DB, 5 cases): happy path with price+email round-trip; tmp-id-integrity 400; idempotency 409 on a non-deleted populated tenant; mid-graph constraint violation → row counts are 0; post-commit booking succeeds with no `EMPLOYEE_NOT_SCHEDULED` (proves shifts actually fanned).
- **`dashboard/components/SetupWizard/useWizardCrud.ts`**: `draftServices`/`draftResources`/`draftEmployees` local arrays (+ `is_auto_seeded` boolean flag, local only). `save*`/`delete*` mutate arrays with no API call; `delete*` cascades — removing a service/employee/resource also removes its dependent mappings/shifts (load-bearing: prevents a later dry-run/commit 400ing on a dangling tmp-id). `toggle*Assignment` mutates local mapping arrays. Step-5 mappings fetch + step-6 `Api.coverage.check` are replaced by a local `buildDraftGraph()` serializer + `Api.coverage.dryRun` call.
- **`dashboard/components/SetupWizard/index.tsx`**: `runSeed` pushes to local arrays (no DB writes); delete `handleBackToPicker`'s DB-cleanup block + `autoSeededServiceIdsRef`/`autoSeededResourceIdsRef`/`seedTargetRef`; `canAdvanceTo` reads draft arrays, not `useStaticData`; delete the team-wizard's `finalizeSetup` call (SoloWizard keeps its own, unaffected).
- No prod migration — commit reuses existing tables/columns.

### Effort: ~14–18h, shippable as two mergeable PRs (backend endpoint first, inert until wired; dashboard conversion second).

---

## 2. Commit-timing fix (follow-up finding, not from either panel)

Verified directly in the code: `Step7GoLive.tsx`'s "Activate AI Phone Line" button fires `Api.provisioning.activate()` — a **real Telnyx number purchase** — immediately on click, independent of the wizard's own Next/Done footer flow. Under the Panel 1 plan (commit fires on the final Done click), a sequence exists where an owner reaches step 9, activates a real phone number, then abandons the wizard without clicking Done: **a live, answering phone number with zero committed services/employees/shifts behind it.**

**Fix:** the entity-graph commit (`Api.setup.commit`) fires on the **transition into step 9** (`goNext()` when `next === 9`), not on the Done click. On success, advance to step 9 (now backed by a guaranteed-real business). On failure, stay on the current step with the draft intact and the error shown — step 9, and the phone-activation button, never render for an uncommitted business. Done becomes purely "close the wizard + arm the first-run tour" — no commit logic there at all.

This is a **required change**, not a judgment call — it closes a real bug, not a preference. It also makes "Go Live" mean exactly what it says.

---

## 3. Phone go-live strategy (Panel 2)

### The problem

Step 9 only supports one path: provision a brand-new Telnyx number. There is no explanation that this is a _new_ number distinct from any number the business already publishes, no forwarding setup, and no porting path. `forwarded_from_phone` (the column that lets the agent recognize a forwarded call's caller-ID and ask the caller verbally for their real number) exists in the schema but is only configurable in `AIConfigView.tsx` — a page reached _after_ the wizard closes, never surfaced during onboarding.

The three real-world "go live" paths a business can end up in:

1. **New number, published as-is** — fine for a genuinely new business.
2. **New number + call forwarding** — the business keeps their real, published number; sets up carrier-side forwarding to the new Telnyx number. Fully reversible.
3. **Number porting** — the business's real number itself moves into Telnyx (formal LNP process: asynchronous, hours-to-weeks, requires carrier port-authorization info, can be rejected). No forwarding needed once complete.

### Unanimous across all 3 proposals + all 3 judges

- **Kill Proposal 2's `port_requests` table + credential intake entirely.** Storing a losing carrier's account number/PIN for a process whose _execution_ is admittedly manual (Dale, in the Telnyx portal) is the "imagined Pro tier" trap — real breach surface, zero automated consumer, built before a single customer has asked.
- **Provision → test → then fork** is the right sequence — no cold 3-way telecom decision up front.
- **The current unconditional "Your AI line is live" message is the actual bug** — never render "live" while a real customer dialing the business's known number would fail to reach the AI.
- **Porting is signposted, never executed by us** — no Telnyx porting API is invented; a human handles the real port regardless of what API might exist (LOA + carrier cutover always need a person).
- **`forwarded_from_phone` is collected in-wizard via the existing `Api.tenants.updateConfig`** — same column the agent reads, so wizard and settings can never diverge.

### The one real disagreement — resolved

Judges split on whether to add a new persisted `go_live_path`/`go_live_method` column to record the owner's committed choice. Resolution: **no column.** No judge defended it as load-bearing (nothing machine-reads it; it's owner-attested state inferred well enough from whether `forwarded_from_phone` is set). Dropping it also eliminates the only defect any judge found in the runner-up proposal (a missing backfill for Dale's/Bella's already-live tenants).

### Final recommended hybrid

- **Test-call confirmation is real, not decorative:** poll the _existing_ `Api.voice.getHistory(tenantId, {limit:1})` every ~5s; when a session started after activation appears, flip to "✓ Test call received." Zero new backend.
- **Forwarding requires actual proof:** after the owner enters their real number (saved to `forwarded_from_phone`), the flow asks them to call **their own real business number** — "if the AI answers, forwarding works." (Typing a number + reading `*72` instructions is not proof forwarding is on.)
- **New-number path gated behind one question:** "Do you already have a number customers call?" — publishing a brand-new number is a footgun for an existing business (their old number goes stale); the "you're all set" affirmation lives inside that card only.
- **Porting = a notify-Dale email**, reusing the existing job-inquiry email pattern (`systemEmail.ts`). No table, no PII, no credentials collected.
- **`deactivatePhone()` safety fix:** warn + clear state when releasing a DID whose tenant still has `forwarded_from_phone` set (verified real hazard — releasing the number while the business still forwards into it strands their real callers). Ships as a separable commit.
- **No new schema, no migration.**

### Decisions locked with Dale (2026-07-05)

1. **Porting copy is conservative** — "email us and we'll help you plan next steps," no promised timeline or SLA. Firm up only after a real port has been executed manually once.
2. **No persisted go-live-decision column.** Accept the trade-off (no persistent "you're all set" banner on wizard re-entry — truth lives per-card). Revisit only if real owners report re-entry confusion.
3. **Porting framed as secondary/later**, not a symmetric peer choice ("start with forwarding today, port later — most businesses do").
4. **New-number card gated** behind the "do you already have a number?" question.
5. **`deactivatePhone` safety fix ships now**, as its own separable commit in the same PR as the go-live panel.

### Implementation plan

- **New `dashboard/components/phone/GoLivePanel.tsx`** (+ test), mounted in **both** `Step7GoLive.tsx` (thin wrapper) and `AIConfigView.tsx` (durable post-wizard home) so an owner who leaves the decision unfinished resumes identically.
  - Stage A: unchanged provisioning mechanics (explicit click; never auto-buy on step entry).
  - Stage B: replaces the unconditional "live" claim with "ready — call it to test" + the test-call poller.
  - Stage C: the three-card fork (new-number gated by the question; forwarding with real verify prompt + `forwarded_from_phone` save; porting signpost, visually secondary).
- **`src/routes/provisioning.ts`**: extend `GET /provisioning/status` to also `SELECT forwarded_from_phone`; add `POST /provisioning/port-inquiry`.
- **`src/services/communications/systemEmail.ts`**: new `sendPortRequestEmail`, following the exact `sendJobInquiryEmail` pattern.
- **`src/services/provisioningService.ts`**: `deactivatePhone()` warning + state clear (separable commit).
- **`docs/OWNER_GUIDE.md`**: forwarding how-to + caller-ID quirk explanation.
- No schema/migration.

### Effort: ~1.5–2 focused days.

---

## 4. Implementation sequencing

Three mergeable PRs, in dependency order:

1. **PR B — backend `POST /setup/commit`** (§1 backend half). Inert until wired to the dashboard. No prod migration.
2. **PR C — SetupWizard draft-commit conversion** (§1 frontend half + §2 commit-timing fix). Depends on PR B. Rewrites `useWizardCrud.ts`/`index.tsx`, the two existing test files, adds the cascade test.
3. **PR D — GoLivePanel** (§3). Depends on PR C (step 9 must only ever render against a committed, real business — the invariant PR C/§2 establishes).

## 5. Open items carried forward (not blocking implementation)

- Abandoned-test-number reaper (a `phone_status='active'` DID with no `forwarded_from_phone` and no recent `voice_sessions`, costing money with nobody using it) — queryable, not built. Follow-up if it ever matters.
- Auto forwarding-verification heuristic (a session whose SIP caller-ID matches `forwarded_from_phone` proves forwarding works, without asking the owner to self-report) — named, not built.
- Telnyx porting API integration, if one exists and is ever worth automating — deferred until a real port customer, per YAGNI.
