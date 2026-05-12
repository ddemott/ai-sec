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
  fn: (client: PoolClient) => Promise<T>,
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
  logger?: FastifyBaseLogger,
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
           LEFT JOIN customers c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
          WHERE a.appointment_id = $1 AND a.tenant_id = $2`,
        [appointmentId, tenantId],
      );
      const row = rows[0];
      if (!row) return;

      const appointmentDateTime = new Date(row.start_time);
      const now = new Date();
      if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= now) {
        return;
      }

      for (const r of REMINDER_BUNDLE) {
        const scheduledFor =
          r.type === 'confirmation'
            ? now
            : new Date(appointmentDateTime.getTime() - r.hoursBefore * 60 * 60 * 1000);
        await client.query(
          `INSERT INTO reminder_schedules
             (appointment_id, tenant_id, customer_email, customer_phone, reminder_type, scheduled_for, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')`,
          [
            appointmentId,
            tenantId,
            row.customer_email,
            row.customer_phone,
            r.type,
            scheduledFor.toISOString(),
          ],
        );
      }
    });
  } catch (err) {
    logger?.error(
      {
        err: err instanceof Error ? err.message : err,
        tenantId,
        appointmentId,
      },
      'Failed to schedule reminders for appointment',
    );
  }
}
