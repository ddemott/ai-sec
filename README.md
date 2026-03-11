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

## 🛠 Infrastructure
- **Database Persistence**: Local data is stored in a persistent Docker volume (`ai-sec-db-data`). Data survives container restarts and computer reboots.
- **Test Isolation**: Development data is protected from automated tests through a dedicated `test_db` environment. Tests will not wipe your main development data.
- **Ports**: Backend (3000), Dashboard (3001), Postgres (5433).

## 🐘 Database Management
To re-apply schema and seed data at any time:
```bash
./scripts/setup-db.sh
```

To use a custom database (e.g., in the cloud):
```bash
./scripts/setup-db.sh postgresql://user:pass@host:5432/dbname
```

## 🧪 Testing & Coverage
- All tests pass: backend, dashboard, and edge logic.
- Excellent test coverage: AppointmentView, dashboard calendar, and core booking flows are fully verified.
- Backend tests: `npm test`
- Frontend tests: `cd dashboard && npm test`
- Edge logic: `deno test` (Requires Deno)
- Test-driven development ensures operational reliability.
