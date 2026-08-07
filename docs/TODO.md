# TODO — SecretaryHQ (single backlog)

**This is the one and only backlog.** Consolidated 2026-07-05 from the former
`GAPS.md`, `IMPROVEMENT_IDEAS.md`, `IMPROVEMENTS_TODO.md`, and
`AIASSISTANT_GO_LIVE_TODO.md` (all deleted; their done items + analysis archived
verbatim in `docs/RESOLVED.md` under the 2026-07-05 entry).

Items are ordered by what should be done first. Ownership tags:
`(Dale)` = user/ops action, no code · `(code)` = codeable now · `(blocked)` = waiting on an external gate ·
**untagged** = deferred code work (the P3 / UX / doc-hygiene sections — no per-item owner because nothing there is scheduled).

**Not backlogs (left as reusable procedure/reference, do not fold here):**
`docs/BRANCH_CHECKLIST.md`, `docs/CODING_STANDARDS.md`, `docs/DEPLOYMENT.md`,
`docs/DEVELOPMENT_WORKFLOW.md`, `docs/ALERTS.md`. Completed work + history: `docs/RESOLVED.md`.
Voice/Telnyx go-live ops detail + incident recovery: `docs/RUNBOOK.md` §7.

---

## 📞 Live-call fix series (2026-07-30) — see `docs/CALL_FIX_PLAN.md`

The 12 real calls from 2026-07-26/27 (`CALL_IMPROVEMENTS.md`, root) produced an
8-batch PR plan: **G** (job-call capture completeness — role_description dropped
end-to-end, outcome mislabel, false "message" promise, stall detector, offer-meeting
on the live path) → **H** (per-call tool-call log + transcript fidelity) → **A**
(caller context/appointments reach the model) + **B** (booking mechanics, timezone,
cross-call duplicates, roster) → **C** (availability reason codes) → **D**
(corrections propagate) → **E** (junk "Caller" rows, urgency) → **F** (silence
handling, greeting metric, inbox unification). Full detail, cut lines, and the four
recurring failure classes: `docs/CALL_FIX_PLAN.md`.

---

## 🔴 P0 — Launch blockers (clear before the first paying customer)

Ordered: the product must answer + transfer + book on a real call, then take money,
then be gated/insured. Most of this is your action, not code — the code is shipped.

### 1. Voice path — make a real call work end-to-end

_Post-live voice enhancements (recording disclaimer, etc.) live in **🎙️ Voice — Phase 2** at the bottom of this file._

- [x] **(Dale)** Enable **call transfer / REFER** on the Telnyx SIP Connection (`livekit-outbound`). ~~Until then `transfer_call` fails at runtime and the agent silently degrades to taking a message.~~ **RESOLVED 2026-07-07**: No toggle exists in Telnyx UI — FQDN connections support SIP REFER by default. Nothing to configure.
- [x] ~~**(Dale)** Confirm `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` are set on Railway~~ — **DONE 2026-07-09.** All three present. **`TELNYX_PHONE_NUMBER` held the DEAD `+16308661960`** (order deleted); corrected to `+16308229086` and the backend redeployed (`started_at` `23:49:38Z`).
  - **What it was breaking:** the var is the outbound-SMS `from` fallback (`tenantConfig.inboundPhone || process.env.TELNYX_PHONE_NUMBER`, `smsService.ts:66,147` + `appointments.ts:710`). Any tenant without its own `inbound_phone` was sending confirmations/reminders from a number Telnyx no longer owns → provider rejects → silent `status='failed'` rows in `communications_history`. **Inbound voice was unaffected** (routing is Telnyx number → SIP Connection, not this var), which is why the 2026-06-30 live-call test passed while SMS was broken.
  - **Why nothing caught it:** `featureReadiness.ts:68,81` checks only that the var is _set_, never that Telnyx still owns the number. A set-but-dead credential reads as healthy.
  - Only the backend reads this var — `agent/` and `dashboard/` never do (agent takes the transfer target from tenant config, not env). Single fix sufficed.
- [ ] **(Dale, use wife's phone)** **Live validation call** — do these steps together in one sitting:
  1. Set the **forward number** on the dashboard AI Persona → "Forward Calls to a Person" (`+1 608 217 5303`) before calling.
  2. Have wife call `+1 630-822-9086` (must use her phone — can't call from your cell and forward to it).
  3. Validate booking: appointment lands in `appointments` for tenant `d5e3c6a1` inside a real shift window.
  4. Validate transfer: say "talk to a person" → your cell rings + Calls tab shows the transcript.
  5. Validate dialog: agent asks preferred time, widens when none fit, never imposes a slot, recalls preferences across calls.
     (PSTN inbound itself already confirmed 2026-06-30; this closes the booking + transfer + preference legs.)

### 2. Billing — be able to take money

- [ ] **(Dale)** **Decide final tier pricing** before creating Stripe products — current placeholders ($129/$279) have not been validated. Research findings + cost model (2026-07-07):
  - **Variable cost per call (5-min avg):** Telnyx ~$0.03 + LiveKit ~$0.02–0.05 + Deepgram STT $0.02 + OpenAI LLM ~$0.001 + TTS ~$0.02–0.09 = **~$0.09–0.17/call**
    - ⚠️ **Stale input (flagged 2026-07-28):** the TTS figure is OpenAI's, and TTS moved to **Deepgram Aura** on 2026-07-14. The LLM also moved 4o-mini → **4.1-mini**. Both legs need re-pricing from current provider rates before this model is used to set a price — deliberately NOT guessed here.
  - **Loss point:** an uncapped Solo tier at 1,000 calls costs $90–170 in variable cost alone — near-zero or negative margin at $129/mo
  - **Recommended Solo cap: ~300–400 calls/month** → variable cost ~$27–51, gross margin ~$78–102 on $129/mo
  - **Competitor benchmarks (verified July 2026):** Rosie AI $49/$149/$299 (250/1,000/2,000 min); Goodcall $79/$129/$249/agent (100/250/500 unique customers/mo); Signpost $199/$399/$749 (AI-only → hybrid human+AI)
  - **Key differentiator to keep:** include booking + call transfer at ALL tiers — competitors (Rosie, Goodcall) gate these to mid-tier. Lead with "full receptionist from day one."
  - **Suggested tier shape:** Solo ~$99–129/mo (1 location, ~300 calls/mo cap, full booking+transfer) · Growth ~$199–249/mo (multi-location or higher volume, Square CRM sync, analytics) · Pro ~$349+/mo (unlimited volume, priority support)
  - **Volume metering is NOT built yet** — tiers are flat subscriptions today; cap enforcement + usage meter is a P1 build item (see P2 section below). Go flat-rate for first customer, retrofit volume once real usage data exists.
- [ ] **(Dale)** **Stripe setup — part A: test-mode wiring. NO BANK ACCOUNT NEEDED.** A bank account gates **payouts**, not API configuration; every step below works today on the `sk_test` key prod already carries. Test mode has its own separate keys and webhook endpoints, so none of this touches live money. Only the pricing decision above is a real prerequisite (price IDs get baked into env vars).
  1. **Create products + prices** in Stripe **test mode** — Solo, Growth, Pro. Note the 3 price IDs.
  2. **Set 5 env vars on Railway**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID`.
  3. **Register the webhook** in Stripe dashboard → `https://secretary-hq-production.up.railway.app/billing/webhook` for 3 events: `checkout.session.completed`, `invoice.payment_failed`, `customer.subscription.deleted`.
     - **Status 2026-08-04: NOT registered.** Probed the live account directly — `webhook_endpoints` returns **zero** endpoints, and prod's `STRIPE_SECRET_KEY` is an `sk_test` key. CLAUDE.md's Production section states this URL as if it were wired; it is not. Nothing has ever delivered to it.
  4. **Test-mode round-trip** (no real money): run `stripe listen --forward-to https://secretary-hq-production.up.railway.app/billing/webhook`, trigger a test checkout, verify each event activates/revokes the tenant gate. (`./scripts/simulate.sh stripe` path-checks the wiring first.)
- [ ] **(Dale)** **Stripe setup — part B: live mode. THIS is what needs the bank account.** Do only after part A's round-trip passes.
  1. **Open an LLC bank account** for Thinking Hammer LLC — required before Stripe can pay out. (Also listed under Legal §5 below.)
  2. **Connect bank account to Stripe** — Stripe dashboard → Settings → Bank accounts & scheduling.
  3. **Re-create products + prices in LIVE mode** — test-mode objects do not carry over. New price IDs.
  4. **Swap the 5 Railway env vars to live values** — live secret key, live price IDs, and a **new** `STRIPE_WEBHOOK_SECRET` (live-mode endpoints are separate objects with their own signing secret).
  5. **Register the webhook again in live mode**, same URL and same 3 events.
- [ ] **(Dale)** **Stripe Tax** (after round-trip verified): enable Stripe Tax in Stripe dashboard → Tax → Settings; register nexus for IL + customer states; set `STRIPE_AUTO_TAX=true` on Railway. (Code done — `automatic_tax` gated behind the flag.)

### 3. Deploy gate — protect main

- [x] ~~**(Dale)** Enable the **"Wait for CI"** toggle on the 3 Railway services~~ — **DONE 2026-07-09.** Enabled on all 3 (`secretary-hq`, `secretary-hq-agent`, `dashboard`) at Railway → Service → Settings → Source → "Wait for CI" ("Trigger deployments after all GitHub actions have completed successfully"). Railway stages settings edits — they only take effect after clicking **Deploy** on the "Apply N changes" banner. The Railway GitHub App already held `checks` + `commit statuses` read/write on all repos, so no permission grant was needed.
  - **Caveat:** this is **unversioned dashboard state** — `railway.json` has no field for it. If a service is ever recreated the toggle silently reverts, and nothing in the repo will tell you. Re-check after any service recreation.
  - **Caveat:** the setting waits on _all_ GitHub Actions on the commit, not on the branch-protection required-checks list. Any future workflow that runs on `main` and can fail will also block deploys.
- [x] ~~**(Dale, code)** **Prove the gate** end-to-end~~ — **PROVEN 2026-07-09 (PR #227).** A deliberately-failing test made `Backend` red → `mergeStateStatus: BLOCKED` → `gh pr merge` **refused** with `the base branch policy prohibits the merge`. Deleting the test flipped all 4 checks green → `CLEAN` → merge allowed. Branch protection holds.
  - **Not tested, deliberately:** `gh pr merge --admin`. If `enforce_admins` didn't hold, that would merge a failing test to `main` and deploy broken code to Railway. The API reports `enforce_admins: true` — verified-by-config, not by experiment.
  - **This proves the MERGE gate only.** The **deploy** gate is still open: after #226 merged, Railway brought up the new backend at `19:27:03Z` while CI didn't go green until `19:31:27Z` — prod deployed ~4 min _ahead_ of its checks. That is exactly what the "Wait for CI" toggle above closes. Branch protection stops a red PR from merging; nothing yet stops a merged commit from deploying before CI confirms it.

### 4. Security housekeeping

- [ ] **(Dale)** **Rotate the Railway team token** created 2026-06-12 — it was pasted into a Claude session. Burn + reissue.
- [ ] **(Dale)** **Rotate the Supabase DB password** — exposed in a session transcript 2026-07-11.


### 4b. Code review 2026-07-13 — four-reviewer sweep (backend, security, reliability, dead code)

> **Adversarially re-reviewed 2026-07-13 (Opus).** Two of my findings were **REFUTED and dropped**:
> **CORS is NOT open in prod** (`curl -H "Origin: https://evil.example.com"` → `access-control-allow-origin: https://www.secretaryhq.com`; Railway sets `CORS_ORIGIN`, only the code _default_ is bad), and my **`message_delivery_status` RLS finding was measured against the LOCAL database and reported as production** — where it is in fact RLS-enabled-with-zero-policies (see 4a). The proposed "fix" would have changed nothing under BYPASSRLS and then been written into `SECURITY.md` as "RLS enforced" — worse than leaving it.
>
> **Severity corrections:** `isTenantExempt`'s blanket `/tenants/*` exemption is **not latent** now that middleware is the sole boundary. The schedule-extender poison is **over-rated** (it is a _future_ regression needing an owner to add a far-future one-off shift — it is NOT the bug that killed the 2026-07-12 call, which was simply "the schedule ran out"). `ENABLE_VOICE_SESSION_REAPER`/`ENABLE_SCHEDULE_EXTENDER`: **my proposed "fix" was a regression** — those vars _do_ work outside production (that is how the realdb tests drive the workers); the real defect is the inverse (no way to turn a worker **off** in prod).

Every item below was **verified by reading the code**, not inferred. Ranked by what bites first.
The two CRITICALs are **fixed on branch `fix/jwt-type-confusion-and-context-gate`** (not yet merged).

**A grounding fact that reframes the rest:** production has **never booked an appointment** — 5 voice
calls, **0 appointments, 0 reminder_schedules, 0 communications_history**, all time. So no reminder
has ever been seeded, no SMS ever sent, and no self-service token ever minted. Several findings below
are unexploited _only because the feature has never once run_. The first real call is the moment they
all go live at the same time.

**CRITICAL — fixed on branch, awaiting merge**

- [x] ~~**Self-service SMS link authenticated as tenant OWNER.**~~ Cancel/reschedule tokens are signed with the same `JWT_SECRET` as sessions; `verifyToken` couldn't tell them apart and the hook did `role: decoded.role ?? 'owner'`. Anyone holding an appointment-confirmation text could replay it as a Bearer token and dump the tenant's customers/appointments/transcripts via `GET /export/tenant-data` for 24h, no password. Never exploited — no SMS has ever been sent. **Fix: every token declares a `typ`; each verifier accepts only its own kind; no owner default.**
- [x] ~~**The OTP gate guarded 1 of 3 doors.**~~ `identify-caller` was gated 2026-07-13; `customer-context` and `customer-history` returned the same name/preferences/history with **no check**, and the LLM picks the phone number it passes. Found independently by two reviewers. **Fix: one shared `callerMayHearCustomerData()` in front of all three; `phone_source` defaults to the cautious `'spoken'`.**

**HIGH — the OTP gate is still weaker than it looks**

> **Re-audited 2026-08-03 while wiring the tools into the live call (below): three of the four findings here were already fixed in `src/routes/agentTools/identity.ts` — this section had drifted stale the same way §4a had. Re-verified by reading the current code, not carried over on trust.**

- [x] ~~**OTP verification is phone-global for 24h, not call-bound.**~~ **FIXED** (`identity.ts:99-116`, `callerMayHearCustomerData`) — the gate now requires a `phone_verifications` row whose `call_id` matches the live call; a NULL/missing `call_id` can never satisfy it. Backed by migration `20260714000000_phone_verification_call_binding.sql`.
- [x] ~~**A 4-digit code is brute-forceable because the attempt cap resets per code.**~~ **FIXED** (`identity.ts:837-874`) — attempts are now summed per `(tenant, phone)` over a rolling 1-hour window across every code issued (not per-row); a resend expires all prior live codes first (one live code at a time); a lockout emits `errors_total{event="otp_phone_locked_out"}`.
- [x] ~~**A verified caller still can't cancel, reschedule, or hear their appointments.**~~ **FIXED** (`agent/src/tools.ts:854-876`, `verify_phone_code`) — on `verified:true` the tool now sets `ctx.callerPhone` to the server-normalized E.164 number, so `get_my_appointments`/`send_self_service_link`/cancel/reschedule stop hard-bailing after a successful OTP.
- [ ] **(code)** **`find-customer-by-name` still enumerates real customers' NAMES on an unanchored `ILIKE '%…%'`.** "My name is Smith" (or one common letter) returns up to 5 real customers. Address-book enumeration where the caller supplies the only credential. **Half fixed as of #322 (`6d94cf9`, 2026-08-07): the phone is now MASKED** — `maskPhoneForConfirmation` in `identity.ts` emits `+1•••-•••-1234`, so the "is this still your number?" confirmation no longer reads a full number to whoever guesses a name right (`tests/integration/agentToolsCustomerSearch.realdb.test.ts` pins the masked shape). **Still open: the match itself.** An unanchored substring ILIKE over `name` still confirms WHO is a customer here, and the last 4 digits still leak. Fix: require a near-exact match (and consider requiring more than a bare surname). **This is why it is deliberately still OUT of the toolset-wiring fix below** — masking narrowed the blast radius, it did not close the enumeration.
- [x] ~~**None of the above ever ran on a live call anyway.**~~ **FIXED 2026-08-03.** All three backend fixes above were correct and complete — and entirely unreachable. Production runs question trees (`agent/src/checklist/`), and `checklistTools.ts`'s `selectedTools()` builds the model's toolset from an allowlist (`TREE_PASSTHROUGH_TOOLS`) that never included `send_verification_code`, `verify_phone_code`, or `get_customer_context` — they existed fully built in `agent/src/tools.ts` but no call could ever reach them. **They ARE capability-gated, in a second and independent place** (corrected 2026-08-07 from PR review — the earlier "confirmed unconditional" reading was wrong): `tools.ts:87-88` maps both OTP tools to the `'verification'` capability, `buildTools` drops them unless `capabilities` includes it (`tools.ts:280`), and `index.ts:884-890` filters `'verification'` out of `activeCapabilities` whenever `ENABLE_PHONE_VERIFICATION` is false. So a tool must clear BOTH gates to reach a live call — the tree allowlist AND the capability list — and neither implies the other. Do not read the fix below as "the OTP tools are always present in ToolContext"; with phone verification off they are absent regardless of the allowlist. A forwarded-line caller could never be recognized or verified, no matter what the backend was ready to do. Fix: added `identity: ['get_customer_context', 'send_verification_code', 'verify_phone_code']` to `TREE_PASSTHROUGH_TOOLS` — the `identity` tree is selected on every goal-bearing call. `find_caller_by_name` deliberately excluded (see item above). 2 new tests in `checklistTools.test.ts`; full agent suite (83 files / 1295 tests) + typecheck green.

**HIGH — SMS/reminders: the feature is about to run for the first time, and it is blind**

- [ ] **(code)** **The retry policy is unreachable dead code.** `ReminderService.processReminder` catches everything and marks the row `'failed'` itself — it never rethrows. The worker's `catch` (which owns `decideRetry`, `retry_count`, the 5m/30m/2h backoff) therefore **cannot execute**. One transient Telnyx 5xx permanently kills a reminder. `retryPolicy.ts` + migration `20260514000000` are decoration. Prod confirms: `max(retry_count)` is NULL. Fix: rethrow transient errors; let the worker own the terminal-status call.
- [ ] **(code)** **A reminder cancelled for "no consent" is silent** — no log, no metric (`reminders/index.ts:233`). If the LLM ever forgets to ask permission, every confirmation is dropped with **zero trace**. Highest-value single line in the whole sweep: `remindersSkippedTotal.inc({reason:'no_consent'})` + a 5W warn.
- [ ] **(code)** **`sms_sends_total` misses half the sends, and `reminders_sent_total` is never incremented at all.** The counters live only in `ReminderProcessor` — a class **instantiated nowhere** (see dead code below). The raw `sendSms()` path (OTP, page-owner, take-message, self-service link) increments nothing and writes no `communications_history` row. So the `ALERTS.md` SMS-failure-ratio alert evaluates 0/0 forever, and "SMS is silently broken" is exactly the state we could not detect. Fix: increment inside `sendSms()` itself (the chokepoint — one edit covers six call sites) and move the reminder counters into the live `ReminderService`.
- [ ] **(code)** **Unbounded `fetch()` to Telnyx can wedge the reminder worker permanently.** No AbortController in either SMS path. The worker is guarded by an `isRunning` flag, so one hung TCP connection pins it `true` **forever** — all reminders and the demo-tenant cleanup stop, silently, until redeploy. `/health` stays green. Fix: `AbortSignal.timeout(10_000)` in both fetches + a stuck-tick watchdog.
- [ ] **(code)** **SIGTERM doesn't drain in-flight worker ticks** — Railway sends one on every deploy, the reminder tick runs every 60s, and the pool closes underneath a mid-flight batch. A deploy can abort a batch _after_ the SMS left Telnyx but _before_ the row flipped to `'sent'` → the customer is texted **twice** on next boot.

**MEDIUM — correctness in the code shipped 2026-07-12/13**

- [ ] **(code)** **One far-future shift row poisons the schedule extender forever.** `tail` is `MAX(shift_date)` over _all time_ and the pattern is the 7 days ending there. Add a single one-off shift 300 days out ("annual inventory Saturday") and the pattern becomes **Saturday-only**; Mon–Fri quietly stop being extended and the business is unbookable again in ~180 days — by the very worker written to prevent that.
  - **⚠️ All three fixes I first proposed are WRONG** (Opus review, 2026-07-13). _"Last week at or before `LEAST(last_date, CURRENT_DATE+horizon)`"_ is **self-referential** — after the extender's first run `last_date` **is** ~`CURRENT_DATE+180`, so it selects the extender's own output. _"Densest recent week"_ picks the busy leg of a 2-week rotation and **over-schedules the light leg** — and over-scheduling is _worse_ than under-scheduling (under-scheduling loses a booking; over-scheduling puts a real customer in front of a locked door). _"Last week with ≥3 distinct weekdays"_ **breaks the Saturday-only owner** — no week ever qualifies, the extender never runs for them, they go unbookable. That is the bug, re-created.
  - **The real fix: STORE THE RULE.** `extendSchedules.ts` says it outright — _"`employee_schedule` does not store a rule"_ — and the Setup wizard **has** the weekly pattern and throws it away (`expandWeeklyToSchedule.ts`). Add `employee_schedule_pattern (tenant_id, employee_id, dow, start_time, end_time)`, write it from the wizard, project from the **declared rule**. One migration, ~30 lines, and this entire bug class evaporates. Everything else is archaeology on rows to reconstruct an intent we deleted on purpose.
  - Interim heuristic if the rule table is deferred: derive per-`(employee, dow)` from the most recent row in `[CURRENT_DATE - 28, CURRENT_DATE + 14]` (immune to a far-future one-off AND to the extender's own output); never project a `dow` with **zero** worked instances in that window; use a 14-day `(shift_date - anchor) % 14` key when the four weeks aren't identical.
- [ ] **(code)** **`SIGTERM drain` + `atomic claim` are ONE bug, and it fires on EVERY DEPLOY.** The reminder worker has no atomic claim (no `FOR UPDATE SKIP LOCKED`, no flip to `'sending'`) **and** SIGTERM doesn't drain in-flight ticks. Railway SIGTERMs on **every deploy**; the tick runs every 60s. A deploy landing mid-`processBatch` — _after_ Telnyx accepted the SMS, _before_ the row flipped to `'sent'` — **double-texts the customer on next boot.** This is not a hypothetical second replica; it is a routine deploy. **One fix closes both:** claim rows with `UPDATE reminder_schedules SET status='sending' ... FOR UPDATE SKIP LOCKED RETURNING *`.
- [ ] **(code)** **The alternatives search offers slots the booking then refuses.** It hardcodes `durationMinutes: 30` and drops the resolved service's real duration + required skills. A 90-minute service gets offered a 30-minute gap with an unskilled employee → the caller says yes → `NO_SKILLED_EMPLOYEE`. The 2026-07-12 dead-end becomes a rejection loop.
- [ ] **(code)** **`'Caller'` is still an unfixable placeholder on the OTHER write path.** `customerLookup.ts` learned the shared `PLACEHOLDER_NAMES` list; `identity.ts`'s `ON CONFLICT DO UPDATE` still only overwrites `NULL/''/'Valued Customer'`, while `scheduling.ts` writes `'Caller'` on every nameless booking. Book-then-give-name → stuck as "Caller" permanently, greeted that way on every future call. **This is the exact 2026-07-12 bug, still live.**
- [ ] **(code)** **`purge-soft-deleted.ts` `--older-than` typo → `NaN` → cutoff silently dropped**, and `--execute --yes` then hard-deletes **every** soft-deleted tenant, including one deleted a minute ago. Reject `NaN` explicitly.
- [ ] **(code)** `/metrics` compares its bearer token with `!==` — use the `timingSafeEqual` helper the agent secret already uses. `GET /templates/full` is reachable **anonymously** and returns every system prompt + first message (platform prompt IP; no PII). `isTenantExempt` exempts _all_ of `/tenants/*` regardless of the list (`path.startsWith('/tenants/')` ignores the loop var) — not exploitable today since every route self-checks, but a new `/tenants/*` route inherits **no** middleware protection.

**Dead code / simplification** (see also 🧹 Doc hygiene)

- [ ] **(code)** **Delete the orphaned parallel reminder implementation — 391 lines, zero prod callers.** `services/reminders/reminderProcessor.ts` + `services/reminders/reminderScheduler.ts` are a second, unused implementation whose only caller is a discarded `_`-prefixed dynamic import and a test. The **name collision with the live `workers/reminderScheduler.ts` is what hid it** — and it holds the metrics that were supposed to be watching prod. Its `reminderProcessor-metrics.test.ts` gives the dead class a green-CI halo. Textbook "test it or delete it".
- [ ] **(code)** **Live `n8n` trigger fires on every appointment INSERT** for an integration with **zero application surface** (`n8n_webhook_url` has no readers/writers anywhere). It's `SECURITY DEFINER` and, if `pg_net` were ever installed, would POST **synchronously inside the booking transaction**. Drop the trigger, the function, and the column.
- [ ] **(code)** **`shared/dateTime.ts` — 85 lines, 8 exports, zero importers.** The only fully-orphaned file in the monorepo. Delete.
- [ ] **(code)** **`TelephonyProvider`: 4 of 5 methods are dead Twilio residue** — both adapters `throw` on them, and `MockAdapter` still emits **TwiML XML** for a stack that dropped Twilio months ago. Collapse to `{ getName, sendSMS }` (~120 lines); the registry's one real job (the no-creds Mock switch) is a one-liner.
- [ ] **(code)** **42 of 158 migrations self-manage a transaction the runner already owns.** Their inner `COMMIT;` ends the runner's `--single-transaction` early, so the `schema_migrations` INSERT lands separately — **the all-or-nothing guarantee in `setup-db.sh`'s own comment does not hold**, and a failed rebuild can leave DDL applied with no tracking row. Inert against prod (already applied); fixes `db:rebuild` + fresh environments.
- [ ] **(code)** Inert columns to drop: `business_templates.voice_provider`/`voice_name` (backfilled `'cartesia'`/`'elevenlabs'` — providers that don't exist here, and `SELECT *` ships them to the dashboard), `tenant_integration_settings.webhook_secret` (Jobber-era). `ENABLE_VOICE_SESSION_REAPER`/`ENABLE_SCHEDULE_EXTENDER` are prod-on-only toggles: they run in prod unconditionally and can only be used to enable those workers in non-prod. Decide whether to keep that asymmetry or add explicit disable knobs. `ProviderRegistry`'s `JEST_WORKER_ID` branch is dead (repo is Vitest-only). `STRIPE_AUTO_TAX` is set nowhere, so `automatic_tax` has **never** been sent to Stripe despite RESOLVED.md listing it as shipped.
- [x] ~~**CLAUDE.md called `tts_soft`/`tts_cheerful` "inert"** — false, and dangerous next to "delete on sight."~~ **Fixed 2026-07-13.** They are live LLM prompt-style flags with dashboard toggles; deleting them would have removed two working features. HIPAA-residue sweep came back **clean**.

### 5. Legal / business (long lead time — start early)

- [ ] **(Dale)** Open an **LLC bank account** for Thinking Hammer LLC (required before Stripe payouts).
- [ ] **(Dale)** Publish + link **legal docs** — Bonterms SaaS ToS + Privacy Policy + DPA (free, lawyer-drafted).
- [ ] **(Dale)** Add **TCPA-compliant SMS opt-in** consent language at booking time — required before any confirmation texts.
- [ ] **(Dale)** **E&O insurance** before the first paying customer (~$800–1,200/yr; Next/Hiscox).
- [ ] **(Dale)** **Cyber Liability insurance** before the first paying customer (often bundled with E&O).

---

## 🟠 Legal-hold — built, DO NOT merge/enable without sign-off

Both erase PII irreversibly (kill-switched off / inert until enabled). Branches deleted in the 2026-06-23 cleanup; restorable from the PR pages.

- [ ] **(blocked — legal)** **PR #68** — `POST /customers/:id/purge` owner-gated single-customer GDPR/CCPA erasure (typed phone confirmation, atomic anonymize-in-place + audit_log PII redact, kill-switch `ENABLE_CUSTOMER_PURGE`; 8 tests).
- [ ] **(blocked — legal)** **PR #69** — disabled-by-default automated retention/purge worker (`ENABLE_RETENTION_WORKER` + explicit `RETENTION_DAYS`, no default window, per-tenant-failure-isolated; 9 tests). Broader-PII scope (`voice_sessions`/transcripts/appointment descriptions) is a deliberate follow-up.

---

## 🟡 P1 — Customer success & trust (non-blocking, do after P0)

- [x] ~~**`/demo/start` per-IP limiter is a global bucket**~~ — **investigated 2026-07-08, NOT a bug.** A controlled 16-min quiet-window test returned 200, so the window resets normally; the persistent 429s were self-inflicted test traffic. A spoofed `X-Forwarded-For` has no effect because Railway overwrites it with the true client IP (correct, non-spoofable). No action.
- [x] ~~**(code)** **Telnyx webhook verifies a re-stringified body.**~~ **FIXED 2026-07-09.** `/communications/telnyx/status` now HMACs `req.rawBody` (the exact received bytes), like `billing.ts`/`square.ts`. Signature verification was also moved **before** payload parsing — previously an unsigned caller reached the parse path and the route's safety rested on the id/status guard firing first (the parser synthesizes `{}` for an empty body). Compare is now `timingSafeEqual`. The old happy-path test hardcoded `JSON.stringify(payload)` as the signed bytes, so it could never see the bug; replaced with a regression test that signs raw bytes whose key order + whitespace `JSON.stringify` would not reproduce (asserted non-equal, so the test has teeth — verified failing against the old code).
- [x] ~~**(code)** **`npm run prepare-commit` reports a false failure.**~~ **FIXED 2026-07-09.** Two independent causes, both of which kept the gate red on a pristine `main`:
  1. `run_or_skip` eval'd each configured command in the parent shell, so the `cd dashboard` chained into `checks`/`unitTests` leaked out and stranded every later step in the wrong directory (`Missing script: "verify:claude-md"`). Each command now runs in a subshell — `if (eval "$cmd")`.
  2. Step 4's `focusedTestScan` regex was `(\.only\(|\.skip\()`, which flagged every **conditional** skip (`test.skip(process.env.FOO !== '1', …)`, `ctx.skip()`) as if it were a focused test — 12 legitimate guards, so the step could never pass. Extracted to `scripts/focused-test-scan.sh`, which flags only `.only(` and skips/todos whose first argument is a **string literal** (i.e. a test disabled by name = dead code). Verified: silent on the clean tree, and still catches an injected `describe.only(...)` / `it.skip('name', …)`.
- [x] ~~**(code)** **Dashboard vitest exits nonzero with 0 failing tests.**~~ **FIXED 2026-07-09.** Surfaced by the now-working `prepare-commit` gate: `Tests 1012 passed` + `Errors 2 errors`. `useEntityList` / `useServiceMappings` in `dashboard/lib/hooks.ts` fetched from an effect with no cancellation, so an unmount mid-flight ran `setLoading(false)` after vitest tore down jsdom → React read a dead `window` → unhandled rejection. Only reproduced under full-suite load. Fixed with a `useIsMounted()` guard on every post-`await` setter; 5 regression tests in `dashboard/lib/hooks.test.tsx` that simulate teardown by deleting `globalThis.window` (verified failing without the guard). Lesson recorded in `docs/LESSONS_LEARNED.md`.
- [ ] **(Dale)** Verify **reminder delivery stats** in prod. **Unblocked 2026-07-09** — Telnyx creds confirmed, and `TELNYX_PHONE_NUMBER` corrected from the dead `+16308661960` (see P0 §1). Note the stats before that fix were measuring a broken `from` address: fallback-tenant sends were rejected by Telnyx and logged as `status='failed'` in `communications_history`. Expect `sent` now. Check the Failed-only drill-down (`GET /communications/history?status=failed`) and confirm no new failures post-`23:49:38Z`.
- [ ] **(Dale/code)** **Pricing tiers (Pro/Enterprise)** positioning.

### Optional integrations — turn on per business need (code complete, need creds + a live round-trip)

- [ ] **(Dale)** **Google Calendar** — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` + GCP OAuth app; prove a real round-trip via `calendarSync.ts` + `SYNC_TEST_RECORDER`.
- [ ] **(Dale)** **Outlook Calendar** — `OUTLOOK_CLIENT_ID/SECRET/CALLBACK_URL` + Azure app.
- [ ] **(Dale)** **Square CRM** — `SQUARE_CLIENT_ID/SECRET/CALLBACK_URL` + `SQUARE_WEBHOOK_SIGNATURE_KEY` + provider OAuth app (code no-ops safely until set).

---

## 🟢 P2 — Quality, scale & ops visibility

- [ ] **(code)** **Volume metering + tier cap enforcement** — do after first customer, once real usage data sets the bands. Data already exists (`voice_sessions` per tenant per month). Build: (1) monthly call counter endpoint; (2) per-plan limit config (Solo ~300–400 calls, Growth ~1,000, Pro unlimited); (3) dashboard usage meter + 80% warning banner; (4) soft cap enforcement. No Stripe Metered Billing needed — flat bands with a DB query. See pricing notes in §2 Billing above.
- [ ] **(Dale/code)** _(Optional)_ Repoint Railway `healthcheckPath` → `/ready` to gate deploy **promotion** on DB reachability (behavior change — could block promotion during a DB blip; your call).
- [x] ~~**(Dale)** **Alert rules** — stand up a hosted monitoring destination~~ — **DROPPED 2026-07-09. No vendor meets the "really free forever" bar.** Researched rather than assumed:
  - **UptimeRobot free is not usable here at all** — since 2024-12-01 its ToS restricts the free plan to _personal, non-commercial_ use, explicitly prohibiting revenue-generating applications. SecretaryHQ is a paid SaaS.
  - **Grafana Cloud free** doesn't expire but is capped: 10K active series, 14-day retention, 3 users; $6.50/1K series beyond. Our worst case is 10 metrics × the 1000-series `MAX_LABEL_CARDINALITY` cap = exactly 10K, and `http_request_duration_ms` (~32 route modules × 3 status families × 12 series) realistically lands ~2–3K. It would fit — but "free within limits that the vendor can move" is not free forever.
  - **Healthchecks.io free** is heartbeat/cron monitoring (20 jobs), not metric thresholds.
  - Every "free forever" tier is free-_within-limits_. Paid vendors (Sentry, Better Stack) were already **declined** 2026-07-02; the code keeps its no-op hooks either way.
  - **`docs/ALERTS.md` stays** as a reusable PromQL reference — the rules are collector-agnostic and cost nothing to keep. If a destination is ever chosen, it's paste-and-go.
  - **The one signal actually worth having** — "SMS failure ratio crossed 20%", which would have caught the dead `TELNYX_PHONE_NUMBER` on day one — needs no vendor. See the zero-vendor option below.
- [ ] **(code)** _(Optional, unscheduled)_ **Zero-vendor alert** — a scheduled GitHub Actions workflow that curls `/metrics` with `METRICS_TOKEN`, evaluates the two `sms_sends_total` / `errors_total` thresholds from `ALERTS.md` §3.9, and opens an issue on breach. No account, no series cap, no ToS that bans commercial use. Costs Actions minutes (~720/mo at a 30-min cadence, against 2,000 free on a private repo). Gives alerts, not dashboards — which is the actual need until real call volume exists.
- [ ] **(code)** **Website-scan re-scan scheduler** — periodic re-scan of stale KB. Deferred: needs a `last_scanned` column/migration + is a cost/product call.

### Structural refactors (folded in from root `07_11_2026_IMPROVEMENTS.md`, 2026-07-28 — that file is deleted; it duplicated this backlog and sat in the root, which by CLAUDE.md holds only CLAUDE.md / README.md / workflow.config.json / DEMO_SECTION.md)

Each status re-verified against the code on 2026-07-28, not carried over on trust. Item 1 of the original nine (**split `agentTools.ts` into a domain module**) is **DONE** — `src/routes/agentTools/` is a directory of 8 modules.

- [ ] **(code)** **Move test files out of `src/` into a parallel `tests/` tree** — still mixed (e.g. `src/services/phoneLoopGuard.test.ts`). Backend convention is `tests/` mirroring `src/`.
- [ ] **(code)** **Extract `src/routes/knowledge.ts` into services** — still **1,087 lines**. Route should orchestrate; scanning/embedding/normalization belong in `src/services/`.
- [ ] **(code)** **Extract `src/routes/analytics.ts` into services** — still **880 lines**. Same shape as above.
- [ ] **(code)** **Group agent tool definitions by capability** — `agent/src/tools.ts` defines **26** tools in one flat file; `agent/src/tools/` holds only `wrapTool.ts`. The capability union (`knowledge | messaging | identity | scheduling | verification | transfer`) exists in types but not in the file layout. **Do this together with the reachability audit below** — the two touch the same file.
- [ ] **(code)** **Reconcile `tools.ts` against what the model can actually reach** (new, 2026-07-27; re-audited 2026-08-03). 26 tools are defined; `selectedTools()` offers **12** under question trees. Some absences are correct (`start_booking` / `manage_appointment` were ladder routers; `book_appointment` / `check_availability` / `get_scheduling_options` are superseded; SMS tools are gated off anyway). Three of the originally-flagged absences are **resolved 2026-08-03**: `get_customer_context`, `send_verification_code`, `verify_phone_code` are now wired via `TREE_PASSTHROUGH_TOOLS.identity` (see the OTP section above). `attach_meeting_notes` was already wired (buy_service passthrough) and `identify_caller` is intentionally host-code-only, never model-facing (`checklistTools.ts`'s `maybeIdentify()`) — neither was actually a gap. **Still undecided:** `transfer_call` — _there is no human handoff on a live call_ — plus `page_owner_via_sms`, `save_customer_preference`, `get_detailed_customer_history`, `find_caller_by_name` (the last deliberately still excluded — see the enumeration bug above). Decide per tool: wire it into a tree / passthrough, or delete it.
- [ ] **(code)** **Dedupe `src/services/phoneUtils.ts` / `nameUtils.ts` against `shared/`** — both still exist alongside `shared/phone.ts` + `shared/name.ts`.
- [ ] **(code)** **Finish the dashboard component subdirectory migration** — 87 loose `.tsx` files still at `dashboard/components/`.
- [ ] **(code)** **Dead CRM schema cleanup** — Jobber/HubSpot/ServiceTitan/GoHighLevel columns still referenced in `supabase/baseline.sql` after the 2026-06-12 adapter deletion.
- [ ] **(code)** **Migration chain squash** — 173 files in `supabase/migrations/`. Do when convenient; `baseline.sql` already carries the collapsed schema.

---

## 🔵 P3 — Moat & expansion (deferred until a customer asks — build principle: no integrations on spec)

- [ ] **Square CRM deeper reads** — pull open jobs into voice context; real external OAuth + Stripe + live CRM round-trips in CI (recorder-only today).
- [ ] **Extended self-service** — public portal/login (manage all appointments); waitlist / callback-queue tool; no-show auto-marking + auto-rebook.
- [ ] **Voice enhancements** — post-call "how did we do?" SMS/NPS link; multi-language; real-time owner listen-in / barge.
- [ ] **Product expansion** — booking widget/embed; granular RBAC beyond owner/front_desk; white-label / reseller theming; public API; PDF + analytics export (CSV export shipped #189); SSO/SAML; international numbers (US-centric today); multi-DID per tenant.
- [ ] **Schedule sub-view consolidation (C1+C2)** — merge the 4 scheduler sub-views (calendar/staff/resources/list) → 2 (calendar Day/Month + Team/Resources) with one unified header. `dashboard/components/SchedulerView.tsx`. (large/UX; from the former IMPROVEMENT_IDEAS.) **Open — needs a UX design pass with Dale before build** (it changes the scheduler layout; brainstorm the target shape first).
- [ ] **Threaded demo mode (E1)** — replace the static `/demo` page with a session flag (`isDemoMode`) injecting read-only sample data into the live dashboard shell (stays in sync with real UI automatically). (large.)
- [ ] **Future CRM/platform candidates** (build-deferred per the `docs/STRATEGY.md` vendor heuristic — "how does this vendor make money?") — QuickBooks/Xero, Toast, Apple Calendar (safe infra/transaction partners); Microsoft Teams (notify-only); Vagaro/Mindbody, Acuity/Calendly (competitor-ish → shallow read or import-only).

---

## 🎨 UX backlog (separate workstream — `/ux-expert` audits)

- [x] ~~**BUG — Setup tabs don't scroll**~~ (reported by Dale 2026-07-11) — **FIXED 2026-07-11.** `SetupView`'s sub-tab panel was a plain block `<div>` with `overflow-hidden`. Two failures at once: the leaf views written as `flex-1 … overflow-y-auto` (Services, Resources, Employees, Business Settings) only get a bounded height as flex _children_, so under a block parent `flex-1` was inert — they sized to content, their own scrolling never engaged, and the parent clipped the overspill; and the plain-`<div>` views (Billing, Audit Log, Answer Debugger) have no scroll container at all. So no Setup tab scrolled. Fix: `flex-1 flex flex-col min-h-0 overflow-y-auto` (`min-h-0` is load-bearing — without it the default `min-height:auto` re-inflates the box and the clipping returns). Regression test: `dashboard/e2e/setup-tabs-scroll.spec.ts`, verified to fail against the pre-fix build.
- [ ] **(Dale — BLOCKER)** Review live scheduling **coloring/grading** so Cluster A neutral-language work can proceed (de-grade slices were reverted 2026-05-20; do not re-apply unprompted).
- [ ] **Cluster A — neutral-language / no-grading** (8 surfaces, blocked on the Dale review): `StepReview`, `SkillRelationshipMap`/`SkillMapNode`, `ResourceColumnsView`, `AppointmentListView`, `EmployeeDayFocusPanel`, `AnalyticsView`, `AppointmentDetailPanel`. (Violates the "no percentage/letter grading" product rule.)
- [x] ~~**Wizard Phase B**~~ — reversed from "held" and **shipped 2026-07-05/06** (PRs #204–#208): draft-commit `SetupWizard` + `GoLivePanel` + E2E coverage, merged to main, no prod migration needed. Full writeup + lessons in `docs/RESOLVED.md`.
- [ ] **Wizard Phase B follow-ups** (explicitly deferred in the design doc, not bugs): abandoned-test-number reaper (a `phone_status='active'` DID with no `forwarded_from_phone` and no recent `voice_sessions`) — queryable, not built; auto forwarding-verification heuristic (SIP caller-ID match instead of asking the owner) — named, not built; real Telnyx porting API integration — deferred until a real port customer per YAGNI.
- [ ] **Dense-view decomposition** — track, don't piecemeal: `SettingsView`, `TenantEditPanel`, `CRMView`, `AppointmentView`, `DashboardHome`, `CustomerDetailPanel`, scheduler orchestration, `ShiftManagementView`, `ServiceAssignmentView`/`SkillAssignmentsView`/`SkillMatrixView`. Split each overloaded view into focused sub-components (no file over ~300 lines); sequence with C1+C2 to avoid duplicated churn.
  - _First slice DONE 2026-07-05 (PR #201):_ `VoiceCallsView` 1185→711, extracted `components/voice/` (`callFormatters`, `outcome`, `CallRows`, `MessagesInbox` — each <300 lines; also closed a swallowed-failure defect in the inbox).
  - _Second slice DONE 2026-07-06 (PR #211):_ `KnowledgeBaseView` 1143→408 (`components/knowledge/`), `AnalyticsView` 970→265 (`components/analytics/`), `ShiftManagementView` 960→402 (`components/shifts/`), `DashboardHome` 838→318 (`components/home/`), `ServiceAssignmentView` 816→395 (`components/services/`). 874 dashboard tests green.
  - _Third slice DONE 2026-07-06 (PR #212):_ `AppointmentDetailPanel` 605→248 + `CustomerDetailPanel` 606→124 + `CRMView` 719→288 + `useCustomerForm` hook; `AIConfigView` 673→240 + 5 aiconfig sub-components; `BusinessSettingsView` 612→195 + 4 settings sub-components; `TenantEditPanel` 531→255 + 2 admin sub-components; `AppointmentView` 768→300 + `AppointmentCalendar` + `useAppointmentCRUD`; `VoiceCallsView` 711→243 + `CallListPanel` + `CallDetailPanel`; `SchedulerView` 532→253 + `SchedulerToolbar` + `useSchedulerActions`. 874 dashboard tests green. (`CRMView` landed at 288 lines post-decompose — at the limit, no further split needed.)
  - _Fourth slice DONE 2026-07-07 (PR #217):_ `AnalyticsMetricsGrid` 575→69 (+ `CorePerformanceMetrics` / `EngagementRetentionMetrics` / `ServiceCohortMetrics`); `RecordHistoryModal` 636→282 (+ `VersionTimeline` + `FieldRestorePanel` + `recordHistoryHelpers`); `DeletedRecordsPanel` 455→227 (+ `DeletedRecordRow` + `CopyFieldsModal`); `EmployeeManagementView` (+ `EmployeeCard` + `EmployeeEditModal`); `ResourceManagerView` (+ `ResourceCard` + `ResourceEditModal`); `TeamAccessView` 346→232 (+ `InviteTeamMemberModal`); `BusinessTypeSection` 371→269 (+ `TemplatePreviewModal`); `OutlookLayout` 692→465 (+ `layout/TenantSwitcherDropdown` + `ProfileMenuDropdown` + `ThemeSelectorDropdown` + `MobileTabBar`); `CustomerSidebar` 335→301 (+ `crm/CustomerListItem`); `api.ts` namespaced → `Api.{resource}.{action}()`; `ToggleSwitch` shared primitive. 874/874 dashboard + 2324/2324 backend tests green.
  - _Fifth slice DONE 2026-07-07 (PR #218):_ `SkillMatrixView` 334→212 (+ `skills/SkillMatrix`). Also: 55 new dashboard tests for coverage hotspots (ThemeContext, VocabularyContext, TimeInput, logger, Toast, FeedbackButton) — 874→929 dashboard tests.
  - _Coverage batch 2 DONE 2026-07-07 (PR #219):_ 81 new dashboard tests targeting 0%-coverage views — `coverage.ts`, `VersionBadge`, `SkillManagementView`, `BillingView`, `KnowledgeSuggestions`, `MessagesInbox`, `CRMIntegrationCard` — 929→1010 dashboard tests. **Remaining:** `NewSchedulerView` (1582 — do with C1+C2 scheduler consolidation); other over-300 files are unavoidable coordination code (wizard state machines, layout shell, GoLivePanel).

### Un-audited surfaces — `[REVIEW]` before beta

Each screen below has had NO dedicated UX review (owner-judgment items). Most already had a copy/a11y **partial fix** landed 2026-07-03, plus a **correctness/a11y defect batch 2026-07-05 (PR #200)** — swallowed server-failures (Shift/Resource/Employee/SuperAdmin/BusinessSettings handlers), a cross-tenant config-leak in AIConfigView, and dead controls (details in git / RESOLVED). What remains on each is the **owner-judgment layout/flow call**.

- [ ] **[REVIEW]** `AIConfigView` — "Voice Settings"; raw system-prompt ("the Brain") exposed to non-technical owners; dirty-save `warning` variant.
- [ ] **[REVIEW]** `AnalyticsView` — full layout, empty states, date-range controls, metric usefulness; no-show/"abandoned" semantics.
- [ ] **[REVIEW]** `VoiceCallsView` — list layout, transcript/summary rendering (badges/filters/vocab already aligned + a11y done).
- [ ] **[REVIEW]** `AppointmentView` + `AppointmentDetailPanel` + `AppointmentListSidebar` — 3-panel/high-density flow, mobile, status-change communication.
- [ ] **[REVIEW]** `CRMView` + `CustomerDetailPanel` — search UX, how AI call summaries surface.
- [ ] **[REVIEW]** `ProfileView` — password-change discoverability, "My Profile" vs "Business Settings" boundary.
- [ ] **[REVIEW]** `BusinessSettingsView` — what belongs here vs Setup / AI Persona.
- [ ] **[REVIEW]** `SettingsView` — owner vs super-admin split, overlap with BusinessSettingsView.
- [ ] **[REVIEW]** `EmployeeManagementView` — per-card skill-assignment model, deactivated-staff surfacing.
- [ ] **[REVIEW]** `ShiftManagementView` — team-size-conditional paths, copy-week discoverability.
- [ ] **[REVIEW]** `ResourceManagerView` — zero-resource empty state, mapping-checkbox model, "capabilities" meaning.
- [ ] **[REVIEW]** `ServiceAssignmentView` — is the 3-step wizard right, no-assignment case, cancel/exit flow.
- [ ] **[REVIEW]** `SkillMatrixView` + `SkillAssignmentsView` + `SkillRelationshipMap` — grid legibility at scale, does the map earn its keep, both-views-necessary.
- [ ] **[REVIEW]** `DeletedRecordsPanel` + `RecordHistoryModal` — discoverability, restore/copy-fields flow, version-history comprehensibility (copy-target is customers-only today).
- [ ] **[REVIEW]** `/register` — field order, post-signup first-run experience.
- [ ] **[REVIEW]** `LoginView` + `/forgot-password` + `/reset-password` — forgot→email→reset live proof, error-copy quality, mobile.
- [ ] **[REVIEW]** `SuperAdminDashboard` + `TenantCard`/`TenantCreateForm`/`TenantEditPanel` — admin-interface usability / onboarding friction (Dale-facing).
- [ ] **[REVIEW]** `FirstRunTour` — post-wizard overlay tour content/flow/copy (behavior already correct).

---

## 🧹 Doc hygiene (mechanical, ongoing — low priority)

- [ ] Continue count-drift passes (route modules / migrations / test numbers) after any new route or migration; keep secondary docs synced.
- [ ] Trim remaining historical narrative from active docs into `RESOLVED.md` when it goes cold.

---

## 🎙️ Voice — Phase 2 (after live, needs agent code + redeploy)

### Question-tree call review — 2026-07-21 07:34 call (branch `feat/question-tree-architecture`, room sim-call-1784637271290)

The call succeeded end-to-end (booked 4:30 PM ✓ linked job_inquiries.appointment_id ✓ semantic service match ✓ E.164 phone ✓ "Dale" not "Dale DeMott" ✓ no snake_case spoken ✓) — these are the conversation-layer snags it still had:

- [ ] **(code) Double read-back of the dictated number.** The model read the number back on its own BEFORE calling `record_answer`, got a yes — then the host READ-BACK-NOW directive (added that morning) commanded a second read-back, and the caller confirmed the same number twice. The directive must be conditional: "if you have not already read it back and heard a yes". Add a sim-questiontree grader: agent lines matching the digit pattern == exactly 1.
- [ ] **(code) Redundant "What is the meeting about?" — third strike.** Opener was "talk to Dale about a job position"; the topic was asked anyway. Prompt-tier rule has now failed twice — promote to host: when `set_purpose` selects booking + a subject tree, auto-record `meeting_topic` from the subject tree (job → "a job opportunity"). Grader: forbid the topic question when the opener names one.
- [ ] **(code) Silent-turn recovery fires during close.** After `finish_call`'s goodbye, the post-close thinking→listening flap triggered the nudge → `silent_turn_recovery_failed: "AgentSession is closing, cannot use generateReply()"`. Cosmetic (caller unaffected) but noisy — guard the nudge on session closing/draining.
- [ ] **(code, polish) `set_purpose` passed `caller_name: ""`.** Sanitizer dropped it (no empty record) — pin that with a unit test so an empty volunteered string can never record.
- [ ] **(polish) Salary stored verbatim as words** — "one forty to one hundred and sixty thousand" in `rate_range`. Their-words capture is by design; consider a normalized display form ("$140–160k") for the owner email/dashboard alongside the verbatim.
- [ ] **(polish) Wrap-up turn is 12s long** — passed-along + email instruction + anything-else in one breath. Consider splitting the email ask from the closing question.

- [ ] **(code) OUTAGE VOICE — a caller must never get silence when the LLM is down.** 2026-07-21 08:56 call: OpenAI quota exhausted (`insufficient_quota`), 7 consecutive `agent_session_error`s, and the caller heard NOTHING — greeting, then dead air, "Hello?… can you hear me?", hang-up. Every speaking path was starved: the watchdog's queue probe saw the errored generation's doomed speech handle as "audio imminent" and skipped its holds; the silent-turn nudge is itself a `generateReply` (also 429s, and asynchronously — its catch never fires); the canned escalation line needs a SECOND silent death which got deferred because the caller was speaking. Fix: subscribe to the session error event — on the 2nd consecutive LLM API error in one call, play the CACHED (no-LLM, pre-synthesized) line "I'm having technical trouble on my end — please call back in a few minutes," then close. Also teach the watchdog probe that a speech handle belonging to an errored generation is not "audio imminent."

### Phase 2 backlog

- [ ] Recording disclaimer → deterministic verbatim greeting (Illinois 2-party consent). Needs a `tenants.greeting` column + tenant-config route + `agent/src/index.ts` greeting line (currently hardcoded).
- [x] ~~`get_my_appointments` transfer-fallback string~~ — DONE 2026-07-05 (PR #198): the no-caller-ID fallbacks in `get_my_appointments`/cancel/reschedule now capability-gate the transfer offer (offer a message only when transfer is unwired).
