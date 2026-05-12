import type { Pool } from 'pg';
import * as gcal from './googleCalendar';
import * as outlook from './outlookCalendar';
import { type SyncLogger, defaultSyncLogger, getCalendarTokens } from './tokenManagement';

type CalendarProvider = typeof gcal | typeof outlook;

/** Build a structured log prefix: WHO (tenant) + WHAT (action) + WHERE (appointment) */
function ctx(tenantId: string, appointmentId: string, action: string) {
  return `[calendar-sync] tenant=${tenantId} appointment=${appointmentId} action=${action}`;
}

/**
 * Maps the stored provider string to the matching provider module.
 * Centralized so the file picks Google vs Outlook in one place.
 */
function pickProviderModule(provider: 'google' | 'outlook'): {
  module: CalendarProvider;
  name: string;
} {
  return provider === 'outlook'
    ? { module: outlook, name: 'Outlook' }
    : { module: gcal, name: 'Google' };
}

/**
 * Sync an appointment to the tenant's connected external calendar.
 * Non-blocking: sync failures are logged but never fail the appointment operation.
 *
 * Token acquisition + refresh + persist + deactivate-on-failure is handled
 * by `getCalendarTokens()` in tokenManagement.ts (same helper the sync
 * services use, single source of truth for the FOR UPDATE / refresh /
 * persist pattern). The action-specific work below uses a separate
 * connection — it doesn't need the row lock on tenant_calendar_settings.
 */
export async function syncAppointmentToCalendar(
  pool: Pool,
  tenantId: string,
  appointmentId: string,
  action: 'create' | 'update' | 'delete',
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || defaultSyncLogger;
  const prefix = ctx(tenantId, appointmentId, action);

  // 1. Token acquisition + refresh via shared helper.
  const tokens = await getCalendarTokens(
    pool,
    tenantId,
    { google: gcal.refreshAccessToken, outlook: outlook.refreshAccessToken },
    log
  );
  if (!tokens) {
    // Helper logs the specific reason (no row, inactive, missing tokens,
    // unsupported provider, refresh failure). Nothing more to do here.
    return;
  }

  const { accessToken, refreshToken, calendarId, provider: providerKey } = tokens;
  const { module: provider, name: providerName } = pickProviderModule(providerKey);

  // 2. Run the action-specific work on a fresh connection — none of these
  //    queries need the FOR UPDATE lock on tenant_calendar_settings.
  const client = await pool.connect();
  try {
    if (action === 'create') {
      // Fetch appointment details
      const apptRes = await client.query(
        `SELECT a.*, c.name as customer_name, c.phone as customer_phone,
                r.name as resource_name, s.name as service_name
         FROM appointments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN resources r ON r.resource_id = a.resource_id
         LEFT JOIN services s ON s.service_id = (
           SELECT sm.service_id FROM service_resource_mapping sm WHERE sm.resource_id = a.resource_id LIMIT 1
         )
         WHERE a.id = $1 AND a.tenant_id = $2`,
        [appointmentId, tenantId]
      );

      const appt = apptRes.rows[0];
      if (!appt) {
        log.warn(`${prefix} — skipped: appointment not found in DB (WHY: may have been deleted between mutation and sync)`);
        return;
      }

      const event = buildCalendarEvent(appt);
      const eventId = await provider.createEvent(accessToken, refreshToken, calendarId, event);

      await client.query(
        `INSERT INTO appointment_sync_map (appointment_id, external_event_id, provider, last_synced_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (appointment_id) DO UPDATE SET external_event_id = $2, provider = $3, last_synced_at = NOW()`,
        [appointmentId, eventId, providerKey]
      );
      log.info(`${prefix} — event created in ${providerName} Calendar (WHERE: calendarId=${calendarId} eventId=${eventId} customer=${appt.customer_name || 'unknown'})`);

    } else if (action === 'update') {
      // Get existing sync mapping
      const syncRes = await client.query(
        `SELECT external_event_id FROM appointment_sync_map WHERE appointment_id = $1`,
        [appointmentId]
      );
      if (syncRes.rows.length === 0) {
        // No sync entry — fall back to create (WHY: appointment was created before calendar was connected)
        log.info(`${prefix} — no sync map entry found, falling back to create`);
        return syncAppointmentToCalendar(pool, tenantId, appointmentId, 'create', logger);
      }

      const externalEventId = syncRes.rows[0].external_event_id;

      const apptRes = await client.query(
        `SELECT a.*, c.name as customer_name, c.phone as customer_phone, r.name as resource_name
         FROM appointments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN resources r ON r.resource_id = a.resource_id
         WHERE a.id = $1 AND a.tenant_id = $2`,
        [appointmentId, tenantId]
      );

      const appt = apptRes.rows[0];
      if (!appt) {
        log.warn(`${prefix} — skipped: appointment not found in DB`);
        return;
      }

      const event = buildCalendarEvent(appt);
      await provider.updateEvent(accessToken, refreshToken, calendarId, externalEventId, event);

      await client.query(
        `UPDATE appointment_sync_map SET last_synced_at = NOW() WHERE appointment_id = $1`,
        [appointmentId]
      );
      log.info(`${prefix} — event updated in ${providerName} Calendar (WHERE: calendarId=${calendarId} eventId=${externalEventId})`);

    } else if (action === 'delete') {
      const syncRes = await client.query(
        `SELECT external_event_id FROM appointment_sync_map WHERE appointment_id = $1`,
        [appointmentId]
      );
      if (syncRes.rows.length === 0) {
        log.info(`${prefix} — skipped: no sync map entry (WHY: appointment was never synced to ${providerName} Calendar)`);
        return;
      }

      const externalEventId = syncRes.rows[0].external_event_id;

      try {
        await provider.deleteEvent(accessToken, refreshToken, calendarId, externalEventId);
      } catch (err) {
        // Event may already be deleted — that's fine
        log.warn(`${prefix} — ${providerName} deleteEvent failed (WHY: event may already be deleted in ${providerName} Calendar | eventId=${externalEventId} | ERROR: ${err})`);
      }

      await client.query(
        `DELETE FROM appointment_sync_map WHERE appointment_id = $1`,
        [appointmentId]
      );
      log.info(`${prefix} — event deleted from ${providerName} Calendar (WHERE: calendarId=${calendarId} eventId=${externalEventId})`);
    }
  } finally {
    client.release();
  }
}

function buildCalendarEvent(appt: Record<string, any>): gcal.CalendarEventInput {
  const customerName = appt.customer_name || 'Customer';
  const summary = appt.description
    ? `${appt.description} - ${customerName}`
    : `Appointment - ${customerName}`;

  const parts: string[] = [];
  if (appt.customer_name) parts.push(`Customer: ${appt.customer_name}`);
  if (appt.customer_phone) parts.push(`Phone: ${appt.customer_phone}`);
  if (appt.resource_name) parts.push(`Resource: ${appt.resource_name}`);
  if (appt.service_name) parts.push(`Service: ${appt.service_name}`);
  parts.push('Booked via Secretary HQ');

  return {
    summary,
    description: parts.join('\n'),
    start: appt.start_time,
    end: appt.end_time,
    location: appt.location || undefined,
  };
}
