# AI Secretary SaaS – Project Context & Decisions

## Project Status
- **Current Phase**: **PoC Complete**.
- **Ready for**: Live Integration Testing with real phone calls.
- **Backend Strategy**: **Edge-First / Serverless**.
- **Dashboard Goal**: **Management & Intervention** (Achieved).

## Key Architecture Decisions
1. **Zero-Scale Infrastructure**: Supabase Edge Functions + Postgres.
2. **Modular Layering**: Hexagonal architecture (Adapter/Service/Repository).
3. **Multi-Tenancy**: Secured via Postgres RLS and `api_user` role.
4. **Strict TDD**: **100% Test Pass Rate**. Backend, Edge, and Frontend are fully verified.
5. **Repeatability**: `start-all.sh` brings up the entire stack from scratch.

## Recent Progress
- **Dashboard UI**: Built a responsive Outlook-style manager for Appointments, CRM, and AI Tuning.
- **Full Coverage**: Achieved 94%+ coverage on core logic and verified RLS isolation.
- **Manual Intervention**: Owners can now Reschedule, Cancel, and Edit Notes directly.

## Next Steps (Live)
1.  **Deploy**: Push Edge Functions to Supabase and Dashboard to Vercel.
2.  **Connect**: Link the Vapi Agent to the live Edge Function URL.
3.  **Call**: Test the system with a real phone call to DynaTire.
