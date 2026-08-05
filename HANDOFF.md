# HANDOFF

Read this first after model switch.

## Current state
- Repo: `/home/dale/projects/secretary-hq`
- Branch work already done this session:
  - `src/routes/appointments.ts`: `POST /appointments/:id/send-self-service-links` now checks SMS consent before sending cancel/reschedule links.
  - `tests/routes/appointments.test.ts`: added consented happy path and no-consent sad path; fixtures use real normalized numbers.
  - `docs/TODO.md`: removed stale open item for raw self-service SMS consent gap.
  - `docs/RESOLVED.md`: added resolution entry for the consent-gate fix.
- Verified:
  - `npx vitest run tests/routes/appointments.test.ts --reporter=dot` → 44 passed
  - `npm run test` → 210 files passed, 1701 tests passed, 9 failures only in `tests/regression/rlsIsolation.test.ts`

## Active blocker
- Full suite fails in RLS env, not in this patch.
- Error seen:
  - `Error: Cannot reach the database as app_user (postgres://***@localhost:5433/postgres). Apply supabase/migrations/20260724000100_app_user_role.sql first.`

## Next live work
Best remaining no-user-input work:
1. reminder worker shutdown / drain / atomic-claim race
2. reminder-worker hang protection + SMS metric chokepoint
3. any remaining send-path silence bugs if metrics still want one chokepoint

## Hermes model note
- This session discovered a larger-context option:
  - `grok-4.20-0309-reasoning` on `xai-oauth`
  - reported context: 2,000,000 tokens
- Safe launch command from the delegated check:
  - `hermes -m grok-4.20-0309-reasoning --provider xai-oauth`
- Model switch is not in-place for this live chat. Start a new Hermes invocation, then read this file first.

## Useful recap
- `find-customer-by-name` leak already fixed earlier in `src/routes/agentTools/identity.ts`.
- OTP carry-forward is already in code.
- Reminder retry / no-consent logic is already present in live reminder code; the stale backlog item was removed from TODO.
- Docs changed only in `docs/TODO.md` and `docs/RESOLVED.md`.

## Continue from here
- If you need the latest repo state, trust the files above, then inspect the reminder worker paths next.
- Keep verdict in current style: terse, exact, verified.
