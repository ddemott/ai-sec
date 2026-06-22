# HANDOFF — 2026-06-22

## Deploy Rules (always)

- All 3 Railway services deploy from `main` only — branch push deploys nothing
- Shipping = merge to main via PR with 4 CI jobs green
- Branch protection requires green CI **+ all review threads resolved**; solo merge = `gh pr merge <N> --merge --admin --delete-branch` (admin overrides the human-review requirement, never the CI/conversation gates without intent)

---

## Shipped + merged + DEPLOYED to prod this session (PRs #56 / #57 / #58 / #59)

All four merged to `main` (merge `a842a19`) and **deployed live to all 3 Railway services**. Verified 2026-06-22 via `./scripts/simulate.sh status --env prod --deep` (4/4: backend `/health`+`/ready`, dashboard 200, agent worker dispatch picked up) and the new routes returning **401 not 404** on prod (`/audit-log`, `/export/tenant-data`, `/knowledge/explain`). **No prod DB migration was needed** — everything reads existing schema.

- **#56** — `toolsClient` idempotent-read retry: 5 tests (read retries once on 5xx/throw; mutations never retry → double-book guard). Also the `docs/DEPLOYMENT.md` edge-function-phase removal.
- **#57** — `GET /export/tenant-data` (owner-gated JSON export, password_hash-safe); per-tenant website-scan rate-limit (`scanRateLimit.ts`, 429 when dry); `docs/RUNBOOK.md` (incident + telephony playbook).
- **#58** — `GET /audit-log` (owner-gated, paginated change history); `POST /knowledge/explain` (RAG answer-debugger; embeds the question identically to `policy-answer`); `docs/OWNER_GUIDE.md`.
- **#59** — dashboard `AuditLogView` + `ExplainAnswerView` (Setup sub-tabs) + "Download my data" button in `BusinessSettingsView`; caller-facing source citations in `policy-answer` (joins `tenant_docs` for each chunk's title → `[From "<title>"]`; agent prompt updated; fixed an `ANY($2::uuid[])` cast review caught — without it citations silently failed); website-scan happy-path + wizard browser-click E2E (stub-gated).

Note: each route-adding PR must bump the `route modules` count in `CLAUDE.md` (the `verify-claude-md` drift guard fails CI otherwise) — it is **merge-order-fragile**: rebase each branch onto the latest main so the count reflects the union (main is now **29**).

---

## Next Code Items (remaining, independent)

- **GDPR/CCPA hard-purge** + retention/purge worker (destructive — needs Dale's legal-retention scope before building; the purge worker also needs a `last_scanned`/retention column + migration).
- **Analytics depth**: cohort / CLV / service-specific abandonment drill-down (abandonment-by-service needs a new `voice_sessions.requested_service_id` column + agent change).
- `@typescript-eslint/unbound-method` — heavy in tests; deprioritized (may stay `warn`).

Full actionable list: `docs/TODO.md` (canonical). Category inventory: `GAPS.md`.

---

## User Actions Pending (not code)

- LLC bank account; Stripe test round-trip (`stripe listen --forward-to localhost:4001/billing/webhook`) + Stripe Tax dashboard setup
- Dial `+1 630-866-1960` from a different carrier while watching `listRooms()` — PSTN verify (blocked on a 2nd phone)
- Enable Telnyx REFER on SIP Connection `livekit-outbound`; set forward number (Phone Assistant → AI Persona)
- Enable "Wait for CI" on the 3 Railway services
- Set `SENTRY_DSN` + `BETTER_STACK_TOKEN` + `EMAIL_USER`/`EMAIL_PASS` on Railway (silent-degrade until set; boot warnings fire)
- Rotate the Railway team token created 2026-06-12 (pasted into a session)

---

## Key Facts

- Prod: `https://ai-sec-production.up.railway.app/`
- Phone: `+1 630-866-1960` (Telnyx, tenant Thinking Hammer LLC `d5e3c6a1-…`)
- Logins: `admin@secretaryhq.com` / `daledemott@gmail.com` / `bella@bellashair.com` — password `/ password`
- Local DB: port 5433
- Prod DB URL: encrypted at `~/.claude/projects/-home-dale-projects-secretary-hq/memory/db_url.enc`
  - Decrypt: `openssl enc -d -aes-256-cbc -pbkdf2 -base64 -pass pass:PASSWORD -in <file>`
- Full gap inventory: `GAPS.md` (categories) + `docs/TODO.md` (actionable)
