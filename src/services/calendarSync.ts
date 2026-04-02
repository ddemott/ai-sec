import type { Pool } from 'pg';
import * as gcal from './googleCalendar';
import * as outlook from './outlookCalendar';
import { type SyncLogger, defaultSyncLogger, TOKEN_BUFFER_MS } from './tokenManagement';

type CalendarProvider = typeof gcal | typeof outlook;

/** Build a structured log prefix: WHO (tenant) + WHAT (action) + WHERE (appointment) */
function ctx(tenantId: string, appointmentId: string, action: string) {
  return `[calendar-sync] tenant=${tenantId} appointment=${appointmentId} action=${action}`;
}

/**
 * Sync an appointment to the tenant's connected external calendar.
 * Non-blocking: sync failures are logged but never fail the appointment operation.
 *
 * Note: calendarSync keeps its own single-client pattern because it uses
 * tenant_calendar_settings (not tenant_integration_settings) and the sync
 * action queries share the same DB client as the token refresh.
 * The SyncLogger type and TOKEN_BUFFER_MS constant are shared via tokenManagement.ts.
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

  const client = await pool.connect();
  try {
    // 1. Get calendar settings (direct query, no RLS — backend service context)
    // FOR UPDATE locks the row to prevent concurrent token refresh races
    const settingsRes = await client.query(
      `SELECT provider, external_calendar_id, access_token, refresh_token, token_expires_at, is_active
       FROM tenant_calendar_settings WHERE tenant_id = $1
       FOR UPDATE`,
      [tenantId]
    );

    const settings = settingsRes.rows[0];
    if (!settings) return; // WHO: tenant has no calendar connected — silent no-op
    if (!settings.is_active) {
      log.warn(`${prefix} — skipped: calendar marked inactive (WHY: previous token refresh failed, user needs to reconnect)`);
      return;
    }
    if (settings.provider !== 'google' && settings.provider !== 'outlook') {
      log.warn(`${prefix} — skipped: provider="${settings.provider}" not supported (HOW: only Google and Outlook Calendar are implemented)`);
      return;
    }
    if (!settings.access_token || !settings.refresh_token) {
      log.warn(`${prefix} — skipped: missing tokens (WHY: OAuth flow was interrupted or tokens were revoked)`);
      return;
    }

    // 2. Select the provider module
    const provider: CalendarProvider = settings.provider === 'outlook' ? outlook : gcal;
    const providerName = settings.provider === 'outlook' ? 'Outlook' : 'Google';

    // 3. Refresh token if expired (uses shared buffer constant)
    let accessToken = settings.access_token;
    const expiresAt = settings.token_expires_at ? new Date(settings.token_expires_at).getTime() : 0;
    if (Date.now() > expiresAt - TOKEN_BUFFER_MS.STANDARD) {
      try {
        const refreshed = await provider.refreshAccessToken(settings.refresh_token);
        accessToken = refreshed.access_token;
        await client.query(
          `UPDATE tenant_calendar_settings SET access_token = $1, token_expires_at = $2, updated_at = NOW()
           WHERE tenant_id = $3`,
          [refreshed.access_token, new Date(refreshed.expiry_date).toISOString(), tenantId]
        );
        log.info(`${prefix} — token refreshed (WHY: access_token expired or within 5min buffer)`);
      } catch (err) {
        // Token refresh failed — mark as disconnected so user sees "Reconnect"
        await client.query(
          `UPDATE tenant_calendar_settings SET is_active = false, updated_at = NOW() WHERE tenant_id = $1`,
          [tenantId]
        );
        log.error(`${prefix} — token refresh FAILED, calendar marked inactive (WHO: tenant=${tenantId} | WHAT: refreshAccessToken rejected | WHY: ${providerName} OAuth grant likely revoked by user | HOW: is_active set to false, user will see "Reconnect" in dashboard | ERROR: ${err})`);
        return;
      }
    }

    const calendarId = settings.external_calendar_id;
    const refreshToken = settings.refresh_token;

    // 4. Execute the sync action
    if (action === 'create') {
      // Fetch appointment details
      const apptRes = await client.query(
        `SELECT a.*, c.name as customer_name, c.phone as customer_phone,
                r.name as resource_name, s.name as service_name
         FROM appointments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN resources r ON r.id = a.resource_id
         LEFT JOIN services s ON s.id = (
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
        [appointmentId, eventId, settings.provider]
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
         LEFT JOIN resources r ON r.id = a.resource_id
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
