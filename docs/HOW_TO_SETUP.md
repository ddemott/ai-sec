# AI Secretary SaaS - Setup Guide

## 🧱 Prerequisites
- **Node.js**: v18+
- **Docker & Docker Compose**: For local Postgres (pgvector).
- **Postgres (psql)**: For schema application.
- **Vapi Account**: For live telephony.
- **Supabase Account**: For edge functions.

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
NODE_ENV=development
```

**dashboard `.env.local`**:
```env
NEXT_PUBLIC_API_BASE_URL=https://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-key
```

### 3. Initialize Database
Ensure Docker is running, then use the setup script:
```bash
# This starts Docker, runs all migrations, and seeds the DB.
npm run bootstrap
```

Alternatively, to just update schema and seed:
```bash
./scripts/setup-db.sh
```

## 🔐 SSL/HTTPS (Self-Signed Certificates)
The project is built to use HTTPS on both ports 3000 and 3001. 

**Important:** You MUST trust the backend certificate in your browser to avoid 401/404/Connection Errors:
1. Open [https://localhost:3000/health](https://localhost:3000/health).
2. Click **Advanced** -> **Proceed to localhost (unsafe)**.
3. Once you see `{"status":"ok"}`, your browser will allow the Dashboard to communicate with the Backend.

## 🚀 Running the App
```bash
npm start
```
- **Dashboard:** [https://localhost:3001](https://localhost:3001)
- **Login:** `dale@ai-sec.com` / `password`
