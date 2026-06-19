# HANDOFF — 2026-06-18

## Deploy Rules (always)

- All 3 Railway services deploy from `main` only — branch push deploys nothing
- Shipping = merge to main via PR with 4 CI jobs green
- Merge command: `gh pr merge <N> --squash --delete-branch --admin`

---

## Open PR: #36 `feat/ai-cost-meter`

**Status at handoff**: Backend ✅ Dashboard ✅ Agent ✅ E2E ⏳ IN_PROGRESS

**What ships:**

- `ai_cost_events` table (migration `20260618000001_ai_cost_events.sql` — **already applied to prod**)
- Agent subscribes to `SessionUsageUpdated` → POSTs LLM/STT/TTS usage to `POST /agent-tools/record-ai-cost` at call end
- `GET /analytics/ai-cost` — month-to-date aggregation by provider/model
- Dashboard Analytics tab: "AI Usage (this month)" table card

**Action**: merge when all 4 CI green + no unresolved review threads

---

## Next Code Items

**P1 (pick next):**

1. Dashboard "Send self-service links" button — `dashboard/components/AppointmentDetailPanel.tsx`
2. E2E: "book → SMS → link cancels/reschedules" + negative cases (expired token, wrong tenant)
3. AI cost phase 2 — instrument `callSummary.ts` + `knowledgeIngestion.ts` + `knowledge.ts` for remaining token costs

**P2:**

- Deliberate-fail PR to verify CI gate blocks merge end-to-end
- Load test booking path (`pool max=10`)

---

## User Actions Pending (not code)

- Stripe bank account (weekend)
- Stripe test round-trip: `stripe listen --forward-to localhost:4001/billing/webhook`
- Dial `+1 630-866-1960` from different carrier while watching `listRooms()` — PSTN verify
- Enable Telnyx REFER on SIP Connection `livekit-outbound`
- Enable "Wait for CI" on 3 Railway services
- Set `forward_phone` on Beth's tenant (Phone Assistant → AI Persona)
- Set `BETTER_STACK_TOKEN` + `SENTRY_DSN` on Railway (non-blocking)

---

## Key Facts

- Prod: `https://ai-sec-production.up.railway.app/`
- Phone: `+1 630-866-1960` (Telnyx, tenant Thinking Hammer LLC `d5e3c6a1-…`)
- Logins: `admin@secretaryhq.com` / `daledemott@gmail.com` / `bella@bellashair.com` — password `/ password`
- Local DB: port 5433
- Prod DB URL: encrypted at `~/.claude/projects/-home-dale-projects-secretary-hq/memory/db_url.enc`
  - Decrypt: `openssl enc -d -aes-256-cbc -pbkdf2 -base64 -pass pass:PASSWORD -in <file>`
- Full gap inventory: `GAPS.md` (categories) + `docs/TODO.md` (actionable, folded from TODO_GAPS.md 2026-06-19)
