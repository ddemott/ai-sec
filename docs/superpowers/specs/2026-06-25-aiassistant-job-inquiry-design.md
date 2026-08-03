# __PERSONA_NAME__ job-inquiry capture — design
# Persona name variable in seed (currently 'Chris')
# Marker: __PERSONA_NAME__  (use in docs/comments for the name; change only in seed var)

**Date:** 2026-06-25
**Tenant:** Thinking Hammer LLC (`d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0`), voice assistant "__PERSONA_NAME__"
**Branch:** `feat/aiassistant-job-inquiry`

## Problem

A caller asked whether Dale was available for work. __PERSONA_NAME__ "went to look," found no answer
(no RAG doc covers Dale's hiring availability), and never came back to the call — dead air,
caller hung up. This is the freeze family: an LLM with no scripted branch tries to retrieve
something that doesn't exist and goes silent.

Dale wants __PERSONA_NAME__ to instead run a deterministic intake script for work/job inquiries, collect
the position details, persist them, and route them to him — then tell the caller to email a
job description to `DaleDeMott@thinkinghammer.com` (name + company in the subject).

## Behavior (the if-tree, from Dale)

Opener (general "is Dale available for work"):
> "I don't know if Dale is available for work however if I can collect some information from
> you I can pass this onto him and have him get back to you."

Availability-for-a-job branch:
> "I don't know Dale's availability however if I may collect some information about the
> position, I will pass it along to him so he can get back to you."

Then ask, in order:
1. What hiring company do you represent?
2. Do you work for this company?
3. Is this a contract position or full time?
   - **Contract:** rate range → contract length → onsite/remote/hybrid →
     - onsite/hybrid: address
     - remote: timezone (so Dale knows office hours)
   - **Full time:** salary range → onsite/remote/hybrid →
     - onsite/hybrid: address
     - remote: timezone

Close (always):
> "Please send a job description to DaleDeMott@thinkinghammer.com, with your name and company
> in the subject line."

## Architecture / data flow

```
Caller → __PERSONA_NAME__ (persona if-tree, collects fields)
       → identify_caller (logs recruiter as a contact, backfills the call row)
       → capture_job_inquiry (agent tool) → POST /agent-tools/capture-job-inquiry
            ├─ INSERT job_inquiries row (RLS-scoped to tenant)
            ├─ sendJobInquiryEmail() → tenants.job_inquiry_email (fallback: owner email)
            └─ returns { success: true }
       → __PERSONA_NAME__ closing line (email-the-JD instruction)
```

The persona drives the *conversation*; the tool persists + notifies. The tool call is
**mandated** in __PERSONA_NAME__ (LLM-theater fix, PR #88 lesson): __PERSONA_NAME__ must not say "I'll pass it
along" without actually calling `capture_job_inquiry`.

## Components

### 1. Migration `20260625010000_job_inquiries.sql`
New `job_inquiries` table, mirroring `customer_messages` conventions exactly:

| column | type | notes |
|---|---|---|
| job_inquiry_id | UUID PK default gen_random_uuid() | domain entity, externally referenced |
| tenant_id | UUID NOT NULL FK tenants ON DELETE CASCADE | |
| customer_id | UUID FK customers | nullable; the recruiter contact if identified |
| company | TEXT | |
| represents_company | BOOLEAN | "do you work for this company?" |
| employment_type | TEXT | 'contract' \| 'full_time' |
| rate_range | TEXT | rate (contract) or salary (full-time) range |
| duration | TEXT | contract length; null for full-time |
| location_type | TEXT | 'onsite' \| 'remote' \| 'hybrid' |
| address | TEXT | onsite/hybrid only |
| timezone | TEXT | remote only |
| caller_name | TEXT | |
| callback_phone | TEXT | |
| call_id | TEXT | links to the voice_sessions call |
| created_at | TIMESTAMPTZ NOT NULL default now() | |

- `idx_job_inquiries_tenant ON (tenant_id, created_at DESC)`
- `ENABLE` + `FORCE ROW LEVEL SECURITY`
- policy `job_inquiries_tenant_isolation USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`
- `ALTER TABLE tenants ADD COLUMN job_inquiry_email TEXT;`
- `npm run db:baseline` to regen `supabase/baseline.sql`.

All fields except tenant_id/created_at are nullable — the two branches collect different
subsets and a caller may bail mid-intake; a partial inquiry is still worth persisting + sending.

### 2. `systemEmail.ts` — `sendJobInquiryEmail(to, fields)`
Consent-free path (owner notification, NOT customer marketing — same class as password-reset /
invite emails already in this file). Formatted text + html summarizing the collected fields.
Uses the existing Gmail nodemailer transporter.

### 3. Route `POST /agent-tools/capture-job-inquiry` (`src/routes/agentTools.ts`)
- Zod schema: `tenant_id` (uuid), `caller_name` (required), `callback_phone?`, `company?`,
  `represents_company?` (bool), `employment_type?` ('contract'|'full_time'), `rate_range?`,
  `duration?`, `location_type?` ('onsite'|'remote'|'hybrid'), `address?`, `timezone?`, `call_id?`.
- `withTenantClient`: INSERT the row.
- Look up recipient: `SELECT job_inquiry_email, (owner email) FROM tenants/users` →
  `job_inquiry_email ?? owner_user.email`.
- Send email **best-effort**: failure increments `errors_total{event="job_inquiry_email_failed"}`
  + a 5W log (SQLSTATE/recipient/tenant) — never fatal (sad-path instrumentation rule). The row
  is already persisted, so Dale can still see it even if email fails.
- `tool_calls_total{tool="capture-job-inquiry",outcome}` metric.
- Response `{ success: true, result }` / `{ success: false, error }` at 200 (agent-tools contract).

### 4. Agent tool `capture_job_inquiry` (`agent/src/tools.ts`)
Mirrors `take_message`. Parameters as above (only `caller_name` required); passes `tenant_id`
and `call_id` from `ctx`. Description tells the LLM to call it once the intake answers are
collected.

### 5. Persona prompt (`tenants.system_prompt`, tenant `d5e3c6a1`)
Add a "Job / work inquiry" section encoding the if-tree above, mandating the `capture_job_inquiry`
call, ending with the JD-email closing line. Written directly to the prod `tenants` row (same as
prior persona edits); back up the current value first.

### 6. Tests
- Backend (`src/agentTools.test.ts`): HAPPY contract branch (full fields → INSERT + email sent),
  HAPPY full-time branch, SAD email-failure (still returns success + INSERT happened + error
  logged/metric), VALIDATION (bad `employment_type`/`location_type` enum → 400). Independent,
  create/cleanup own data, 5W comments.
- Agent: tool-wiring test if the suite asserts tool shapes.

## Error handling
- Email is best-effort and instrumented; the DB row is the durable record.
- Unknown/partial branches: nullable columns absorb them.
- Bad enums rejected at the Zod layer (400) before any DB write.

## Deploy gates (must verify — these are the landmines)
1. **`EMAIL_USER` / `EMAIL_PASS` set on prod backend.** Without them the email service runs in
   *simulation mode* — emails appear to succeed but are never delivered. Verify before trusting.
2. **Apply migration to prod BEFORE merge** (merge-before-migrate rule) or the route's INSERT /
   `job_inquiry_email` read fails against the old schema.
3. Agent code change → **merge to main → Railway redeploys `secretary-hq-agent`** (auto-deploy is on).
   A branch push deploys nothing.
4. Write persona + `job_inquiry_email='DaleDeMott@thinkinghammer.com'` directly to prod `tenants`.
5. **Real-call verification** (Dale's transport test): confirm __PERSONA_NAME__ walks the branch and the tool
   fires (`tool_calls_total{tool="capture-job-inquiry"}` increments; row appears; email arrives).

## Out of scope (YAGNI)
- Dashboard surface for `job_inquiries` (query the table directly for now).
- Multi-tenant generalization — only __PERSONA_NAME__'s tenant invokes the tool; the table/column/route are
  generic but no other persona references them.
- Parsing the JD attachment — the caller emails it to Dale separately.
