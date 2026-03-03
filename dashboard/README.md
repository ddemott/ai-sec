## AI Secretary Dashboard

This is the **management UI** for the AI Secretary SaaS. It lets owners and admins:

- View and manage appointments across tenants/resources.
- See customer profiles and notes.
- Tweak AI persona settings (system prompt, voice, working hours).

The dashboard is built with **Next.js (App Router)** and **Tailwind CSS**, and talks directly to Supabase and the Edge Functions defined in the root project.

---

## Prerequisites

- Node.js and npm.
- A running Supabase project with this repo's migrations applied.
- Environment variables configured in `.env.local`:
	- `NEXT_PUBLIC_SUPABASE_URL`
	- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

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
- Customer details with notes.
- Basic controls for editing appointments and notes.

---

## Deployment

The dashboard is intended to be deployed on **Vercel**:

1. Push this repo to GitHub.
2. In Vercel, create a new project from the `dashboard/` directory.
3. Configure the same Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy.

Once deployed, owners can log in via Supabase Auth and manage their schedules from the hosted dashboard.
