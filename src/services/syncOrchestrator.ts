/**
 * Sync orchestrator: coordinates fire-and-forget sync across all providers.
 * Replaces scattered sync calls in routes with a single entry point.
 * Uses structured logging (req.log) instead of console.error.
 */

import type { Pool } from 'pg';
import { syncAppointmentToCalendar } from './calendarSync';
import { syncAppointmentToJobber, syncCustomerToJobber } from './jobberSync';
import { syncAppointmentToHubSpot, syncCustomerToHubSpot } from './hubspotSync';
import { syncAppointmentToSquare, syncCustomerToSquare } from './squareSync';
import { syncAppointmentToServiceTitan, syncCustomerToServiceTitan } from './servicetitanSync';

interface SyncLogger {
  error: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

function logSyncError(logger: SyncLogger | null, provider: string, entity: string, action: string, entityId: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (logger) {
    logger.error({ provider, entity, action, entityId, error: msg }, `Sync failed: ${provider} ${entity} ${action}`);
  }
}

/**
 * Sync an appointment to all connected providers (calendars + CRMs).
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function syncAppointmentToAll(
  pool: Pool,
  tenantId: string,
  appointmentId: string,
  action: 'create' | 'update' | 'delete',
  logger: SyncLogger | null = null
): void {
  const providers = [
    { name: 'calendar', fn: syncAppointmentToCalendar },
    { name: 'jobber', fn: syncAppointmentToJobber },
    { name: 'hubspot', fn: syncAppointmentToHubSpot },
    { name: 'square', fn: syncAppointmentToSquare },
    { name: 'servicetitan', fn: syncAppointmentToServiceTitan },
  ];

  for (const { name, fn } of providers) {
    fn(pool, tenantId, appointmentId, action).catch(e =>
      logSyncError(logger, name, 'appointment', action, appointmentId, e)
    );
  }
}

/**
 * Sync a customer to all connected CRM providers.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function syncCustomerToAll(
  pool: Pool,
  tenantId: string,
  customerId: string,
  action: 'create' | 'update' | 'delete',
  logger: SyncLogger | null = null
): void {
  const providers = [
    { name: 'jobber', fn: syncCustomerToJobber },
    { name: 'hubspot', fn: syncCustomerToHubSpot },
    { name: 'square', fn: syncCustomerToSquare },
    { name: 'servicetitan', fn: syncCustomerToServiceTitan },
  ];

  for (const { name, fn } of providers) {
    fn(pool, tenantId, customerId, action).catch(e =>
      logSyncError(logger, name, 'customer', action, customerId, e)
    );
  }
}
