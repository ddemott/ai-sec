-- Store the weekly rule the Setup wizard already collects, instead of throwing
-- it away and reconstructing it from rows later.
--
-- THE BUG THIS CLOSES:
--
-- `employee_schedule` holds one concrete row per DATE and no rule. The wizard
-- collects "Mon-Fri, 1-5", fans it into ~4 weeks of rows (expandWeeklyToSchedule)
-- and drops the pattern on the floor. `extendSchedules` then has to GUESS the
-- rule back out of the rows, and it guesses from the last 7 days of the
-- schedule -- where `last day` was MAX(shift_date) over ALL TIME. One one-off
-- shift 300 days out ("annual inventory Saturday") makes that tail week
-- Saturday-only, so Mon-Fri quietly stop being extended and the business goes
-- unbookable in ~180 days -- by the very worker written to prevent that.
--
-- Every row-archaeology fix for that is wrong in its own way (a recent-window
-- rule resurrects a weekday the owner dropped; a "densest week" rule
-- over-schedules the light leg of a rotation, which puts a real customer in
-- front of a locked door; a "needs 3+ weekdays" rule breaks the Saturday-only
-- owner outright). They are all attempts to recover an intent we deleted on
-- purpose. This table keeps the intent.
--
-- Natural key, per the house convention: the (tenant, employee, weekday) triple
-- IS the identity of a weekly rule, so it is the PK -- no surrogate id.
-- One row per weekday matches the shape the wizard already produces
-- (expandWeeklyToSchedule collapses duplicate weekdays, last write wins).
--
-- NOTE ON WHAT THIS DOES NOT DO: there is deliberately NO BACKFILL. Existing
-- tenants have rows and no declared rule, and inventing one from their rows is
-- the archaeology this table exists to end. They keep the (now clamped) derived
-- fallback in extendSchedules until they next save their hours, at which point
-- the rule lands and the guessing stops for them permanently.

CREATE TABLE IF NOT EXISTS employee_schedule_pattern (
  tenant_id    UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  employee_id  UUID        NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  day_of_week  SMALLINT    NOT NULL,
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, employee_id, day_of_week),
  CONSTRAINT employee_schedule_pattern_dow_chk CHECK (day_of_week BETWEEN 0 AND 6)
);

CREATE TRIGGER trg_employee_schedule_pattern_updated_at
  BEFORE UPDATE ON employee_schedule_pattern
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

ALTER TABLE employee_schedule_pattern ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_schedule_pattern FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'employee_schedule_pattern'
      AND policyname = 'employee_schedule_pattern_tenant_isolation'
  ) THEN
    CREATE POLICY employee_schedule_pattern_tenant_isolation ON employee_schedule_pattern
      USING (tenant_id = tenant_ctx_uuid())
      WITH CHECK (tenant_id = tenant_ctx_uuid());
  END IF;

  -- Matches the admin-bypass shape already on employee_schedule: the schedule
  -- extender's own worker sweeps per tenant WITH context set, but the
  -- migration runner and maintenance scripts have none.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'employee_schedule_pattern'
      AND policyname = 'employee_schedule_pattern_admin_bypass'
  ) THEN
    CREATE POLICY employee_schedule_pattern_admin_bypass ON employee_schedule_pattern
      USING (tenant_ctx() = '')
      WITH CHECK (tenant_ctx() = '');
  END IF;
END $$;

COMMENT ON TABLE employee_schedule_pattern IS
  'The DECLARED weekly working rule per employee. employee_schedule holds concrete dated rows; this holds the intent those rows were generated from, so the schedule extender projects a stated rule instead of guessing one back out of history.';

COMMENT ON COLUMN employee_schedule_pattern.day_of_week IS
  '0-6, Sunday = 0 — same encoding as EXTRACT(DOW) and JS getUTCDay(), which is what the wizard sends.';
