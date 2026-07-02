import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';

const REMINDER_BUNDLE = [
  { type: 'confirmation' as const, hoursBefore: 0 },
  { type: '72h' as const, hoursBefore: 72 },
  { type: '24h' as const, hoursBefore: 24 },
  { type: '2h' as const, hoursBefore: 2 },
];

export type WithTenantClient = <T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
) => Promise<T>;

/**
 * Schedule the 4 standard reminders (confirmation + 72h/24h/2h before) for a
 * freshly created appointment. Fire-and-forget: errors are logged but never
 * bubble back — a reminder failure must never fail the underlying booking.
 *
 * Why no `ReminderService` instance: that class pulls in CommunicationService
 * + ConsentService + TenantConfigService just to write four rows. The write
 * itself is a single INSERT per reminder type; the worker handles consent
 * + delivery at send time.
 *
 * Skips silently if (a) the appointment row vanished between RPC + lookup,
 * (b) start_time is in the past or unparseable. Past-time is the documented
 * walk-in carve-out: operators can record an appointment for a moment that
 * has already happened, and reminders for it would be nonsensical.
 */
export async function scheduleRemindersForAppointment(
  withTenantClient: WithTenantClient,
  tenantId: string,
  appointmentId: string,
  logger?: FastifyBaseLogger
): Promise<void> {
  try {
    await withTenantClient(tenantId, async (client) => {
      const { rows } = await client.query<{
        start_time: string;
        customer_email: string | null;
        customer_phone: string | null;
      }>(
        `SELECT a.start_time, c.email AS customer_email, c.phone AS customer_phone
           FROM appointments a
           LEFT JOIN customers c ON c.customer_id = a.customer_id AND c.tenant_id = a.tenant_id
          WHERE a.appointment_id = $1 AND a.tenant_id = $2`,
        [appointmentId, tenantId]
      );
      const row = rows[0];
      if (!row) return;

      const appointmentDateTime = new Date(row.start_time);
      const now = new Date();
      if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= now) {
        return;
      }

      // Idempotency guard: skip if a scheduled bundle already exists for this
      // appointment. Prod calls this fire-and-forget once per booking, but any
      // retry wrapper (or a double tool-call from the agent) would otherwise
      // seed a duplicate bundle and double-remind the customer (found
      // 2026-07-01 by the real-DB companion test). Reschedules still work:
      // rescheduleRemindersForAppointment cancels the old bundle first, so
      // this probe sees no 'scheduled' rows and the fresh seed proceeds.
      const existing = await client.query(
        `SELECT 1 FROM reminder_schedules
          WHERE appointment_id = $1 AND tenant_id = $2 AND status = 'scheduled'
          LIMIT 1`,
        [appointmentId, tenantId]
      );
      if (existing.rows.length > 0) return;

      // Build one multi-row INSERT for the 4 reminder rows. Sequential
      // single-row INSERTs each acquire `audit_log` row locks one at
      // a time, creating a window where the test's cleanup cascade
      // (DELETE FROM tenants → cascade to reminder_schedules → audit
      // trigger) deadlocks against this in-flight bundle. Single
      // INSERT acquires the locks once and releases them once.
      // Origin: 2026-05-18 — same shape as the expand-weekly fix in
      // src/services/expandWeeklyToSchedule.ts.
      const valuesSql: string[] = [];
      const params: (string | null)[] = [];
      REMINDER_BUNDLE.forEach((r, i) => {
        const scheduledFor =
          r.type === 'confirmation'
            ? now
            : new Date(appointmentDateTime.getTime() - r.hoursBefore * 60 * 60 * 1000);
        const base = i * 6;
        valuesSql.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'scheduled')`
        );
        params.push(
          appointmentId,
          tenantId,
          row.customer_email,
          row.customer_phone,
          r.type,
          scheduledFor.toISOString()
        );
      });
      await client.query(
        `INSERT INTO reminder_schedules
           (appointment_id, tenant_id, customer_email, customer_phone, reminder_type, scheduled_for, status)
         VALUES ${valuesSql.join(', ')}`,
        params
      );
    });
  } catch (err) {
    logger?.error(
      {
        err: err instanceof Error ? err.message : err,
        tenantId,
        appointmentId,
      },
      'Failed to schedule reminders for appointment'
    );
  }
}

/**
 * Cancel any pending reminders for an appointment (status='scheduled') and
 * seed a fresh bundle. Used by `/appointments/:id/update` when the operator
 * moves an appointment's start_time — without this, the existing reminder
 * rows fire at the OLD time, surprising both the customer ("why am I getting
 * a 2pm reminder when my appointment was rescheduled to 4pm?") and the
 * reception desk ("the customer just showed up at 2pm and we don't have
 * them").
 *
 * Pending reminders are cancelled (not deleted) so the audit trail is
 * preserved — `status='cancelled'` rows tell the support story when a
 * customer complains they got conflicting reminders.
 *
 * Two-step (cancel-then-seed) rather than one transaction: scheduleFor-
 * Appointment opens its own pool client, and the brief window between
 * cancel and seed (sub-millisecond in practice) doesn't matter for
 * fire-and-forget reminder math. Race with the worker is safe — the worker
 * filters on `status='scheduled' AND scheduled_for <= now()`, so a
 * still-cancelled-not-yet-seeded snapshot just yields zero rows for that
 * appointment.
 */
export async function rescheduleRemindersForAppointment(
  withTenantClient: WithTenantClient,
  tenantId: string,
  appointmentId: string,
  logger?: FastifyBaseLogger
): Promise<void> {
  try {
    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `UPDATE reminder_schedules
            SET status = 'cancelled', updated_at = NOW()
          WHERE appointment_id = $1 AND tenant_id = $2 AND status = 'scheduled'`,
        [appointmentId, tenantId]
      );
    });
  } catch (err) {
    logger?.error(
      {
        err: err instanceof Error ? err.message : err,
        tenantId,
        appointmentId,
      },
      'Failed to cancel existing reminders for appointment'
    );
    // Don't bail — still try to seed fresh reminders.
  }
  await scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId, logger);
}
