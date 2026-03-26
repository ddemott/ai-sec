import type { Pool } from 'pg';
import * as gcal from './googleCalendar';

/**
 * Sync an appointment to the tenant's connected external calendar.
 * Non-blocking: sync failures are logged but never fail the appointment operation.
 */
export async function syncAppointmentToCalendar(
  pool: Pool,
  tenantId: string,
  appointmentId: string,
  action: 'create' | 'update' | 'delete',
  logger?: { warn: (msg: string) => void; error: (msg: string) => void; info: (msg: string) => void }
): Promise<void> {
  const log = logger || { warn: console.warn, error: console.error, info: console.info };

  const client = await pool.connect();
  try {
    // 1. Get calendar settings (direct query, no RLS — backend service context)
    const settingsRes = await client.query(
      `SELECT provider, external_calendar_id, access_token, refresh_token, token_expires_at, is_active
       FROM tenant_calendar_settings WHERE tenant_id = $1`,
      [tenantId]
    );

    const settings = settingsRes.rows[0];
    if (!settings || !settings.is_active || settings.provider !== 'google') return;
    if (!settings.access_token || !settings.refresh_token) return;

    // 2. Refresh token if expired (5 minute buffer)
    let accessToken = settings.access_token;
    const expiresAt = settings.token_expires_at ? new Date(settings.token_expires_at).getTime() : 0;
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      try {
        const refreshed = await gcal.refreshAccessToken(settings.refresh_token);
        accessToken = refreshed.access_token;
        await client.query(
          `UPDATE tenant_calendar_settings SET access_token = $1, token_expires_at = $2, updated_at = NOW()
           WHERE tenant_id = $3`,
          [refreshed.access_token, new Date(refreshed.expiry_date).toISOString(), tenantId]
        );
        log.info(`Calendar token refreshed for tenant ${tenantId}`);
      } catch (err) {
        // Token refresh failed — mark as disconnected so user sees "Reconnect"
        await client.query(
          `UPDATE tenant_calendar_settings SET is_active = false, updated_at = NOW() WHERE tenant_id = $1`,
          [tenantId]
        );
        log.error(`Calendar token refresh failed for tenant ${tenantId}, marked inactive: ${err}`);
        return;
      }
    }

    const calendarId = settings.external_calendar_id;
    const refreshToken = settings.refresh_token;

    // 3. Execute the sync action
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
      if (!appt) return;

      const event = buildCalendarEvent(appt);
      const eventId = await gcal.createEvent(accessToken, refreshToken, calendarId, event);

      await client.query(
        `INSERT INTO appointment_sync_map (appointment_id, external_event_id, provider, last_synced_at)
         VALUES ($1, $2, 'google', NOW())
         ON CONFLICT (appointment_id) DO UPDATE SET external_event_id = $2, last_synced_at = NOW()`,
        [appointmentId, eventId]
      );
      log.info(`Calendar event created for appointment ${appointmentId}`);

    } else if (action === 'update') {
      // Get existing sync mapping
      const syncRes = await client.query(
        `SELECT external_event_id FROM appointment_sync_map WHERE appointment_id = $1`,
        [appointmentId]
      );
      if (syncRes.rows.length === 0) {
        // No sync entry — create instead
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
      if (!appt) return;

      const event = buildCalendarEvent(appt);
      await gcal.updateEvent(accessToken, refreshToken, calendarId, externalEventId, event);

      await client.query(
        `UPDATE appointment_sync_map SET last_synced_at = NOW() WHERE appointment_id = $1`,
        [appointmentId]
      );
      log.info(`Calendar event updated for appointment ${appointmentId}`);

    } else if (action === 'delete') {
      const syncRes = await client.query(
        `SELECT external_event_id FROM appointment_sync_map WHERE appointment_id = $1`,
        [appointmentId]
      );
      if (syncRes.rows.length === 0) return;

      const externalEventId = syncRes.rows[0].external_event_id;

      try {
        await gcal.deleteEvent(accessToken, refreshToken, calendarId, externalEventId);
      } catch {
        // Event may already be deleted in Google — that's fine
      }

      await client.query(
        `DELETE FROM appointment_sync_map WHERE appointment_id = $1`,
        [appointmentId]
      );
      log.info(`Calendar event deleted for appointment ${appointmentId}`);
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
