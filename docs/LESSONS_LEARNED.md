# Lessons Learned

A running log of hard-won debugging lessons. Add to this file — don't let them evaporate after the session that earned them.

---

## 2026-06-25 — Beth go-live: "calls don't log" + "Beth freezes mid-call"

A multi-hour debugging marathon taking the voice agent (Beth, Thinking Hammer) from "nothing works on a real call" to "logs everything + holds a conversation." Two distinct problems, conflated for a long time.

### The two problems (don't conflate symptoms)

1. **"Nothing logs."** Calls connected but the dashboard showed nothing / stale `active` rows.
2. **"Beth freezes."** She greets, answers a turn or two, then goes silent; caller hangs up.

These looked like one bug ("calls are broken") and got conflated. They were separate, with separate root causes. **Lesson: when two symptoms co-occur, explicitly separate them before theorizing — a single "it's broken" frame hid that logging and the conversation were failing for unrelated reasons.**

### Root causes (what was actually wrong)

- **Logging:**
  - `voice_sessions.caller_phone` was `NOT NULL`, but forwarded-line/anonymous callers have no caller ID → `start_voice_session()` threw → no row. (Fixed: column nullable.)
  - The agent finalized the call only in `ctx.addShutdownCallback`, which fires on **JOB_SHUTDOWN** — but the LiveKit worker stays alive between calls, so a single hangup never shut the job down → `voice-session-end` was **never called** (proven: `tool_calls_total{tool="voice-session-end"} = 0`). Rows sat `active` forever. (Fixed: finalize on the session **`Close`** event, which fires on participant disconnect; reaper as backstop.)
  - The transcript was only written at finalize → a call that hung lost its transcript. (Fixed: persist the transcript-so-far after **every turn**.)
  - The dashboard polled only *active* calls, never history/detail → a finalized call kept showing stale `active / 0:00 / no transcript` until manual reload. **This caused most of the false "nothing logged" reports.** (Fixed: auto-refresh history + selected call.)

- **The freeze (the real one):** **OpenAI TTS latency.** Direct timing settled it — `gpt-4o-mini` LLM = ~1s, but OpenAI **TTS (tts-1) = 2–5s per sentence**, and the `@livekit/agents-plugin-openai` TTS does **not stream** — observable behavior: no audio plays until the whole clip is synthesized (verified by reading the installed package: `super(..., { streaming: false })` and `stream()` throws). So every reply had a multi-second silent gap; the caller said "hello?" into the gap, which **completed a new turn during the in-flight generation and discarded the reply** (trace: `playout interrupted, playbackPositionInS=0`, `function call missing the corresponding function output, ignoring`). (**Fixed in PR #98**: switched the TTS model to `gpt-4o-mini-tts` ~1.3s + raised interruption `minWords` 0→2 / `minDuration` 500→800ms so a 1-word backchannel can't discard the reply. Planned: pre-rendered/cached TTS for routine lines.)

### Meta-lessons (the expensive ones)

- **MEASURE before "fixing" a latency/perf problem.** I guessed the freeze cause wrong ~5 times (turn-detection, stuck-speaking, speakFiller deadlock, LLM hang, rate-limiting) and shipped fixes for several before the actual cause. The breakthrough was a **2-minute direct timing test** (curl OpenAI LLM vs TTS) that showed LLM fast / TTS slow. One measurement beat hours of theorizing.
- **Don't blind-patch when you can't see.** Each speculative fix that "should" have worked but didn't cost a full CI+deploy+retest cycle. A wrong fix isn't free — it consumes the user's next test.
- **Anchoring is the enemy.** I latched onto "intermittent TTS stall" and walked past cheaper discriminators (the caller had given a *partial* phone number; the DB showed 0 customers saved). Re-derive from the evidence each round; don't defend the prior hypothesis.
- **Sad paths must be instrumented or you debug blind.** The call-finalize was fire-and-forget with a single swallowed `warn`; when it failed there was *no trace*. Rule (now standing): every fire-and-forget / best-effort path that can fail silently emits a **metric** (survives log truncation) + a 5W log naming the cause (SQLSTATE, status, payload). This is what finally made calls diagnosable.
- **Get the real trace before committing to a fix.** Hours were lost theorizing because I couldn't read the agent's turn-state. Once the trace was in hand (`agent_state_changed`, `user_input_transcribed`, `function_tools_executed`), the cause was obvious in minutes. Instrument first, then read, then fix.

### Observability gotchas (how to actually see prod)

- **Metrics survive truncation; logs don't.** Prometheus `/metrics` (gated by `METRICS_TOKEN`, direct curl to the backend) gave hard facts (`voice-session-start`=1, `voice-session-end`=0) when Railway log retention truncated to ~40 lines. Lean on counters for "did X happen, how often."
- **Railway's management GraphQL API rate-limits a team token hard** under heavy use (deploy-watch + log polling) — it stayed throttled for *hours*, blocking log reads entirely. Don't build your only observability path on it. Alternatives that bypass it: the **Railway dashboard UI**, `railway logs --service <svc>` in a logged-in terminal, the app's own `/metrics`, querying the prod **DB directly**, and **Sentry/Better Stack** if a DSN/token is set on the service (the agent had neither — set them).
- **Prod DB is a first-class debugging tool.** Reading `voice_sessions` directly (transcript, status, duration) + running the reaper RPC against prod proved the logging path end-to-end without any logs.

### LiveKit Agents (Node) specifics learned

(All "specifics" below are behaviors of the **`@livekit/agents`** packages — inspect them under `agent/node_modules/@livekit/agents*`, not this repo's source.)

- `ctx.addShutdownCallback` runs on **job shutdown**, not per-call. A reused worker doesn't shut down between calls → use the session **`Close`** event (`CloseReason.PARTICIPANT_DISCONNECTED`) to run per-call teardown.
- `ToolsClient.call()` (this repo, `agent/src/toolsClient.ts`) **resolves `{ ok:false, status }` on 5xx/401 — it does NOT throw.** A bare `.catch()` won't catch a backend failure; inspect `res.ok`.
- The `@livekit/agents-plugin-openai` **TTS does not stream** (package source: `super(..., { streaming:false })`; `stream()` throws). Audio only plays after the full clip synthesizes → model latency = dead air. (The old Grok plugin was also non-streaming.)
- `@livekit/agents` internals (`dist/voice/agent_activity.js`): `userTurnCompleted()` **skips the reply** (logs `"skipping user input, current speech generation cannot be interrupted"`) when current speech isn't interruptible; a new short user turn during in-flight generation can orphan a function-call output.
- `turnHandling.interruption` defaults: `minWords: 0`, `minDuration: 500` → *any* sound (even "hello?") counts as an interruption. Raise them so backchannels don't cancel a reply.
- Calling `session.say()` from **inside** a tool's `execute()` (the old `speakFiller`) is an unsupported pattern — avoid it. (It turned out not to be the freeze cause, but it's still wrong.)

### Process / tooling gotchas

- **`git push` is slow because the pre-push hook runs the full quality suite** (`scripts/example-pre-push-hook.sh` → `npm test`), which needs the **local test DB on :5433**. When that DB isn't up, the hook fails locally even though the code is fine. Use `git push --no-verify` (CI is the authoritative gate) when the DB isn't running.
- **Branch protection requires the branch be up-to-date with main** before merge (`mergeStateStatus: BEHIND` blocks). Merge `origin/main` into the PR branch + push when other PRs land first.
- **Every Copilot review pass caught at least one real bug** (the `res.ok` vs throw handling, the empty-transcript wipe, the negative-age reaper window finalizing live calls, search_path/REVOKE on the SECURITY DEFINER fn, zero-width chars in comments). Adversarial review before merge earned its keep — don't rubber-stamp; verify, fix, resolve.
- **merge-before-migrate**: apply the prod DB migration before merging code that reads the new shape (or make the code forward-compatible). A SECURITY DEFINER maintenance function must pin `search_path` and `REVOKE EXECUTE` from `PUBLIC` + Supabase `anon`/`authenticated`.
- **Recover a deleted/closed PR's branch** with `git fetch origin refs/pull/<N>/head` — no "Restore branch" click needed.
- **`setup-db.sh` silently no-ops through the Supabase pooler when a migration self-manages transactions.** The runner applies each file with `psql --single-transaction` **and** appends its own `INSERT INTO schema_migrations`. Migration files that carry their **own `BEGIN`/`COMMIT`** (e.g. `20260607000001_booking_buffer_enforcement.sql`) collide with that wrapper — you see both `WARNING: there is already a transaction in progress` (the file's `BEGIN`) and `WARNING: there is no transaction in progress` (the wrapper's trailing `COMMIT`). Against a **direct** localhost/CI Postgres it happens to commit (CI stays green); against the **Supabase pooler** it reported `APPLY` / `RC=0` while **nothing durably committed** (column absent, `schema_migrations` unchanged). Fix: for prod/pooler, apply the migration files **directly** — `psql "$PROD_URL" -v ON_ERROR_STOP=1 --single-transaction -f <file>` (let the file's own `BEGIN/COMMIT` do the work) + a separate `INSERT ... ON CONFLICT DO NOTHING` into `schema_migrations`. Then **verify against the DB**, never trust the runner's summary. (2026-07-01, buffer migration.)
- **Never judge a command's success through a pipe.** `npx vitest run 2>&1 | tail` / `| grep` reports **`tail`/`grep`'s** exit code, not the command's — a failing suite looks green. This burned an hour: an "exit 0" full-suite run was actually `tail` succeeding while 3 tests failed underneath, sending me hunting a phantom regression that was really a **drifted local `test_db`** (missing `persona_name`/`default_service_id` because an earlier `db:migrate` had stopped on a pre-existing idempotency error). Always capture the real code: `cmd > /tmp/out.log 2>&1; echo "EXIT=$?"` or check `${PIPESTATUS[0]}`. And when local tests fail but CI is green, **suspect test_db drift first** — rebuild it CI-identical (drop → `setup-db.sh` full chain → `seed-db.sh`) before touching code. (2026-07-01.)

### Durability principle (reinforced by Dale)

A record must exist **from the start of the call**, keyed by something stable (call_id/timestamp), **independent of whether name/phone are collected or the agent finishes cleanly.** Layer it: write at start → enrich incrementally (transcript per turn) → finalize on hangup → server-side **reaper** backstop for anything that still slips through. The dashboard must **auto-refresh** so the durable record is actually *visible* without a manual reload.
