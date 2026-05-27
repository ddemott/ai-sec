# REFACTORING_TODO

Curated backlog of **mechanical, structural, and convention-enforcement refactorings** for the SecretaryHQ / ai-sec codebase.

Focus: consistency (PK naming, type shapes), duplication removal, shared-layer extraction, and small cleanups that reduce drift risk or mental overhead. **New features and UX improvements live in `docs/TODO.md` and `docs/IMPROVEMENT_IDEAS.md`.**

**Style guide for entries:** Same markers as `docs/TODO.md` (`IN FLIGHT`, `open`, strikethrough on done). Every item must answer "why it matters" under the CLAUDE.md Build Principles (test against real surface or delete; working flat beats dormant abstraction; extract after 3–4 consumers ask).

**Last updated:** 2026-05-27 (Item 9 completed: schema alignment guard implemented as `verify-schema-alignment.ts` + tests; also advanced item 6 with phone/name shared extractions)

---

## P0 — Duplication & Type Drift (immediate correctness / maintenance wins)

### ~~1. Unify duplicated Voice CRM context types (CustomerNote, VoiceSession\*, AppointmentSummary, etc.)~~

**Status: done 2026-05-27.** Created canonical `shared/voiceCrm.ts` (all core interfaces + `formatContextForAI`). Backend `src/types/voiceCrm.ts` reduced to thin re-export wrapper + the 5 backend-only request/response types (public API shape unchanged — zero call-site edits in `src/`). Dashboard `lib/types.ts` now re-exports the shared names from `../../shared/voiceCrm` (public API for `lib/api.ts`, `VoiceCallsView.tsx` etc. untouched).

**Verification performed:**

- Zero remaining duplicate interface bodies anywhere in source (only in `shared/voiceCrm.ts`).
- `grep` sweeps: 0 hits for old `export interface CustomerNote` etc. outside the shared file.
- Dashboard: `npx tsc --noEmit` → clean (0 errors).
- Backend: `npx tsc --noEmit -p tsconfig.json` → clean (0 errors).
- CLAUDE.md "Key Directories" updated with `/shared` entry + `voiceCrm.ts` note.

**Why it matters:** (original) Two copies of the same contract = silent drift risk exactly where the voice AI and the dashboard both render customer context. Violates "single source of truth" for any data that crosses the backend/dashboard boundary.

**Size:** small (completed in one focused pass)
**Impact:** high (prevents future inconsistency bugs)

### ~~2. Remove stale ReminderSchedule duplicate in the reminders service layer~~

**Status: done 2026-05-27.** Rewrote `src/services/reminders/types.ts` as a pure re-export barrel pointing at the authoritative definition in `src/types/index.ts`. The duplicate (incomplete) interface body was deleted.

**Verification performed:**

- Zero `interface ReminderSchedule` definitions remain anywhere in `src/services/` (full project grep confirmed only the one in `src/types/index.ts`).
- All internal consumers (`reminderRepository.ts`, `reminderProcessor.ts`, `reminders.test.ts`, `index.ts`, etc.) continue to import from `./types.js` transparently.
- Both `npx tsc --noEmit` (dashboard) and root `tsc -p tsconfig.json` returned clean (empty output, exit 0).
- No remaining references to the old local duplicate shape.

**Why it matters:** (original) The local copy was already wrong (missing columns that the worker + retry logic depend on). This is exactly the class of bug that produced the 2026-05-11 `appointment_id` number-vs-UUID crash. Enforces "TS types must match" (CLAUDE.md).

**Size:** small (completed in one focused pass)
**Impact:** high (correctness)

### ~~3. Extract the duplicated appointment time validation logic into `shared/`~~

**Status: done 2026-05-27.** Created `shared/appointmentValidation.ts` with the common constants, `isFifteenMinuteIncrement`, error codes, and `validateAppointmentTimeRange` (rich structured version).

- Backend `src/services/appointmentValidation.ts` → thin re-export.
- Dashboard `lib/appointmentValidation.ts` → thin wrapper preserving its historical `string | null` return shape for existing form callers (QuickBookPanel, AppointmentView).
- No changes required in any call sites (public APIs preserved).
- Both `npx tsc --noEmit` (dashboard + root) clean.
- All three Vitest suites (backend 1389 passed, dashboard 720 passed, agent 99 passed) green — no regressions.

**Verification performed:**

- Full project grep for old duplicated logic locations.
- Typechecks clean.
- Tests (per user request): all unit suites passed with zero new failures.

**Why it matters:** (original) Deliberate duplication for instant client validation is acceptable, but the manual sync tax + risk of drift (especially around the 15-min DB CHECK constraints) is real. `shared/` is the right home.

**Size:** small (mechanical, low blast radius)
**Impact:** medium-high (another win for single-source-of-truth pure logic)

---

## P1 — Naming & Convention Consistency

### ~~4. Normalize `OptOutRecord` to snake_case (match every other domain type)~~

**Status: done 2026-05-27.** Renamed all fields in `OptOutRecord` (`optOutRecordId` → `opt_out_record_id`, `tenantId` → `tenant_id`, etc.) to match the DB columns and every other domain type.

- Simplified aliasing in `src/database/index.ts` (now uses `RETURNING *` and `SELECT *` where possible).
- Simplified mapping logic in `src/services/consentService.ts` (much less snake↔camel conversion needed).
- Updated all test files that constructed or asserted on the old camelCase shape.
- Zero remaining references to the old camelCase field names (verified with grep).
- Both typechecks clean.

**Why it matters:** (original) The explicit rule in CLAUDE.md ("TS types must match") and the entire 2026-05 PK-rename campaign were about eliminating exactly this shape of mismatch. One exception kept the mental model fractured.

**Size:** small (completed in focused pass)
**Impact:** medium (consistency win + removes a special case)

### ~~5. Decide & document the `id` vs `<entity>_id` rule for non-DB, in-memory shapes (CustomerNote, API DTOs, test fixtures)~~

**Status: done 2026-05-27.** Decision (a) with carve-out: default to `<entity>_id` (e.g. `note_id`) for any shape that represents an entity-like object with a stable identifier (even JSON-stored notes, lightweight DTOs, etc.). Bare `id` only for purely local/ephemeral UI state (tab keys, theme names, wizard steps, render-only keys with no wire meaning).

- Renamed `CustomerNote.id → note_id` in `shared/voiceCrm.ts` (the single source).
- Updated the one call site (`key={note.note_id}` in `VoiceCallsView.tsx`).
- Full project grep: zero remaining `CustomerNote` `id` or `note.id` references in source.
- Both `npx tsc --noEmit` (dashboard) and `npx tsc -p tsconfig.json --noEmit` (root) clean.
- Added explicit rule + carve-out guidance + pilot example to CLAUDE.md under "PK column-name convention".
- Updated this file.

**Verification performed:** (as required by AGENTS.md)

- `grep -r "note\.id\|CustomerNote.*id:" --include="*.ts" --include="*.tsx" .` (excluding node_modules) → only the new `note_id` definition.
- Typechecks: both clean (exit 0, no output).
- No other constructions of CustomerNote objects with bare `id` existed in the tree.

**Why it matters:** The PK convention retrofit was a 20+ table, multi-week effort. Leaving "id" lying around in types that look like entities creates exactly the confusion that produced the past `number` vs UUID bug.

**Size:** tiny (mechanical rename + doc)
**Impact:** low but compounds over time (mental model hygiene)

---

## P2 — Shared Layer & Structure Opportunities

### ~~6. Audit + expand `shared/` for other pure cross-boundary logic~~ (in progress)

**Status: 2026-05-27 partial progress.** Two clear duplications extracted:

- **Phone**: Created `shared/phone.ts` (strict `normalizePhone` returning `null` on invalid + `formatPhone` + `isValidPhone`). Backend `src/services/phoneUtils.ts` and dashboard `lib/phone.ts` now thin re-exports. Dashboard test expectations updated to match stricter canonical behavior. One inline split usage in combobox fixed as side effect of the audit.
- **Name**: Created `shared/name.ts` (`splitName`, `joinName`, `buildDisplayName`, `slugify`). Backend re-exports. Replaced inline duplicate split logic in `dashboard/components/ui/CustomerCombobox.tsx` (was doing the exact same `trim().split(/\s+/)` dance).

Both sides typecheck clean. New canonical modules documented in CLAUDE.md.

Remaining candidates from the original item (duration helpers, date-in-timezone, availability math) already have a home in the existing `shared/scheduling.ts` — no additional duplication found in this pass.

**Why it matters:** Every time a pure rule (phone canonical form, name splitting) exists in two places, we re-create the validation-dupe problem that the whole shared/ investment was meant to solve.

Next micro-pass on this item can look for any remaining small pure helpers.

### 7. (Low priority) Evaluate a thin CRUD route factory for the entity managers

**Current:** `employees.ts`, `services.ts`, `resources.ts` (and parts of others) each hand-write very similar list / get / update / delete / soft-delete handlers + Zod schemas + audit wiring + RLS.

**Caveat per CLAUDE.md:** "Working flat code beats a dormant abstraction." These handlers are not identical — each has entity-specific validation, skill/resource mapping side effects, etc.

**What to do:** Only if a 5th similar entity appears, or if the copy-paste tax becomes measurable in bug fixes. Otherwise leave flat. If pursued, keep the factory tiny and local to `routeHelpers.ts` (no new "framework").

**Why it matters (or doesn't):** The build principle explicitly warns against premature shared layers. Document the decision so future developers don't rediscover the same tension.

---

## Documentation & Process

### 8. Formalize the relationship between the various "idea" files

**Current sprawl:**

- `improvement-ideas.md` (root) — pruned generator output; explicitly "decays"
- `docs/IMPROVEMENT_IDEAS.md` — curated
- `docs/TODO.md` — blocking + polish
- `ux-review-notes.md` (root) — archived / reduced UX audit scratchpad (findings triaged into `docs/TODO.md`)
- `NEEDS-REFACTORING.md` — historical major structural wins (mostly done)
- New: `REFACTORING_TODO.md` (this file)

**What to do:** Add a 3-line "Where to record what" table in `CLAUDE.md` (or the top of this file) and a pointer from `docs/README.md`. Example:

- Mechanical / type / duplication / convention → this file
- Product / UX / feature-adjacent polish → `docs/TODO.md` (raw notes archived)
- "Would be nice someday" generator noise → root `improvement-ideas.md` (retired / archived; accept decay)

**Why it matters:** The project already has excellent self-documentation hygiene (drift detector, 5W comments, RESOLVED.md). One more canonical pointer prevents the next person from having to grep four files.

**Size:** tiny
**Impact:** low but high signal-to-noise for future contributors

### ~~9. Strengthen the post-PK-rename contract check~~

**Status: done 2026-05-27.** Created `scripts/verify-schema-alignment.ts` (modeled exactly on the existing `verify-claude-md.ts` pattern of pure `Drift[]` functions + thin main).

- Hardcoded list of the major tables from the 20260512 PK rename wave.
- Cheap parser that verifies the canonical `<table>_id` column (with correct type) exists inside each `CREATE TABLE` block in `supabase/baseline.sql`.
- Added `npm run verify:schema`.
- Added `scripts/verify-schema-alignment.test.ts` (3 tests, all green).
- The checker actually caught a wrong assumption I had about `employees.employee_id` type during development (it is `uuid`, not `integer` in baseline) — exactly the class of error it is meant to protect against.

**Verification:**

- `npm run verify:schema` → clean pass on current baseline.
- Unit tests: all pass.
- Typechecks clean.

**Why it matters:** Prevents re-introduction of the exact family of id-type and column-drift bugs that the big 2026-05 rename campaign was created to fix.

**Size:** medium (new script + tests)
**Impact:** high (ongoing guard)

---

## Closed / Archived

(See `NEEDS-REFACTORING.md` for the full history of completed major refactors: CRM adapter deletion (#1), tenant-config wiring (#2), UsageTrackingService deletion (#3), `employee_shifts` retirement (#4), mock helper extraction, CLAUDE.md drift detector (#13), etc.)

All PK column renames (`*_id` convention) are complete in the live schema (baseline.sql + 25 migrations in the 20260512–18 wave) and the corresponding TS / route / RPC updates. The in-memory carve-out rule for bare `id` (purely local UI state only) + the `CustomerNote` pilot rename were completed 2026-05-27 (see item 5 above). Historical comments updated where relevant.

---

**How to work this list (per AGENTS.md + CLAUDE.md):**

1. Pick the lowest-numbered open item whose scope fits the session.
2. For pure mechanical renames / mass replaces across files: use the exact `grep -rl` + `sed` + "read every changed file" + `cd dashboard && npm run typecheck` workflow. Never claim "done" until `grep` shows zero stragglers and typecheck is clean.
3. For anything requiring new logic or judgment about abstraction boundaries: stop and ask. This list is deliberately scoped to things the mechanical-refactor agent (or a careful human) can execute safely.
4. When an item is complete, add `**Status: done <date> <short-hash>**`, strike the heading, and (after a few) prune the entry. Move truly finished major items to `RESOLVED.md` under the date.
5. If a proposed item turns out to require product decisions, real-customer validation, or a new abstraction layer that would violate the "flat code" rule — promote the question to `docs/TODO.md` instead of forcing the refactor.

This file is the single source of truth for "what mechanical consistency work is still owed to the 2026-05 PK + naming + shared-layer investments."
