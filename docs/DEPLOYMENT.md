# SecretaryHQ SaaS - Production Deployment Guide

This guide walks through migrating from the local Docker development environment to a production Supabase project with live telephony.

---

## Prerequisites

- **Supabase Account**: [supabase.com](https://supabase.com) (free tier works for initial testing)
- **Vapi Account**: [vapi.ai](https://vapi.ai) (for voice AI orchestration)
- **Telnyx Account**: [telnyx.com](https://telnyx.com) (for phone numbers and SIP trunking)
- **OpenAI API Key**: For RAG embeddings and post-call summaries
- **Vercel Account** (optional): For hosting the Next.js dashboard
- **Supabase CLI**: `npm install -g supabase` (already in devDependencies)

---

## Phase 1: Supabase Project Setup

### 1.1 Create the Project
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New Project**.
2. Choose a name (e.g., `ai-sec-prod`), set a strong database password, and select a region close to your users.
3. Wait for the project to provision (~2 minutes).

### 1.2 Note Your Credentials
From **Project Settings** > **API**, save these values:
- **Project URL**: `https://<PROJECT_ID>.supabase.co`
- **Project ID**: The `<PROJECT_ID>` portion
- **anon key**: Public API key (not needed for this app, but good to have)
- **service_role key**: Server-side key with full access

From **Project Settings** > **Database**:
- **Connection string**: `postgres://postgres:[YOUR-PASSWORD]@db.<PROJECT_ID>.supabase.co:5432/postgres`
- **Connection pooler string** (Transaction mode): For high-concurrency use

### 1.3 Enable Required Extensions
In the Supabase SQL Editor, run:
```sql
CREATE EXTENSION IF NOT EXISTS pgvector;
```
- `pgvector`: Required for RAG knowledge base embeddings

(`pg_net` is no longer required — the old `notify_n8n_on_appointment` trigger is dead code. All async work runs inline in Fastify route handlers.)

---

## Phase 2: Database Migration

### 2.1 Run Pre-flight Check
Before applying migrations, validate that your cloud database meets all prerequisites:

```bash
./scripts/preflight-cloud.sh "postgres://postgres:[YOUR-PASSWORD]@db.<PROJECT_ID>.supabase.co:5432/postgres"
```

This checks: connectivity, extensions (pgvector, pg_net), role creation, database state, PostgreSQL version, and migration file count. Fix any FAIL items before proceeding.

### 2.2 Apply Migrations
Use the existing `setup-db.sh` script, passing the production connection string:

```bash
./scripts/setup-db.sh "postgres://postgres:[YOUR-PASSWORD]@db.<PROJECT_ID>.supabase.co:5432/postgres"
```

This applies all 74 migrations in order and seeds the database with the DynaTire demo tenant.

### 2.3 RLS Enforcement
No separate `api_user` role is needed. The backend connects as the `postgres` role via `DATABASE_URL`, and `FORCE ROW LEVEL SECURITY` on all 20 RLS-enabled tables (migration `20260323000000_force_rls_single_pool.sql`) enforces tenant isolation even under superuser. `withTenantClient()` sets `app.current_tenant_id` per request.

### 2.4 Verify the Schema
Spot-check that critical objects exist:
```sql
-- Tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Key functions
SELECT proname FROM pg_proc WHERE proname IN (
  'book_appointment_atomic', 'book_with_scheduling_atomic',
  'check_availability_with_tz', 'get_effective_shifts',
  'get_effective_shifts_bulk', 'link_orphaned_transcripts',
  'set_tenant_context'
);

-- RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;
```

---

## Phase 3: Deploy Edge Functions

### 3.1 Link the Supabase CLI
```bash
npx supabase login
npx supabase link --project-ref <PROJECT_ID>
```

### 3.2 Set Edge Function Secrets
```bash
npx supabase secrets set OPENAI_API_KEY=sk-proj-...
npx supabase secrets set VAPI_SERVER_URL_SECRET=your-shared-secret
npx supabase secrets set DATABASE_URL="postgres://postgres:[YOUR-PASSWORD]@db.<PROJECT_ID>.supabase.co:5432/postgres"
```

### 3.3 Deploy the vapi-tools Function
```bash
npx supabase functions deploy vapi-tools --no-verify-jwt
```

The `--no-verify-jwt` flag is required because Vapi sends webhook requests directly (not through Supabase Auth). The function has its own secret verification via `x-vapi-secret`.

### 3.4 Test the Edge Function
```bash
curl -X POST https://<PROJECT_ID>.functions.supabase.co/vapi-tools \
  -H "Content-Type: application/json" \
  -H "x-vapi-secret: your-shared-secret" \
  -d '{"message": {"type": "function-call", "functionCall": {"name": "ping"}}}'
```

You should get a response (even if it's an error about unknown function — that confirms the function is running).

---

## Phase 4: Deploy the Backend API

The Fastify backend serves the dashboard and management API. Deploy options:

### Option A: Railway (Current Setup)
Railway is configured via `railway.json` + `nixpacks.toml` in the repo root.

1. **Build**: Nixpacks auto-detects Node.js 20, runs `npm install && npm run build`
2. **Start**: `node dist/src/index.js`
3. **Health check**: `/health` endpoint
4. **Restart policy**: `ON_FAILURE` with max 10 retries

**Database compatibility**: The backend uses a single DB pool via `DATABASE_URL`. All 20 RLS-enabled tables have `FORCE ROW LEVEL SECURITY` so tenant isolation works even with the Supabase `postgres` role (no separate `api_user` needed). Apply all 74 migrations (including `20260323000000_force_rls_single_pool.sql`) to Supabase before deploying.

**Graceful shutdown**: The backend handles `SIGTERM`/`SIGINT` (Railway sends these during deploys) — closes Fastify and drains the DB pool.

### Option B: Render / Fly.io
These platforms also support Node.js apps with similar config. Use the same env vars and start command.

### Option C: Run on a VPS
```bash
npm install
npm run build
NODE_ENV=production DATABASE_URL=... JWT_SECRET=... node dist/src/index.js
```

**Important**: In production (`NODE_ENV=production`), the backend skips HTTPS/TLS (the platform handles TLS termination). The `x-forwarded-proto` hook redirects HTTP to HTTPS when behind a proxy.

### Backend Environment Variables Reference
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase Postgres connection string (use session-mode pooler) |
| `OPENAI_API_KEY` | Yes | For RAG embedding generation |
| `VAPI_SERVER_URL_SECRET` | Yes | Shared secret for Vapi webhook auth |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens (change from default!) |
| `JWT_EXPIRY` | No | Token expiry duration (default: `8h`) |
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | No | Server port (default: `4001`) |
| `STRIPE_SECRET_KEY` | Yes | Stripe API key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret (create after deploy) |
| `STRIPE_SOLO_PRICE_ID` | Yes | Stripe price ID for Solo plan |
| `STRIPE_GROWTH_PRICE_ID` | Yes | Stripe price ID for Growth plan |
| `STRIPE_PRO_PRICE_ID` | Yes | Stripe price ID for Pro plan |
| `STRIPE_ENTERPRISE_PRICE_ID` | No | Stripe price ID for Enterprise plan |
| `DASHBOARD_URL` | No | Dashboard URL for Stripe checkout redirects (default: `https://localhost:4000`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (for Google Calendar sync) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | No | OAuth callback URL (e.g., `https://your-backend/calendar/auth/google/callback`) |
| `OUTLOOK_CLIENT_ID` | No | Azure AD app registration (for Outlook Calendar sync) |
| `OUTLOOK_CLIENT_SECRET` | No | Azure AD app secret |
| `OUTLOOK_CALLBACK_URL` | No | OAuth callback URL (e.g., `https://your-backend/calendar/auth/outlook/callback`) |
| `JOBBER_CLIENT_ID` | No | Jobber developer app (for Jobber CRM sync) |
| `JOBBER_CLIENT_SECRET` | No | Jobber app secret |
| `JOBBER_CALLBACK_URL` | No | OAuth callback URL (e.g., `https://your-backend/jobber/auth/callback`) |
| `HUBSPOT_CLIENT_ID` | No | HubSpot developer app (for HubSpot CRM sync) |
| `HUBSPOT_CLIENT_SECRET` | No | HubSpot app secret |
| `HUBSPOT_CALLBACK_URL` | No | OAuth callback URL (e.g., `https://your-backend/hubspot/auth/callback`) |
| `SQUARE_CLIENT_ID` | No | Square developer app (for Square CRM sync) |
| `SQUARE_CLIENT_SECRET` | No | Square app secret |
| `SQUARE_CALLBACK_URL` | No | OAuth callback URL (e.g., `https://your-backend/square/auth/callback`) |
| `SERVICETITAN_CLIENT_ID` | No | ServiceTitan developer app (for ServiceTitan CRM sync) |
| `SERVICETITAN_CLIENT_SECRET` | No | ServiceTitan app secret |
| `SERVICETITAN_APP_KEY` | No | ST-App-Key header for ServiceTitan API |
| `SERVICETITAN_CALLBACK_URL` | No | OAuth callback URL (e.g., `https://your-backend/servicetitan/auth/callback`) |
| `VAPI_API_KEY` | No | Vapi private key (for phone provisioning) |

---

## Phase 5: Deploy the Dashboard

The dashboard is a Next.js app in the `dashboard/` directory.

### Option A: Vercel (Recommended)
1. Connect your GitHub repo to Vercel
2. Set the **Root Directory** to `dashboard`
3. Set environment variables:
   ```
   NEXT_PUBLIC_API_BASE_URL=https://your-backend-url.com
   ```
4. Deploy

### Option B: Self-hosted
```bash
cd dashboard
npm install
npm run build
npm start
```

Set `NEXT_PUBLIC_API_BASE_URL` to point to your deployed backend.

---

## Phase 6: Telephony Setup (Telnyx + Vapi)

> **Migration note:** Voice orchestration is moving from Vapi to LiveKit Agents. This section documents the **current** (Vapi) setup. Once LiveKit Phase 2+ ships, this phase will be replaced with LiveKit SIP bridge + dispatch rule configuration. See `docs/FRAMEWORK_MIGRATIONS.md` and `.claude/plans/federated-snacking-puffin.md`.

### 6.1 Telnyx: Buy a Phone Number
1. Sign in to [portal.telnyx.com](https://portal.telnyx.com)
2. Go to **Numbers** > **Search and Buy Numbers**
3. Purchase a local number for your target area

### 6.2 Telnyx: Create a SIP Trunk
1. Go to **Voice** > **SIP Trunking** > **Create SIP Trunk**
2. Name it `SecretaryHQ`
3. Set the **Inbound Webhook URL** to Vapi's SIP endpoint (from Vapi dashboard)
4. Assign your purchased number to this trunk

### 6.3 Vapi: Import the Number
1. Go to [dashboard.vapi.ai](https://dashboard.vapi.ai) > **Phone Numbers**
2. Click **Import from Provider** and enter the Telnyx number + trunk ID

### 6.4 Vapi: Create the Agent
Use `vapi/agent.template.json` as the base. Replace the Mustache variables:

| Variable | Value |
|---|---|
| `{{TENANT_NAME}}` | e.g., `DynaTire` |
| `{{BUSINESS_TYPE}}` | e.g., `tire shop` |
| `{{TENANT_ID}}` | UUID from the `tenants` table |
| `{{RESOURCE_ID}}` | UUID from the `resources` table |
| `{{CURRENT_DATE}}` | Today's date (or use Vapi's dynamic date) |
| `{{VOICE_PROVIDER}}` | `vapi` (built-in Clara voice) |
| `{{VOICE_ID}}` | Vapi voice ID (e.g., Clara) |
| `{{SERVER_URL}}` | `https://<PROJECT_ID>.functions.supabase.co/vapi-tools` |
| `{{SERVER_URL_SECRET}}` | Same secret set in Edge Function secrets |
| `{{SERVICE_DESCRIPTION}}` | e.g., `tire changes, oil changes, and brake service` |

Create the agent in Vapi (via API or dashboard) and assign the imported phone number to it.

---

## Phase 7: Async Work (No n8n Required)

**n8n has been removed from this project.** All async work runs inline in Fastify route handlers:

- **Post-call summarization** — `src/routes/voice.ts` handles Vapi's `call-ended` webhook, calls OpenAI for summary + sentiment, stores in `call_summaries`.
- **Calendar sync** — `src/services/calendarSync.ts` fires on every appointment mutation (Google + Outlook).
- **CRM sync** — `src/services/syncOrchestrator.ts` fans out to Jobber/HubSpot/Square/ServiceTitan on appointment + customer mutations.
- **SMS / reminders** — `src/routes/communications.ts` + `src/routes/reminders.ts` (routes and Zod schemas exist; provider integration stubbed).

Required env vars for async integrations are all set in Railway (Google/Outlook OAuth creds, CRM OAuth creds, Stripe keys). No separate workflow engine to deploy.

---

## Phase 8: Post-Deployment Verification

### 8.1 Dashboard Smoke Test
1. Open the dashboard URL
2. Log in with the seeded credentials (`admin@secretaryhq.com` / `password`)
3. Verify you can see appointments, customers, and resources
4. Try creating a test appointment through the UI

### 8.2 Edge Function Smoke Test
Test the booking flow directly:
```bash
# Get customer context
curl -X POST https://<PROJECT_ID>.functions.supabase.co/vapi-tools \
  -H "Content-Type: application/json" \
  -H "x-vapi-secret: your-shared-secret" \
  -d '{
    "message": {
      "type": "tool-calls",
      "toolCalls": [{
        "id": "test-1",
        "function": {
          "name": "get_customer_context",
          "arguments": "{\"phone\": \"555-0100\", \"tenant_id\": \"<TENANT_ID>\"}"
        }
      }]
    }
  }'
```

### 8.3 Live Call Test
1. Call the Telnyx phone number
2. The AI should greet you with the tenant's first message
3. Test the full flow: identify as customer, ask about availability, book an appointment
4. Verify the appointment appears in the dashboard

### 8.4 Knowledge Base Test
1. Upload a policy PDF via the dashboard's Knowledge Base tab
2. Call in and ask a policy question (e.g., "What's your cancellation policy?")
3. Verify the AI answers using the uploaded document content

---

## Security Checklist

Before going live, verify:

- [ ] **JWT_SECRET** is a strong random string (not the default `dev-jwt-secret-change-in-production`)
- [ ] **VAPI_SERVER_URL_SECRET** is set and matches between Vapi and Edge Functions
- [ ] **Database password** is strong and not committed to source control
- [ ] **OPENAI_API_KEY** is not exposed in client-side code
- [ ] **Login credentials** have been changed from the seeded defaults
- [ ] **CORS origin** is restricted to your dashboard domain (currently set to `origin: true` which allows all)
- [ ] **Supabase RLS** is verified as enabled on all tenant-scoped tables

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Edge Function returns 500 | Check logs: `npx supabase functions logs vapi-tools` |
| Database connection refused | Verify connection string and that Supabase allows your IP |
| Migrations fail on Supabase | `pgvector` extension must be enabled first |
| Vapi can't reach Edge Function | Ensure `--no-verify-jwt` was used during deploy |
| CORS errors on dashboard | Update CORS origin in `src/index.ts` to your dashboard domain |
| JWT errors after deploy | Ensure `JWT_SECRET` is the same across backend restarts |
| Knowledge base search returns nothing | Verify `pgvector` extension is enabled and documents have embeddings |
