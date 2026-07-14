-- Thinking Hammer LLC: one bookable Dale, mapped to every service he offers.
--
-- THE STATE THIS FIXES (prod, 2026-07-14):
--
--   * THREE `Dale DeMott` employee rows — one active, two dead. The dead pair carried
--     20 stale employee_schedule rows and no appointments. Duplicate staff rows are how
--     a booking dies with EMPLOYEE_NOT_SCHEDULED for no visible reason: the shifts land
--     on one row and the service mapping points at another, and nothing anywhere says
--     so. (src/routes/employees.ts already carries a comment about "the duplicate Dale
--     DeMott prod case" — this is that case, still sitting in the database.)
--
--   * "Secretary HQ Demonstration" was bookable BY ACCIDENT. It has no service_employee
--     mapping and an empty required_skills, and book_with_scheduling_atomic falls back
--     to the skills array when the mapping is empty — an empty array means EVERY
--     employee qualifies. It worked only because there happened to be exactly one
--     active employee. Add a second, and the demo would start being booked with someone
--     who has never seen it. Booking by accident is not booking.
--
-- SAFETY, checked before writing this: the two inactive rows are referenced by ZERO
-- appointments (appointments.employee_id is ON DELETE SET NULL anyway, so no
-- appointment could be destroyed) and ZERO service_employee rows. Their 20
-- employee_schedule rows CASCADE away, which is the point — those are shifts belonging
-- to nobody.
--
-- Idempotent: safe to re-run.

BEGIN;

-- 1. One Dale. Delete the dead duplicates (their stale shifts cascade with them).
DELETE FROM employees
 WHERE tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'
   AND name = 'Dale DeMott'
   AND is_active = false;

-- 2. He has every skill any of his services asks for. Computed from the services
--    themselves rather than typed by hand, so adding a service that needs a new skill
--    cannot silently leave him unable to perform it.
UPDATE employees e
   SET skills = COALESCE(
         (SELECT array_agg(DISTINCT s.skill)
            FROM services sv,
                 LATERAL unnest(sv.required_skills) AS s(skill)
           WHERE sv.tenant_id = e.tenant_id),
         '{}'
       )
 WHERE e.tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'
   AND e.is_active = true;

-- 3. EVERY service is mapped to him explicitly. The mapping table is the authoritative
--    gate in book_with_scheduling_atomic; the skills array is only a fallback for when
--    the mapping is empty. Relying on that fallback means relying on him being the only
--    employee, which is true today and is not a rule.
INSERT INTO service_employee (tenant_id, service_id, employee_id)
SELECT sv.tenant_id, sv.service_id, e.employee_id
  FROM services sv
  CROSS JOIN employees e
 WHERE sv.tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'
   AND e.tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'
   AND e.is_active = true
ON CONFLICT DO NOTHING;

-- 4. Every service needs a LINE, and service_resource is the other authoritative gate.
--    "Secretary HQ Demonstration" was unmapped on this side too, so it was booking
--    against no resource at all — which means the GiST exclusion constraint that stops
--    two calls landing on the same line at the same time was never protecting it. A
--    demo could be booked on top of a live consultation and nothing would object.
--
--    Every service is mapped to the SAME line the existing services already use, and
--    that is deliberate: it is one man on one phone. Sharing the resource is what makes
--    appointments_no_resource_overlap prevent a double-booking. Giving the demo its own
--    line would let it be scheduled straight over a paying consultation.
--
--    The line is CHOSEN FROM THE DATA (the resource the existing services map to), not
--    hardcoded — so this stays correct if the office line is ever renamed or replaced.
INSERT INTO service_resource (tenant_id, service_id, resource_id)
SELECT sv.tenant_id, sv.service_id, r.resource_id
  FROM services sv
  CROSS JOIN LATERAL (
    SELECT sr.resource_id
      FROM service_resource sr
      JOIN services s2 ON s2.service_id = sr.service_id
     WHERE s2.tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'
     GROUP BY sr.resource_id
     ORDER BY count(*) DESC, sr.resource_id
     LIMIT 1
  ) r
 WHERE sv.tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'
ON CONFLICT DO NOTHING;

COMMIT;
