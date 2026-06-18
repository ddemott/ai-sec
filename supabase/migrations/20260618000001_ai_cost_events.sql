-- ai_cost_events: per-call AI usage tracking.
-- SERIAL PK per append-only event table convention; UUID FK for tenant.
-- call_id TEXT (correlation to voice_sessions.call_id — no FK because
-- voice_sessions may be absent when the cost originates from KB ingestion).

CREATE TABLE IF NOT EXISTS ai_cost_events (
    ai_cost_event_id  SERIAL PRIMARY KEY,
    tenant_id         UUID    NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    call_id           TEXT,
    source            TEXT    NOT NULL, -- 'voice_call' | 'kb_ingestion' | 'kb_query' | 'call_summary'
    provider          TEXT    NOT NULL, -- 'openai' | 'xai' | 'deepgram'
    model             TEXT    NOT NULL,
    input_tokens      INT     NOT NULL DEFAULT 0,
    output_tokens     INT     NOT NULL DEFAULT 0,
    characters_count  INT     NOT NULL DEFAULT 0,
    audio_duration_ms INT     NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_cost_events_tenant_month
    ON ai_cost_events (tenant_id, created_at);
