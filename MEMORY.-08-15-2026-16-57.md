# SESSION SNAPSHOT — 2026-08-15, 16:57

Where the work stands at the moment this was written. Read `HANDOFF.md` for the
narrative; this file is the state: what is running, what is changed, what is
proven, and what the next person has to do first.

**Nothing is committed. Nothing is merged. Nothing was pushed to production.**
Branch is `main` at `d4f64c2`; every change below lives in the working tree.

---

## 1. What this session was for

"Get local going so when a call happens there is no pause, and no errors during
the calls." Three real mic calls were made through the browser rig against the
LOCAL worker. Each one found defects; each round of fixes was verified by the
next call.

| call | room                                 | what it proved                                                                        |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| #1   | `sim-call-1786817155950` (13:06 CDT) | ~10 s dead air per turn; two turns made no sound at all; booking dead-ended           |
| #2   | `sim-call-1786818806598` (13:33 CDT) | **booked successfully**; turns ~2–3 s; zero silent turns; four conversational defects |

Call #2's appointment: `7575eb61-3c78-41f2-9111-a65dcd7eb9c7`, Mon 2026-08-17
1:00 PM local, linked to a complete `job_inquiries` row
(`bf9601f5-2ec5-4958-9c6c-a1c6898f7b1e`).

---

## 2. Measurements (all measured on this host, not estimated)

| what                             | before    | after      |
| -------------------------------- | --------- | ---------- |
| greeting `ms_since_participant`  | 11,944 ms | **841 ms** |
| WebSocket open to Deepgram       | 11,300 ms | **237 ms** |
| Aura TTS time-to-first-frame     | 11,445 ms | **318 ms** |
| turn latency (commit → speaking) | ~6–7 s    | ~2–3 s     |
| silent turns per call            | 2         | 0          |

Root cause of all of it: `dns.lookup('api.deepgram.com')` = **11,069 ms** on this
WSL host. getaddrinfo waits for A _and_ AAAA; the Windows-side resolver
(`nameserver 10.255.255.254`) takes 11 s on AAAA. `dig AAAA … @1.1.1.1` answers
the same query in 46 ms.

---

## 3. New files (all untracked)

**Agent**

- `agent/src/session/dnsIpv4.ts` + `.test.ts` — `DNS_FORCE_IPV4=true`, **default
  OFF**. Patches TWO seams: the http/https global agents _and_
  `tls.connect`/`net.connect`. The second is what reaches WebSockets — `ws` sets
  its own `createConnection` and never consults an agent. Patching `dns.lookup`
  itself does nothing: `node:net` captures its default lookup at module load.
- `agent/src/session/dnsWarm.ts` + `.test.ts` — resolves call-path hosts in
  prewarm; WARN on any host over 1 s; 8 s cap so a hung resolver cannot hold a
  worker.
- `agent/src/session/workerTuning.ts` + `.test.ts` — `NUM_IDLE_PROCESSES`. The
  LiveKit SDK keeps `min(cpus,4)` idle job processes in production and **0** in
  dev, so locally the caller paid process spawn + VAD load.

**Backend / scripts / tests**

- `scripts/seed-local-business.ts` — `npm run local:business`. Localhost-only
  (no `--force`), idempotent, reuses the resource the tenant INSERT already
  creates. Installs Intro Call (30 min) + Consultation (60 min), one employee,
  Mon–Fri 08:00–17:00 × 4 weeks, and a `default_service_id`.
- `tests/seedLocalBusiness.test.ts`, `tests/routes/agentTools/phoneGate.test.ts`.

Other untracked paths (`greetingPickup.*`, legal pages, question-tree scripts and
migrations, `caller-pickup.spec.ts`, …) predate this session — see `HANDOFF.md`.

## 4. Modified files that carry this session's work

`agent/src/index.ts`, `agent/src/session/watchdog.ts` (+test),
`agent/src/transcript.ts` (+test), `agent/src/checklist/checklistTools.ts`
(+test), `agent/package.json`, `src/routes/agentTools/scheduling.ts`,
`package.json`, `tests/questionTreeRoundTrip.test.ts`,
`tests/services/browserCallerSession.test.ts`,
`dashboard/components/AppointmentView.tsx`,
`dashboard/components/scheduler/QuickBookPanel.tsx`, plus docs
(`HANDOFF.md`, `CLAUDE.md`, `DEVELOPMENT_WORKFLOW.md`,
`docs/LESSONS_LEARNED.md`).

Working tree total: **89 changed/untracked paths**, most of them pre-existing.

---

## 5. Defects fixed, with the evidence that named them

**Latency / silence**

1. DNS stall on both connection seams (above).
2. `ttsReadIdleTimeout` was LiveKit's default **10 s** — measured at 10.003 s and
   10.000 s on the two silent turns. Now an explicit 4 s
   (`TTS_READ_IDLE_TIMEOUT_MS`).
3. The watchdog's `reply_already_queued` branch stood down entirely, so a
   queued-but-frameless reply was covered by nothing for those 10 s. It now arms
   the escalation; the `speaking` transition disarms it, so a reply that actually
   arrives is never talked over.
4. `silent_turn_recovered` claimed "tool-step cap or empty generation". It was
   neither, twice. It now states what it observed and carries
   `ms_since_thinking` (~10,000 is the idle-timeout signature).
5. **The transcript recorded speech nobody heard.** LiveKit builds the assistant
   turn from the LLM token stream, not from playout. Those lines now render
   `Assistant (NOT HEARD — no audio reached the caller)`, marked from the
   silent-turn path.

**Conversation (call #2)**

6. A **9-digit** phone number was recorded as an answer; `identify_caller`
   rejected it and the result was swallowed (200 with an `error` field — not a
   throw). `record_answer` now refuses an undialable `caller_phone`, says what it
   heard, forbids reading back a partial number, and leaves the node open.
7. The booking refusal dropped the caller's requested time. `phoneGateMessage()`
   now leads with "I can hold 1:00 PM for you."
8. It asked for a number "to text or call" and then admitted it cannot text. The
   wording no longer offers texting, and the OTP capability is DERIVED —
   `ENABLE_PHONE_VERIFICATION && ENABLE_SMS` — so `send_verification_code` is
   absent while SMS is off, instead of relying on an ops flag nobody had set.
9. It asked "would you like a meeting?" _after_ attempting to book one. A booking
   ATTEMPT (not just a success) now records `meeting_offer: wants_meeting`.

**Local rig**

10. `npm run dev:local` — dev agent name (the default **races the Railway
    worker** for every dispatch), `NODE_EXTRA_CA_CERTS` (the agent's fetches to
    the self-signed backend were failing TLS: `voice_session_start_failed`, and a
    tenant name silently degraded to "this business"), one idle process, IPv4
    lookup.
11. Local was not bookable — the failure was **success-shaped**
    (`{"success":true,"result":"I'm not able to pull up our booking options…"}`),
    so nothing counted it as an error and the call slid into message-taking.
12. `test_db` was two migrations behind; now 184.

**Test integrity**

13. `tests/questionTreeRoundTrip.test.ts` read hand-seeded template rows, so a
    reword in `trees.ts` produced 7 failures that read like a broken conversion —
    and **nothing seeds templates in CI at all**, so its own guard would have
    thrown there. It now regenerates its fixture from the TS library every run.
14. `browserCallerSession` pinned a literal banner string that an uncommitted
    change had turned into a template.
15. Two pre-existing dashboard TS errors (`ConflictModal` widened `resource_id`
    to nullable; two consumers still assigned `string`).

New observability: `tenant_config_fetched` logs `question_tree_source`
(`tenant_db` / `platform_fallback`) + `question_tree_count`, so a failed tree copy
cannot masquerade as a normal call.

---

## 6. Verification state

| suite                            | result                                               |
| -------------------------------- | ---------------------------------------------------- |
| backend                          | **2,741** passed (224 files)                         |
| agent                            | **1,672** passed (102 files)                         |
| dashboard                        | **1,044** passed (97 files)                          |
| `npm run checks`                 | exit 0 (format + lint + backend tsc + dashboard tsc) |
| `npm run verify:claude-md`       | clean                                                |
| `cd agent && npm run verify:tts` | 10/10 voices + fixed lines speak                     |

NOT verified: a real PSTN call. The browser rig sends a fake tone, not speech, so
`no_caller_audio` in the worker log after a sim run is expected, not a fault.

---

## 7. What is running right now

| process      | detail                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| backend      | `node dist/src/index.js`, `started_at` 2026-08-15T18:48:18Z (rebuilt after the scheduling.ts change) |
| dashboard    | `node server.js` on :4000                                                                            |
| agent worker | `npm run dev:local` (tsx watch), registered as `secretary-hq-agent-dev`                              |
| Docker       | `secretary-hq-db` on :5433, healthy                                                                  |

Local dev DB (`postgres`): 184 migrations, tenant `d5e3c6a1-…` has **2 services /
10 question trees / 1 appointment**.

Worker log this session: `/tmp/claude-1000/-home-dale-projects-secretary-hq/1234233c-dd62-4f5f-ad0b-7c2160406e70/scratchpad/agent-dev3.log`
(scratchpad — disposable).

---

## 8. To resume

```bash
npm run status -- --env local --deep      # 4/4 up?
cd agent && npm run dev:local             # NOT `npm run dev`
npm run local:business && npm run trees:local   # after ANY db rebuild
# then mint a call:
AGENT_NAME=secretary-hq-agent-dev SIM_TENANT=d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0 \
  SIM_CALL_JOIN_FIRST=1 node agent/scripts/sim-call.mjs
```

`simulate.sh call` does **not** pass `AGENT_NAME`, so without the prefix the
dispatch goes to the Railway worker and you are testing production.

After a call, read: `greeting_spoken … ms_since_participant` (under a second is
healthy), any `silent_turn_recovered`, and the transcript in `voice_sessions`.

---

## 9. Open — not done, and deliberately so

1. **Nothing is committed.** The tree already carried a large in-flight batch
   from a previous session; this session's work sits on top of it. Committing is
   Dale's call.
2. **WSL resolver** — the real fix for the DNS stall needs root:
   `/etc/wsl.conf` `generateResolvConf = false`, `/etc/resolv.conf` → 1.1.1.1,
   then `wsl --shutdown`. `DNS_FORCE_IPV4=true` works around it meanwhile.
3. **The greeting names nobody.** Call #2 opened with "Who's AI assistant are
   you? He never told me." `tenants.persona_name`, `greeting_menu`,
   `greeting_closer` and `call_disclosure` are all NULL for Thinking Hammer.
   Owner-editable on Phone Assistant → AI Persona.
4. **Prod preset pin** — `scripts/pin-owner-for-hire-preset.sql` still not run;
   all three prod tenants have `checklist_preset_id` NULL. Run it only AFTER the
   agent deploys (an unrecognized id is a silent no-op).
5. **Prod is untouched** and still on the #343 build
   (`started_at` 2026-08-14T04:24:31Z).
