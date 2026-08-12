-- Generic intake envelope for structured call captures.
--
-- WHY: job_inquiries is the current live projection, but future presets (service
-- estimate requests, salon leads, generic local-service callbacks) should not
-- need a brand-new top-level table just to land structured caller data. This
-- table is the durable envelope: one row per captured intake, type-tagged,
-- payload-preserving, and reusable across projections.
--
-- The first writer is capture-job-inquiry. It inserts here BEFORE the
-- specialized job_inquiries row so the generic capture survives even if later
-- projection work evolves or forks.

CREATE TABLE IF NOT EXISTS intake_submissions (
  submission_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id      UUID        NULL REFERENCES customers(customer_id) ON DELETE SET NULL,
  appointment_id   UUID        NULL REFERENCES appointments(appointment_id) ON DELETE SET NULL,
  submission_type  TEXT        NOT NULL,
  call_id          TEXT        NULL,
  caller_name      TEXT        NOT NULL,
  callback_phone   TEXT        NULL,
  payload_json     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT intake_submissions_submission_type_chk CHECK (submission_type <> '')
);

CREATE TRIGGER trg_intake_submissions_updated_at
  BEFORE UPDATE ON intake_submissions
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_intake_submissions_tenant_created
  ON intake_submissions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intake_submissions_type
  ON intake_submissions (tenant_id, submission_type, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS intake_submissions_one_per_call_type
  ON intake_submissions (tenant_id, submission_type, call_id)
  WHERE call_id IS NOT NULL;

ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_submissions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intake_submissions'
      AND policyname = 'intake_submissions_tenant_isolation'
  ) THEN
    CREATE POLICY intake_submissions_tenant_isolation ON intake_submissions
      USING (tenant_id = tenant_ctx_uuid())
      WITH CHECK (tenant_id = tenant_ctx_uuid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intake_submissions'
      AND policyname = 'intake_submissions_admin_bypass'
  ) THEN
    CREATE POLICY intake_submissions_admin_bypass ON intake_submissions
      USING (tenant_ctx() = '')
      WITH CHECK (tenant_ctx() = '');
  END IF;
END $$;

COMMENT ON TABLE intake_submissions IS
  'Generic structured intake envelope captured from calls before any domain-specific projection (job inquiry, estimate request, etc.).';

COMMENT ON COLUMN intake_submissions.submission_type IS
  'Domain tag for the payload and downstream projector, e.g. job_inquiry.';

COMMENT ON COLUMN intake_submissions.payload_json IS
  'Canonical captured payload in caller-facing terms. Projection tables may normalize subsets of this JSON into typed columns.';

COMMENT ON INDEX intake_submissions_one_per_call_type IS
  'Per-call idempotency for generic intake envelopes, keyed by tenant + submission_type + call_id.';
