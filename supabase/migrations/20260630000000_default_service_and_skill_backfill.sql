-- Default service fallthrough + employee-skill backfill.
--
-- Root cause (2026-06-30): callers almost never say the exact service name
-- ("a meeting", "consulting", "talk to Dale" — none substring-match
-- "Programming Consultation"), so the ILIKE service match in the agent tools
-- returned no service → the agent bailed ("having trouble") → bookings NEVER
-- succeeded (0 appointments ever on the live tenant). Two structural fixes so
-- a generic call still books, for every tenant, after a rebuild:
--
--   1. tenants.default_service_id — the service a call books when the caller
--      doesn't name one (or names one we can't match). The agent tools fall
--      through to this as the final else, so no phrasing can dead-end.
--   2. backfill employees.skills so the required_skills of a service are
--      actually held by the employees mapped to it — otherwise the booking RPC
--      (employees.skills @> service.required_skills) returns NO_SKILLED_EMPLOYEE.
--      (For a solo shop the owner IS the employee; this gives them the skills.)

-- 1. Per-tenant default service (the fallthrough). ON DELETE SET NULL so
--    deleting the chosen service degrades to the runtime safety fallback
--    rather than dangling.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_service_id UUID
  REFERENCES services(service_id) ON DELETE SET NULL;

-- 2. Backfill employee skills: every employee mapped to a service must hold
--    that service's required_skills. Union into existing skills (never
--    overwrite); only touch rows actually missing a required skill. Idempotent.
UPDATE employees e
SET skills = ARRAY(SELECT DISTINCT unnest(COALESCE(e.skills, '{}') || agg.req)),
    updated_at = NOW()
FROM (
  SELECT se.employee_id,
         array_agg(DISTINCT rs) AS req
  FROM service_employee se
  JOIN services s ON s.service_id = se.service_id
  CROSS JOIN LATERAL unnest(COALESCE(s.required_skills, '{}')) AS rs
  GROUP BY se.employee_id
) agg
WHERE e.employee_id = agg.employee_id
  AND NOT (COALESCE(e.skills, '{}') @> agg.req);

-- 3. Backfill default_service_id where unset: the bookable (has a mapped
--    employee), non-deleted service whose duration is closest to a 30-minute
--    meeting, tie-broken by name. Owners can change it later from the dashboard.
UPDATE tenants t
SET default_service_id = (
  SELECT s.service_id
  FROM services s
  WHERE s.tenant_id = t.tenant_id
    AND COALESCE(s.is_deleted, false) = false
    AND EXISTS (SELECT 1 FROM service_employee se WHERE se.service_id = s.service_id)
  ORDER BY ABS(COALESCE(s.duration_minutes, 30) - 30) ASC, s.name ASC
  LIMIT 1
)
WHERE t.default_service_id IS NULL;
