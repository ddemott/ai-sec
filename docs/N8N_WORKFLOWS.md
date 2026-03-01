# AI Secretary SaaS – n8n Workflows (Async Layer)

To maintain ultra-low latency in the voice call, all high-latency external tasks (Sync, SMS, Summarization) are handled by **n8n** in the background.

---

## 1. Workflow: Post-Call Summarizer & Memory
**Trigger:** HTTP Webhook (Called by Vapi's `end-of-call-report` or Postgres Trigger).

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

## 2. Workflow: External Calendar Sync
**Trigger:** Postgres Webhook (on `appointments` insert/update).

1.  **Lookup Tenant Credentials:** Get Google/Outlook OAuth tokens from the `tenants` table.
2.  **Filter Status:** If status is `scheduled`:
    -   **Google Calendar Node:** Create Event.
    -   **Outlook Calendar Node:** Create Event.
3.  **Store Mapping:** Update the `appointments` table with the `external_id` from the provider.
4.  **Error Handling:** If sync fails, retry 3 times with exponential backoff.

---

## 3. Workflow: Owner Booking Notification
**Trigger:** Postgres Webhook (on `appointments` insert).

1.  **Format Message:** "🔔 New Booking: [Customer Name] for [Service] at [Time]. Check your calendar for details."
2.  **Telnyx SMS Node:** Send SMS to the `owner_phone` retrieved from the `tenants` table.

---

## 4. How to Import (Repeatability)
To reproduce these workflows:
1.  **Install n8n:** `docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n`.
2.  **Import JSON:** (JSON blueprints will be provided in the `n8n/` directory as the project matures).
3.  **Set Environment Variables:**
    -   `SUPABASE_URL`
    -   `SUPABASE_KEY`
    -   `OPENAI_API_KEY` (for embeddings/summarization)
    -   `TELNYX_API_KEY`
