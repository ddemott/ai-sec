-- job_inquiries: structured work/job inquiries captured by the voice agent.
-- A recruiter calls asking whether the owner is available for work; the agent
-- runs a deterministic intake (company, contract vs full-time, rate/salary,
-- duration, onsite/remote/hybrid, address or timezone) and records it here,
-- then emails the owner (tenants.job_inquiry_email, fallback owner email).
--
-- All position fields are nullable: the contract vs full-time branches collect
-- different subsets, and a caller may bail mid-intake — a partial inquiry is
-- still worth persisting and notifying on.
--
-- Isolation: RLS-scoped to tenant like all transactional tables.
-- PK convention: job_inquiry_id UUID (domain entity, externally referenced).

CREATE TABLE job_inquiries (
  job_inquiry_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id        UUID        REFERENCES customers(customer_id),
  company            TEXT,
  represents_company BOOLEAN,
  employment_type    TEXT,
  rate_range         TEXT,
  duration           TEXT,
  location_type      TEXT,
  address            TEXT,
  timezone           TEXT,
  caller_name        TEXT,
  callback_phone     TEXT,
  call_id            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_inquiries_tenant
  ON job_inquiries(tenant_id, created_at DESC);

ALTER TABLE job_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_inquiries FORCE ROW LEVEL SECURITY;

CREATE POLICY job_inquiries_tenant_isolation ON job_inquiries
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Per-tenant override for where job-inquiry notifications are emailed. When
-- null, the route falls back to the tenant owner's user email. Set to
-- DaleDeMott@thinkinghammer.com for Thinking Hammer (Beth's tenant).
ALTER TABLE tenants ADD COLUMN job_inquiry_email TEXT;
