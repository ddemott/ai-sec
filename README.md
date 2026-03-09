# AI Secretary SaaS

A multi-tenant AI reception platform for modern businesses. Provides high-fidelity AI-driven call handling, appointment booking, and CRM integration.

## 🚀 Quick Start (Local Development)

### 1. Bootstrap the Environment
Ensure Docker is running, then run:
```bash
npm run bootstrap
```
This installs dependencies, starts the database, applies all migrations, and seeds the initial data.

### 2. Trust the Backend Certificate
Because the backend uses HTTPS with self-signed certificates, you must trust it in your browser:
- Visit: [https://localhost:3000/health](https://localhost:3000/health)
- Click **Advanced** -> **Proceed to localhost (unsafe)**.
- You should see `{"status":"ok"}`.

### 3. Start the Stack
```bash
npm start
```
- **Dashboard:** [https://localhost:3001](https://localhost:3001)
- **Backend API:** [https://localhost:3000](https://localhost:3000)

### 4. Sign In
- **Email:** `dale@ai-sec.com`
- **Password:** `password`

## 🛠 Project Structure
- `/src`: Fastify backend (Multi-tenant management API).
- `/dashboard`: Next.js frontend (Admin & Owner portal).
- `/supabase`: SQL migrations, seed data, and Edge Functions for Vapi.
- `/scripts`: Automation for setup, starting, and restarting the stack.

## 🐘 Database Management
To re-apply schema and seed data at any time:
```bash
./scripts/setup-db.sh
```

To use a custom database (e.g., in the cloud):
```bash
./scripts/setup-db.sh postgresql://user:pass@host:5432/dbname
```

## 🧪 Testing
- Backend tests: `npm test`
- Frontend tests: `cd dashboard && npm test`
- Edge logic: `deno test` (Requires Deno)
