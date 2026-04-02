# SecretaryHQ SaaS – n8n Workflows (Async Layer)

To maintain ultra-low latency in the voice call, all high-latency external tasks (Sync, SMS, Summarization) are handled by **n8n** in the background.

---

## 1. Workflow: Post-Call Summarizer & Memory (Implemented)
**Trigger (recommended):** Supabase Database Webhook on `appointments` (or call-log) insert.

> You can also wire this to Vapi's `end-of-call-report` webhook if you prefer call-level triggering. The current deployment TODO assumes Supabase Database Webhooks as the primary entrypoint.

1.  **Extract Data:** Get the `call_id` and `transcript` from the payload.
2.  **LLM Call (GPT-4o-mini):**
    -   *Prompt:* "Summarize this call transcript. Extract: Customer Name, Vehicle Info, Issue, and Tone. Be concise."
3.  **Update Database:**
    -   Insert into `call_summaries` table.
4.  **Vector Embedding:**
    -   Generate embedding for the summary using OpenAI's `text-embedding-3-small`.
    -   Update the `embedding` column in `call_summaries`.
5.  **Status Update:** Mark call as "Processed" in the database.

---

## 2. Workflow: External Calendar Sync (Superseded)
**Status:** Replaced by direct Fastify integration.

Calendar sync (Google Calendar + Outlook Calendar) is now handled directly in the Fastify backend (`src/services/googleCalendar.ts`, `src/services/outlookCalendar.ts`, `src/services/calendarSync.ts`) rather than through n8n. Appointment mutations trigger fire-and-forget sync to both Google and Outlook calendars with automatic token refresh. CRM sync (Jobber, HubSpot, Square, ServiceTitan) is also handled directly in the backend with bidirectional sync. The n8n workflow blueprint (`n8n/calendar_sync.json`) is retained for reference but is no longer the active implementation.

See `docs/ARCHITECTURE.md` section 7 for the current architecture.

---

## 3. Workflow: Owner Booking Notification (Planned)
**Status:** Design complete, implementation pending.

**Trigger:** Postgres Webhook (on `appointments` insert).

1.  **Format Message:** "🔔 New Booking: [Customer Name] for [Service] at [Time]. Check your calendar for details."
2.  **Telnyx SMS Node:** Send SMS to the `owner_phone` retrieved from the `tenants` table.

---

## 4. Workflow: Tenant Knowledge Ingestion (Planned)
**Status:** Design complete, implementation pending.

**Trigger:** Manual (per-tenant) or file upload event (PDF added/updated).

1.  **Fetch Document:** Receive a PDF or text blob for a given `tenant_id` (e.g., "Hours & Policies.pdf").
2.  **Extract & Chunk Text:** Use a PDF/Text node to extract content and split it into small, semantically coherent sections.
3.  **Generate Embeddings:** Call OpenAI `text-embedding-3-small` on each chunk.
4.  **Upsert into Supabase:** Insert or update rows in the `tenant_docs` (or equivalent) table with `tenant_id`, `title`, `section`, `content`, `source`, and the embedding vector.
5.  **Verification Step:** Optionally trigger a preview check (e.g., via a small QA tool) to confirm that typical questions like "What are your hours?" retrieve the expected snippets.

---
## 5. How to Import (Repeatability)
To reproduce these workflows:
1.  **Choose n8n Deployment:**
    - **n8n Cloud (recommended for production):** Sign up at `app.n8n.cloud`, create an instance, and open the hosted editor.
    - **Self-Hosted (local/dev):** `docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n`.
2.  **Import JSON:**
    - Use `n8n/post_call_summarizer.json` for the Post-Call Summarizer.
    - Future JSON blueprints for Calendar Sync and Owner Notification will be added to the `n8n/` directory.
3.  **Set Environment Variables (where applicable):**
    - `SUPABASE_URL`
    - `SUPABASE_KEY`
    - `OPENAI_API_KEY` (for embeddings/summarization)
    - `TELNYX_API_KEY`
