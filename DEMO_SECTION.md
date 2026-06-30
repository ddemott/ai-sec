# DEMO — public voice demo (BLOCKED, not started)

> Kept at repo root (not `docs/`) on purpose so it doesn't get lost. This is a
> live worklist, not history. Move to `docs/` + `RESOLVED.md` once shipped.

**Status: BLOCKED.** Do not start the demo build until the prerequisite below is
fixed. The demo talks to the **same** LiveKit agent pipeline a real caller uses —
if real calls don't book meetings, the demo won't either, and we'd be showing a
broken product.

---

## ⛔ PREREQUISITE (must fix FIRST — separate from the demo)

- [ ] **Real inbound calls are not booking meetings.** Open issue from earlier
      work, never resolved. A real call comes in but the meeting booking does not
      complete. This is the next thing we investigate (WHY are calls not creating
      bookings). The demo cannot go forward until a real call reliably books a
      meeting end-to-end.
  - Symptom (as known): real call connects but no appointment row lands for the
    tenant. (Confirm/refine when we dig in.)
  - Likely suspects to check when we start: the booking tool path
    (`book_appointment` / `book_with_scheduling` → `/agent-tools/*` →
    `book_with_scheduling_atomic`), error codes returned to the agent
    (`EMPLOYEE_NOT_SCHEDULED` / `NO_AVAILABILITY` / etc.), whether the agent is
    even calling the booking tool, and whether the prompt drives it to confirm +
    book. Pull a real `voice_sessions` row + transcript + `tool_calls_total` /
    `booking_attempts_total` metrics before theorizing (measure first — see
    `docs/LESSONS_LEARNED.md`).

---

## DEMO (the TODO — unblocks only after the prerequisite)

Goal: a public, browser-based **voice** demo (mic + speakers over WebRTC, **no
phone, no Telnyx/PSTN**). Each prospect gets their own isolated ephemeral demo
tenant (the existing `/demo/start` flow → `is_demo=true`, 30-min TTL). They talk
to the receptionist, it books into _their_ demo schedule, they watch it land in
the dashboard live.

Why browser/WebRTC: same agent brain (Deepgram → GPT-4o-mini → OpenAI TTS), but
**sidesteps the unverified PSTN inbound path**, **drops carrier + number cost**,
and gives **clean per-prospect isolation**. (It does NOT make the AI inference
free — token burn is identical to a phone call; that's why the caps below exist.)

Scope decision (B): this section is the **safety guards that make the voice demo
safe to turn on** + the minimal agent changes they depend on. The pretty demo
landing UI, email lead-capture, dashboard-demo tightening, and the
Realtime-vs-pipeline voice-quality choice are **separate** and out of scope here.

### Already in place (don't rebuild)

- Dashboard demo: `POST /demo/start` → ephemeral tenant (`src/routes/demo.ts` +
  `src/services/demoSeed.ts`). Guards today: per-IP **3 starts / 15 min**, global
  cap **50 concurrent** demo tenants, **30-min TTL**, expired-tenant purge in
  `reminderScheduler`, and `is_demo=true` suppresses **calendar/CRM sync**
  (`syncOrchestrator`).
- Browser voice join mechanism exists internally: `scripts/simulate.sh call` /
  `agent/scripts/sim-call.mjs` (dispatch agent into a room + print a browser join
  URL). Not yet productized for prospects.

### Subtasks

- [ ] **1. Demo-aware capability lockdown — the toll-fraud / spam fix (highest priority).**
      Today `is_demo` only gates calendar/CRM sync; the agent's **outward-firing
      tools are NOT gated**, which is the real abuse vector even without PSTN.
  - [ ] **Agent (primary):** surface `is_demo` from the per-call `tenantConfig`;
        in `buildTools`, a demo tenant gets the capability subset
        **`['knowledge','scheduling']` only**. **Drop** `verification` (SMS OTP),
        `transfer` (dial-out), `messaging` (`take_message` / `capture_job_inquiry`
        → owner email+SMS). The agent never even _has_ those tools. (Capability
        composition already exists — Playbook RULE 5.2.)
  - [ ] **Backend (backstop / defense-in-depth):** `/agent-tools/send-verification-code`,
        `verify-phone-code`, transfer, and message endpoints **reject when the
        tenant is `is_demo`** → return a graceful
        `{ success: true, result: "not available in the demo" }`. Even if a tool
        leaked into the set, the outward action (SMS / email / dial-out) can't fire.
  - Closes: SMS-pumping/toll-fraud via OTP, owner-inbox spam via messages,
    outbound minutes via transfer.

- [ ] **2. Voice-call admission control — new `POST /demo/voice-token`.**
      Separate gate from `/demo/start` (a voice call costs far more than a
      dashboard spin-up). Before dispatching the agent into a room, enforce
      (reuse the existing in-process limiter shape from `demo.ts`):
  - [ ] per-IP: N voice calls / window (IP is the everyday gate — stops ~95% of
        casual abuse; keep the limit **generous** for CGNAT/shared IPs).
  - [ ] global **concurrent** demo voice sessions cap (e.g. 8).
  - [ ] global **daily** demo voice-call ceiling.
  - [ ] returns a short-lived LiveKit join token scoped to a demo room, else
        429/503 ("demo busy, try again").

- [ ] **3. Per-call duration cap.** Agent enforces max minutes for demo calls
      (e.g. **3 min**) → graceful wrap-up line + hangup. Minutes × burn is the
      biggest single cost lever.

- [ ] **Deterministic cost ceiling (falls out of #2 + #3 — nothing to build):**
      worst-case spend = `maxConcurrent (8) × maxMinutes (3) × per-min burn`, plus
      the daily count cap. **No real-time token/$ summing required.**

### Data flow (target)

```
prospect
  → POST /demo/start            (existing — isolated demo tenant + scoped JWT, is_demo=true)
  → click "🎙️ Talk to the receptionist"
  → POST /demo/voice-token      (NEW — per-IP + concurrent + daily admission control)
  → browser joins LiveKit room over WebRTC (mic)
  → agent dispatched, sees is_demo
       → buildTools = ['knowledge','scheduling']   (no verification/transfer/messaging)
       → per-call duration cap armed
  → prospect: "book an oil change Tuesday afternoon"
  → books into the demo tenant; transcript + appointment land in the demo dashboard live
  → 30-min TTL purges the tenant
```

### Testing

- [ ] Agent unit: demo tenant ⇒ `buildTools` excludes verification/transfer/messaging;
      non-demo tenant ⇒ full set (no regression).
- [ ] Backend: `/agent-tools/send-verification-code` (and transfer/message) with an
      `is_demo` tenant ⇒ refused gracefully; non-demo ⇒ unchanged.
- [ ] Admission control: per-IP / global-concurrent / daily limits ⇒ 429/503
      (reuse `demo.ts` limiter test pattern).
- [ ] Agent unit: duration cap fires → wrap-up + hangup for a demo call.

### Risk notes (carried from the design discussion)

- **IP limiting** is the everyday gate (already half-built); bypassable via
  VPN/Google-Voice but near-zero payoff — don't engineer against it. The
  **concurrency × minutes + daily cap** is the real wallet protection.
- **Browser kills** PSTN toll fraud, number spoofing, and cross-tenant leak
  (server-generated `tenant_id` + RLS + TTL purge).
- **Email lead-capture** (deferred, separate spec): if added, validate
  format + **block disposable domains** (no click-gate before the demo — kills the
  funnel), and **rate-limit the send** (copy `/forgot-password` 3/hr/IP) so the
  demo can't be turned into an email-bomb tool. Email is **lead-gen**, NOT a cost
  guard — don't rely on it for abuse control.
- **Infra contention:** cap concurrent demo sessions so a flood can't starve the
  shared agent worker and degrade real tenants.
