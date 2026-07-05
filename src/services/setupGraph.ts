/**
 * Shared draft-graph schema + insert logic for the setup wizard's Phase B
 * draft-commit flow. Two callers share this module:
 *   - POST /coverage/dry-run (src/routes/analytics.ts) — inserts the draft
 *     inside a transaction, runs check_coverage_gaps, ALWAYS ROLLS BACK.
 *   - POST /setup/commit (src/routes/setup.ts) — inserts the same draft,
 *     COMMITs. This is the only difference between preview and real setup.
 *
 * The schema carries the FULL column set (description/price/subtitle on
 * services, description on resources, contact fields on employees) even
 * though dry-run doesn't need them for a coverage preview — sharing one
 * schema/insert means the client can serialize its draft once and post the
 * same payload shape to either endpoint. It also closes a real bug found in
 * design review: an earlier version of dry-run wrote NULL for these columns,
 * and reusing that INSERT verbatim for commit would have silently discarded
 * every description/price/employee-contact field the owner typed, with no
 * test catching it. insertDraftGraph always writes what it's given.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { expandWeeklyToSchedule, type WeeklyShiftRow } from './expandWeeklyToSchedule';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DraftGraphSchema = z.object({
  services: z
    .array(
      z.object({
        tmp_id: z.string().min(1),
        name: z.string().min(1),
        duration_minutes: z.number().int().positive().max(1440),
        subtitle: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
        price: z.number().nonnegative().optional(),
      })
    )
    .max(200),
  resources: z
    .array(
      z.object({
        tmp_id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().max(2000).optional(),
      })
    )
    .max(200)
    .default([]),
  employees: z
    .array(
      z.object({
        tmp_id: z.string().min(1),
        name: z.string().min(1),
        first_name: z.string().max(100).optional(),
        last_name: z.string().max(100).optional(),
        email: z.string().email().max(200).optional(),
        phone: z.string().max(30).optional(),
      })
    )
    .max(200)
    .default([]),
  shifts: z
    .array(
      z.object({
        employee_tmp_id: z.string().min(1),
        day_of_week: z.number().int().min(0).max(6),
        start_time: z.string().regex(HHMM_RE),
        end_time: z.string().regex(HHMM_RE),
      })
    )
    .max(2000)
    .default([]),
  service_employee: z
    .array(z.object({ service_tmp_id: z.string().min(1), employee_tmp_id: z.string().min(1) }))
    .max(2000)
    .default([]),
  service_resource: z
    .array(z.object({ service_tmp_id: z.string().min(1), resource_tmp_id: z.string().min(1) }))
    .max(2000)
    .default([]),
});

export type DraftGraph = z.infer<typeof DraftGraphSchema>;

/**
 * Fail fast on a broken draft graph: a shift or mapping referencing a tmp_id
 * not present in the entity lists is a client bug. Silently dropping it (as
 * an early cut of dry-run did) produces a misleading preview or, worse for
 * commit, a partially-wired real business. Returns the list of missing
 * references — empty means the graph is internally consistent.
 */
export function findMissingTmpIdReferences(draft: DraftGraph): string[] {
  const serviceTmpIds = new Set(draft.services.map((s) => s.tmp_id));
  const employeeTmpIds = new Set(draft.employees.map((e) => e.tmp_id));
  const resourceTmpIds = new Set(draft.resources.map((r) => r.tmp_id));
  const missing: string[] = [];
  for (const sh of draft.shifts) {
    if (!employeeTmpIds.has(sh.employee_tmp_id))
      missing.push(`shift → employee ${sh.employee_tmp_id}`);
  }
  for (const m of draft.service_employee) {
    if (!serviceTmpIds.has(m.service_tmp_id)) missing.push(`mapping → service ${m.service_tmp_id}`);
    if (!employeeTmpIds.has(m.employee_tmp_id))
      missing.push(`mapping → employee ${m.employee_tmp_id}`);
  }
  for (const m of draft.service_resource) {
    if (!serviceTmpIds.has(m.service_tmp_id)) missing.push(`mapping → service ${m.service_tmp_id}`);
    if (!resourceTmpIds.has(m.resource_tmp_id))
      missing.push(`mapping → resource ${m.resource_tmp_id}`);
  }
  return [...new Set(missing)];
}

/** Weeks needed so expandWeeklyToSchedule's fan-out spans [startDate, endDate]. */
export function weeksAheadFor(startDate: string, endDate: string): number {
  const spanDays =
    Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
    ) + 1;
  return Math.max(1, Math.ceil(spanDays / 7));
}

export interface InsertDraftGraphCounts {
  services: number;
  resources: number;
  employees: number;
  serviceEmployee: number;
  serviceResource: number;
}

export interface InsertDraftGraphResult {
  serviceId: Map<string, string>;
  resourceId: Map<string, string>;
  employeeId: Map<string, string>;
  counts: InsertDraftGraphCounts;
}

/**
 * Inserts a full draft graph on `client` — resources, services, employees,
 * their weekly shift patterns fanned into employee_schedule, then both
 * mapping tables. Caller decides COMMIT vs ROLLBACK; this function never
 * manages the transaction boundary itself. Always writes the full column set
 * it's given (see module doc) — never silently drops owner-typed fields.
 */
export async function insertDraftGraph(
  client: PoolClient,
  tenantId: string,
  draft: DraftGraph,
  opts: { weeksAhead: number; startDate: Date }
): Promise<InsertDraftGraphResult> {
  const resourceId = new Map<string, string>();
  for (const r of draft.resources) {
    const { rows: rr } = await client.query<{ resource_id: string }>(
      `INSERT INTO resources (tenant_id, name, description, is_auto_seeded)
       VALUES ($1, $2, $3, false) RETURNING resource_id`,
      [tenantId, r.name, r.description ?? null]
    );
    resourceId.set(r.tmp_id, rr[0].resource_id);
  }

  const serviceId = new Map<string, string>();
  for (const s of draft.services) {
    const { rows: sr } = await client.query<{ service_id: string }>(
      `INSERT INTO services
         (tenant_id, name, subtitle, description, duration_minutes, price,
          required_skills, required_resources, is_auto_seeded)
       VALUES ($1, $2, $3, $4, $5, $6, '{}', '{}', false) RETURNING service_id`,
      [
        tenantId,
        s.name,
        s.subtitle ?? null,
        s.description ?? null,
        s.duration_minutes,
        s.price ?? null,
      ]
    );
    serviceId.set(s.tmp_id, sr[0].service_id);
  }

  const employeeId = new Map<string, string>();
  for (const e of draft.employees) {
    const { rows: er } = await client.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills)
       VALUES ($1, $2, $3, $4, $5, $6, '{}') RETURNING employee_id`,
      [
        tenantId,
        e.name,
        e.first_name ?? null,
        e.last_name ?? null,
        e.email ?? null,
        e.phone ?? null,
      ]
    );
    employeeId.set(e.tmp_id, er[0].employee_id);
  }

  // Fan each employee's weekly pattern into date-specific employee_schedule
  // rows, reusing the batched expand-weekly helper (one multi-row INSERT per
  // employee — avoids the historical per-row deadlock + N round-trips).
  const patternByEmployee = new Map<string, WeeklyShiftRow[]>();
  for (const sh of draft.shifts) {
    const empId = employeeId.get(sh.employee_tmp_id);
    if (!empId) continue; // caller validates references before calling; defensive
    const rowsForEmp = patternByEmployee.get(empId) ?? [];
    rowsForEmp.push({
      day_of_week: sh.day_of_week,
      start_time: sh.start_time,
      end_time: sh.end_time,
    });
    patternByEmployee.set(empId, rowsForEmp);
  }
  for (const [empId, pattern] of patternByEmployee) {
    await expandWeeklyToSchedule(client, {
      tenantId,
      employeeId: empId,
      pattern,
      weeksAhead: opts.weeksAhead,
      startDate: opts.startDate,
    });
  }

  let serviceEmployeeCount = 0;
  for (const m of draft.service_employee) {
    const sid = serviceId.get(m.service_tmp_id);
    const eid = employeeId.get(m.employee_tmp_id);
    if (sid && eid) {
      await client.query(
        `INSERT INTO service_employee (service_id, employee_id, tenant_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [sid, eid, tenantId]
      );
      serviceEmployeeCount++;
    }
  }
  let serviceResourceCount = 0;
  for (const m of draft.service_resource) {
    const sid = serviceId.get(m.service_tmp_id);
    const rid = resourceId.get(m.resource_tmp_id);
    if (sid && rid) {
      await client.query(
        `INSERT INTO service_resource (service_id, resource_id, tenant_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [sid, rid, tenantId]
      );
      serviceResourceCount++;
    }
  }

  return {
    serviceId,
    resourceId,
    employeeId,
    counts: {
      services: serviceId.size,
      resources: resourceId.size,
      employees: employeeId.size,
      serviceEmployee: serviceEmployeeCount,
      serviceResource: serviceResourceCount,
    },
  };
}
