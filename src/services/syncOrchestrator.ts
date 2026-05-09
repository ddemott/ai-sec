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

// ─────────────────────────────────────────────────────────────────────
// Test-only dispatch recorder
// ─────────────────────────────────────────────────────────────────────
// The orchestrator is fire-and-forget so a black-box e2e test can't
// observe whether each provider was actually invoked. When
// SYNC_TEST_RECORDER=1 is set at boot, every dispatch appends a
// SyncEvent to an in-memory ring buffer; an /agent-tools/_test/
// sync-events route then exposes it for assertion. The recorder is a
// no-op outside test mode, so prod code paths are unaffected.
export type SyncEvent = {
  ts: string;
  provider: string;
  entity: 'appointment' | 'customer';
  action: 'create' | 'update' | 'delete';
  tenantId: string;
  entityId: string;
};

const recorder: SyncEvent[] = [];
const RECORDER_MAX = 500;

function recordingEnabled(): boolean {
  return process.env.SYNC_TEST_RECORDER === '1';
}

function record(provider: string, entity: 'appointment' | 'customer', action: 'create' | 'update' | 'delete', tenantId: string, entityId: string) {
  if (!recordingEnabled()) return;
  recorder.push({ ts: new Date().toISOString(), provider, entity, action, tenantId, entityId });
  if (recorder.length > RECORDER_MAX) recorder.splice(0, recorder.length - RECORDER_MAX);
}

export function getSyncRecorder(): readonly SyncEvent[] {
  return recorder;
}

export function clearSyncRecorder(): void {
  recorder.length = 0;
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
    record(name, 'appointment', action, tenantId, appointmentId);
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
    record(name, 'customer', action, tenantId, customerId);
    fn(pool, tenantId, customerId, action).catch(e =>
      logSyncError(logger, name, 'customer', action, customerId, e)
    );
  }
}
