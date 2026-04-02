## SecretaryHQ Dashboard
## README.MD

This is the **management UI** for the SecretaryHQ SaaS. It lets owners and admins:

- View and manage appointments across tenants/resources.
- See unified customer profiles with upcoming/past appointments, AI call summaries, and internal notes.
- Cancel appointments directly from the CRM detail view.
- Search customers by name, phone, or email.
- Tweak AI persona settings (system prompt, voice, working hours).
- Manage employee attributes (name, email, phone) and shift schedules.

The dashboard is built with **Next.js (App Router)** and **Tailwind CSS**. It calls the Fastify backend API (20 route modules under `src/routes/`), which enforces RLS via `withTenantClient()` and reads/writes to the shared Postgres database (Supabase or local Docker). Bookings created by the voice AI tools and the dashboard all hit the same source of truth.

---

## Prerequisites

- Node.js and npm.
- A running Supabase project with this repo's migrations applied.
- Environment variables configured in `.env.local`:
	- `NEXT_PUBLIC_API_BASE_URL` (defaults to `https://localhost:3000`)

---

## Running Locally

From the project root (or inside the `dashboard/` folder):

```bash
cd dashboard
npm install
npm run dev
```

Then open [http://localhost:3001](http://localhost:3001) to access the dashboard.

You should see:
- A multi-tenant appointment view (list/calendar).
- Unified CRM with customer details, upcoming/past appointments, AI call history, and cancel flow.
- Employee management with shift scheduling.
- Knowledge base for RAG document management.
- Analytics dashboard with call volume and revenue metrics.

---

## Deployment

The dashboard is intended to be deployed on **Vercel**:

1. Push this repo to GitHub.
2. In Vercel, create a new project from the `dashboard/` directory.
3. Set `NEXT_PUBLIC_API_BASE_URL` to your deployed backend URL.
4. Deploy.

Once deployed, owners log in using the app's own `users`-table-backed login flow (via the backend `/login` endpoint); Supabase Auth can be wired in later if desired but is not required for the current MVP.
