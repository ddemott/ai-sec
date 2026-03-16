# AI Secretary SaaS - Setup Guide

## 🧱 Prerequisites
- **Node.js**: v18+
- **Deno**: For Edge Function development and testing.
- **Docker & Docker Compose**: For local Postgres (pgvector).
- **Postgres (psql)**: For schema application.
- **Vapi Account**: For live telephony orchestration.
- **Supabase Account**: For hosting Edge Functions and Postgres.
- **OpenAI API Key**: Required for RAG embeddings and post-call summaries.

## ⚙️ Initial Setup

### 1. Install Dependencies
```bash
npm install
cd dashboard && npm install
```

### 2. Configure Environment
Create `.env` (root) and `dashboard/.env.local`:

**root `.env`**:
```env
DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
OPENAI_API_KEY=sk-proj-...
VAPI_SERVER_URL_SECRET=your-shared-secret
NODE_ENV=development
```

**dashboard/.env.local`**:
```env
NEXT_PUBLIC_API_BASE_URL=https://localhost:3000
```

### 3. Initialize Database
Ensure Docker is running, then use the bootstrap script:
```bash
# This starts Docker, runs all migrations, and seeds the DB.
npm run bootstrap
```

Alternatively, to apply migrations to an existing DB:
```bash
./scripts/setup-db.sh
```

## 🧠 Knowledge Base Ingestion (RAG)
To feed the AI with business information, use the ingestion script:
```bash
export OPENAI_API_KEY=your_key
deno run --allow-net --allow-read --allow-env scripts/ingest-knowledge.ts <TENANT_ID> <FILE_PATH>
```
*Tip: You can also upload files directly via the "Knowledge Base" tab in the Dashboard.*

## 🔐 SSL/HTTPS
The backend and dashboard use HTTPS for local development. Certificates are located in `/certs`. If you experience certificate warnings, you may need to trust `localhost-cert.pem`.

## 🧪 Testing
```bash
# Backend (Vitest — runs against test_db on port 5433)
npx vitest run src/ --fileParallelism=false

# Dashboard (Vitest — jsdom environment)
cd dashboard && npx vitest run

# Edge Functions (Deno)
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/test_db
deno task test --no-check
```

## 🚀 Running the App
```bash
npm start
```
- **Dashboard:** [https://localhost:3001](https://localhost:3001)
- **Login:** `dale@ai-sec.com` / `password`

## 🛠 Troubleshooting

If you see a "setConfig is not defined" error in the dashboard, ensure the following line exists in `dashboard/components/AIConfigView.tsx`:

```ts
const [config, setConfig] = useState<Tenant | null>(null);
```
