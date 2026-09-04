import type { PoolClient } from 'pg';

/**
 * Set `tenants.default_service_id` from the business template's starter list.
 *
 * WHY THIS EXISTS — the default was alphabetical, and nobody could see it.
 *
 * `default_service_id` is the FALLTHROUGH in `resolveServiceForBooking`: when
 * the caller's words match no service by name and the semantic step is below
 * threshold, this is what gets booked. It is the single most consequential row
 * in a tenant's catalogue, because it is what a caller who *cannot say what
 * they need* ends up on.
 *
 * Nothing set it on the wizard-commit path. It was filled only by the backfill
 * in `seed.sql` / migration 20260630000000, which picks
 *
 *     ORDER BY ABS(COALESCE(s.duration_minutes, 30) - 30) ASC, s.name ASC
 *
 * and the wizard hardcodes every starter to 30 minutes. So the duration term is
 * always a tie and the tie-break is the ONLY term that ever runs: the default
 * was whichever service sorted first alphabetically. Seed a plumber with
 * "Drain cleaning" and "Service call" and *Drain cleaning* silently becomes the
 * fallthrough — so the caller who rings saying "there's water under my sink and
 * I don't know where it's coming from" is booked for a drain clean. The wrong
 * booking arrives through a mechanism that is working perfectly, which is the
 * hardest kind to notice.
 *
 * The policy is now DATA, carried on the starter itself
 * (`is_default` in shared/starterServices.ts):
 *   - repair-heavy verticals (auto-shop, plumber, HVAC, electrician, …) default
 *     to the LOOK-FIRST row — the visit that finds out what the work is.
 *   - specialty-SKU verticals (oil-change, nail-salon, car-wash, …) default to
 *     the main SKU, because there the caller genuinely can name it.
 *
 * WHAT IT DELIBERATELY WILL NOT DO: overwrite a default the owner has already
 * chosen. It writes only when there is no usable default — unset, or pointing
 * at a service that has since been soft-deleted (a dangling default is worse
 * than none: `resolveServiceForBooking`'s fallthrough JOIN finds nothing and
 * drops through to its last-resort "closest to 30 minutes" net, which is the
 * alphabetical lottery all over again).
 */
export async function applyDefaultServicePolicy(
  client: PoolClient,
  tenantId: string
): Promise<{ applied: boolean; serviceName: string | null }> {
  const res = await client.query<{ name: string }>(
    `WITH policy AS (
       SELECT (elem->>'name') AS name
         FROM tenants t
         JOIN business_templates bt ON bt.business_type = t.business_type
         CROSS JOIN LATERAL jsonb_array_elements(bt.example_services) AS elem
        WHERE t.tenant_id = $1
          AND COALESCE((elem->>'is_default')::boolean, false) IS TRUE
        LIMIT 1
     ),
     target AS (
       SELECT s.service_id, s.name
         FROM services s
         JOIN policy p ON p.name = s.name
        WHERE s.tenant_id = $1
          AND COALESCE(s.is_deleted, false) = false
        LIMIT 1
     )
     UPDATE tenants t
        SET default_service_id = target.service_id
       FROM target
      WHERE t.tenant_id = $1
        -- Only when there is no usable default. An owner's explicit choice is
        -- never overwritten; a dangling one (service soft-deleted) is repaired.
        AND (
          t.default_service_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM services d
             WHERE d.service_id = t.default_service_id
               AND COALESCE(d.is_deleted, false) = false
          )
        )
      RETURNING target.name`,
    [tenantId]
  );
  const row = res.rows[0];
  return { applied: !!row, serviceName: row?.name ?? null };
}
