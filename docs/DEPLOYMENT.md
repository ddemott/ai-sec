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
CREATE EXTENSION IF NOT EXISTS pg_net;
```
- `pgvector`: Required for RAG knowledge base embeddings
- `pg_net`: Required for the `notify_n8n_on_appointment` trigger to make HTTP calls

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

This applies all 55 migrations in order and seeds the database with the DynaTire demo tenant.

### 2.3 Create the api_user Role
The migrations create an `api_user` role with least-privilege grants. On Supabase, you may need to verify this role exists:

```sql
-- Check if api_user was created
SELECT rolname FROM pg_roles WHERE rolname = 'api_user';
```

If the role wasn't created (some Supabase plans restrict `CREATE ROLE`), you have two options:
1. **Recommended**: Use the Supabase service_role connection for the backend instead of a separate api_user pool
2. **Alternative**: Create the role manually via the SQL Editor with the same grants from `20260228000003_api_user.sql`

### 2.4 Verify the Schema
Spot-check that critical objects exist:
```sql
-- Tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Key functions
SELECT proname FROM pg_proc WHERE proname IN (
  'book_appointment_atomic', 'check_availability_with_tz',
  'notify_n8n_on_appointment', 'link_orphaned_transcripts',
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

**Database compatibility**: The backend uses a single DB pool via `DATABASE_URL`. All 20 RLS-enabled tables have `FORCE ROW LEVEL SECURITY` so tenant isolation works even with the Supabase `postgres` role (no separate `api_user` needed). Apply the migration `20260323000000_force_rls_single_pool.sql` to Supabase before deploying.

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
| `PORT` | No | Server port (default: `3000`) |
| `STRIPE_SECRET_KEY` | Yes | Stripe API key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret (create after deploy) |
| `STRIPE_SOLO_PRICE_ID` | Yes | Stripe price ID for Solo plan |
| `STRIPE_GROWTH_PRICE_ID` | Yes | Stripe price ID for Growth plan |
| `STRIPE_PRO_PRICE_ID` | Yes | Stripe price ID for Pro plan |
| `STRIPE_ENTERPRISE_PRICE_ID` | No | Stripe price ID for Enterprise plan |
| `DASHBOARD_URL` | No | Dashboard URL for Stripe checkout redirects (default: `https://localhost:3001`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (for Google Calendar sync) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | No | OAuth callback URL (e.g., `https://your-backend/calendar/auth/google/callback`) |

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
| `{{VOICE_PROVIDER}}` | e.g., `cartesia` or `11labs` |
| `{{VOICE_ID}}` | Voice ID from your provider |
| `{{SERVER_URL}}` | `https://<PROJECT_ID>.functions.supabase.co/vapi-tools` |
| `{{SERVER_URL_SECRET}}` | Same secret set in Edge Function secrets |
| `{{SERVICE_DESCRIPTION}}` | e.g., `tire changes, oil changes, and brake service` |

Create the agent in Vapi (via API or dashboard) and assign the imported phone number to it.

---

## Phase 7: n8n Workflows (Optional)

The project includes two n8n workflow blueprints in `n8n/`:

### 7.1 Post-Call Summarizer (`n8n/post_call_summarizer.json`)
- Triggered by Vapi's "call ended" webhook
- Generates AI summaries and sentiment via OpenAI
- Stores results in `call_summaries` table

### 7.2 Calendar Sync (Direct Backend Integration)
Google Calendar sync is now built directly into the Fastify backend — no n8n required. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in Railway env vars. Tenants connect via Settings > Calendar Synchronization > Connect Google Calendar (OAuth flow). Appointments automatically sync on create, update, delete, and cancel.

The legacy n8n blueprint (`n8n/calendar_sync.json`) is retained for reference but is no longer the active implementation.

### Setup
1. Deploy n8n (self-hosted or [n8n.cloud](https://n8n.cloud))
2. Import the workflow JSON files
3. Set the n8n webhook URL on the tenant:
   ```sql
   UPDATE tenants SET n8n_webhook_url = 'https://your-n8n-instance.com/webhook/...'
   WHERE id = '<TENANT_ID>';
   ```

### 7.3 Enable Database Webhooks (Alternative to pg_net)
If `pg_net` isn't available or you prefer Supabase-native webhooks:
1. Go to **Database** > **Webhooks** in the Supabase dashboard
2. Create a webhook on the `appointments` table for `INSERT` events
3. Point it to your n8n webhook URL

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
- [ ] **pg_net** is enabled for the n8n trigger (or Database Webhooks are configured)

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Edge Function returns 500 | Check logs: `npx supabase functions logs vapi-tools` |
| Database connection refused | Verify connection string and that Supabase allows your IP |
| Migrations fail on Supabase | Some extensions need enabling first (`pgvector`, `pg_net`) |
| `api_user` role doesn't exist | See Phase 2.2 — use service_role or create manually |
| Vapi can't reach Edge Function | Ensure `--no-verify-jwt` was used during deploy |
| CORS errors on dashboard | Update CORS origin in `src/index.ts` to your dashboard domain |
| JWT errors after deploy | Ensure `JWT_SECRET` is the same across backend restarts |
| Knowledge base search returns nothing | Verify `pgvector` extension is enabled and documents have embeddings |
