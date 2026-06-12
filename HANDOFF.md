# Session Handoff — 2026-06-12 (RAG address-gap fix tied off)

Pick-up notes for the next agent/engineer. Source of truth for the task queue is
`docs/TODO.md`; strategy is `docs/STRATEGY.md` + `docs/COMPETITOR_WEAKPOINTS.md`.

This session executed Dale's **10-task autonomous queue**. Below is the exact
state of each task, what's committed where, and how to continue.

---

## Git state RIGHT NOW

- **`main`** — deployed to prod (all 3 Railway services deploy from `main` via
  MERGE; a branch push deploys nothing). Recently merged: PR #13 WHY outcome
  classification, PR #14 RAG accuracy eval, PR #15 Twilio delivery receipts,
  PR #16 communications-history.
- **Branch `fix/rag-address-gap`** (current, this commit) — **task 6 DONE**, see
  below. Tests clean. **Next action: open PR → main** (no migration, code-only).
- **Branch `feat/website-knowledge-import`** (local only, **NOT pushed**) —
  **task 2 WIP**, 3 commits: question-bank tables migration, shared question
  list + businessType tag, seed script. Lives in a separate worktree at
  `~/.config/superpowers/worktrees/secretary-hq/website-knowledge-import`.
  Incomplete — no website fetch/extract path yet.
- No open PRs at handoff time.

## Local dev stack

- Backend `https://localhost:4001` (self-signed). Docker Postgres container
  `ai-sec-db` on `localhost:5433`.
- **Backend changes need rebuild AND restart** (both, per CLAUDE.md):
  `kill $(lsof -ti :4001); npm run build && nohup node dist/src/index.js > /tmp/backend.log 2>&1 &`
- Verify: `./scripts/simulate.sh status|tools|rag|call --env local`.
- `rag` needs the backend on the latest binary + real OPENAI on it.

---

## The 10-task queue — status

| #   | Task                              | Status         | Where                                                                                                   |
| --- | --------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | RAG accuracy eval                 | ✅ DONE        | PR #14 merged                                                                                           |
| 2   | Website-scan onboarding           | 🟡 WIP         | `feat/website-knowledge-import` (local, 3 commits)                                                      |
| 3   | Owner AI copilot (dashboard)      | ⬜ NOT STARTED | —                                                                                                       |
| 4   | Conversational WHY cut            | 🟡 PARTIAL     | classifier shipped (PR #13); copilot/analytics surfacing not done (depends on #3)                       |
| 5   | Communications-history            | ✅ DONE        | PR #16 merged                                                                                           |
| 6   | RAG "address" gap                 | ✅ DONE        | `fix/rag-address-gap` (this branch, uncommitted→committed)                                              |
| 7   | Twilio delivery receipts          | ✅ DONE        | PR #15 merged                                                                                           |
| 8   | `/analytics/stats` follow-ups     | 🟡 PARTIAL     | base route EXISTS (`src/routes/analytics.ts:24`); reliability tiles / remaining stubbed panels not done |
| 9   | Backfill test coverage            | ⬜ NOT STARTED | reminders E2E, OTP + 5 booking error codes — `docs/TODO.md:168`                                         |
| 10  | Reminder delivery monitoring view | ⬜ NOT STARTED | surface `reminders_sent_total`/`reminders_skipped_total` into a dashboard panel                         |

Queue discipline (Dale's standing rules): **each task its own branch + PR**, full
unit + E2E tests where there's UI, run-verified, **merge only when CI green**,
sequential PRs (avoid migration/baseline merge conflicts). Prod = MERGE to main.

---

## Task 6 (this branch) — what changed + WHY

**Problem:** sim-rag showed _"what's your address"_ fell back instead of
retrieving the location doc. `address`↔`located` share no words.

**Root cause (measured with real text-embedding-3-small, not guessed):**

- The 0.5 similarity threshold is unreachable for any vocabulary-gap query —
  text-embedding-3-small cosine clusters ~0.2–0.65; address scored 0.31.
- Worse: the reductive `normalizeForEmbedding` applied to the _query_ made it
  WORSE — it collapsed "what's your address" → "Address inquiry" (0.215),
  BELOW true out-of-scope questions (hamburgers 0.238) → **unseparable by any
  threshold** (full normalize×normalize config gap was −0.02).
- The simple "just lower the threshold" plan was killed by a widened-negatives
  test: domain-adjacent near-misses ("wheel alignment", "open Christmas") score
  0.38–0.45, ABOVE the address positive — the hit/negative window inverts.

**Fix (validated, advisor-reviewed):**

- New `shared/expandQueryForEmbedding.ts` — the INVERSE of normalization:
  additive synonym **expansion** of the query ("address" →
  "address location where located directions"). Lifts address 0.31→0.41 while
  true out-of-scope stays ≤0.25 → clean 0.13 gap.
- Wired into the **policy-answer query path only** (`src/routes/agentTools.ts`),
  replacing the reductive normalize call there. **Docs/ingest untouched** →
  **no re-embed of existing tenant docs needed** (critical: changing ingest
  would strand every already-embedded doc on a stale vector).
- Threshold 0.5 → **0.30** in policy-answer.
- Fail-soft: on any LLM error/timeout the expander returns the raw query
  (never throws — this runs on the live voice call).
- `normalizeForEmbedding` is KEPT for docs + the voice-CRM call-summary path
  (it _helps_ the other 4 cases; only the query path was harmful).

**Files:**

- `shared/expandQueryForEmbedding.ts` (new) + `src/queryExpander.test.ts` (new, 11 tests, 5W)
- `src/routes/agentTools.ts` — expander param + swapped query path + threshold
- `src/index.ts` — create + wire `createQueryExpander`
- `src/agentTools.test.ts` — updated: asserts expander used, normalizer NOT called on query path
- `src/knowledge-policy-answer.test.ts` — stale 0.5→0.3 comments
- `scripts/sim-rag.mjs` — widened eval: +polite address phrasing, +2 out-of-scope negatives
- `CLAUDE.md`, `docs/TODO.md` — doc updates

**Verification:**

- `npm run checks` (format+lint+backend tsc+dashboard tsc) → exit 0
- Backend suite: **5585 tests passed, 0 failed** (the 6 "failed files" were stale
  `.claude/worktrees/` copies — now pruned/removed)
- `./scripts/simulate.sh rag --env local` → **9/9 (100%)**, both address phrasings
  hit, all 3 out-of-scope fall back
- `npm run verify:claude-md` → no drift

**Measurement scripts** (throwaway, in `/tmp`, not committed): `/tmp/rag-matrix.mjs`,
`/tmp/rag-neg.mjs`, `/tmp/rag-ship.mjs` — config matrix + widened-negative sweeps
if you want to re-derive the numbers.

---

## NEXT — recommended order

1. **Open PR for `fix/rag-address-gap` → main.** Code-only, no migration. Wait
   for green CI, merge.
2. **Task 8 — analytics reliability tiles.** Base `/analytics/stats` exists;
   finish the remaining stubbed panels + owner-facing reliability tiles.
   Smaller/contained — good next bite.
3. **Task 9 — test backfill.** Reminders E2E + OTP + the 5 booking error codes
   in the live-QA path (`docs/TODO.md:168`). No new features, pure coverage.
4. **Task 10 — reminder delivery monitoring view.** Surface
   `reminders_sent_total`/`reminders_skipped_total` metrics into a dashboard panel.
5. **Big features last:** task 2 (finish website-scan — fetch+LLM-extract into
   KB, reuse getEmbedding+/knowledge/add; the branch already has the question-bank
   scaffold) → task 3 (owner copilot) → task 4 (conversational WHY surfacing,
   consumes the copilot + the PR #13 classifier).

## Blocked on Dale (agent can't do)

- **Stripe test account + keys** (verify billing paths end-to-end; drop
  `sk_test_…` in `/tmp/stripe`).
- **Railway env check** — needs a fresh team token. Verify `BACKEND_URL` on
  `ai-sec-agent`, `TWILIO_*` / `EMAIL_*` (run mocks in prod when unset),
  `METRICS_TOKEN`/`SENTRY_DSN`/`BETTER_STACK_TOKEN`.
- **Live PSTN call** — 2nd phone, different carrier → `+1 630-822-9086`;
  - enable call-transfer/REFER on the Telnyx SIP Connection + set forward number
    on dashboard AI Persona.
- **Rotate** the Railway team token pasted earlier this session (`400a1ee0…`).

## Strategy in one breath (full: `docs/STRATEGY.md`)

Receptionist-first; cross-platform; non-trades verticals (salons/auto/fitness/
food). Competitor CRMs removed (their vendors ship native receptionists); Square
stays. Build the operational system-of-record, not a full CRM. Stripe = our SaaS
billing only (no service-payment processing). Pricing (deferred): value-aligned
volume — meter on bookings/calls, never seats/minutes.
