import type { Pool } from 'pg';
import type { SyncAction } from '../syncMapHelpers';

export type { SyncAction };

/** Common signature for per-provider customer/appointment push functions. */
export type CrmSyncFn = (
  pool: Pool,
  tenantId: string,
  entityId: string,
  action: SyncAction
) => Promise<void>;

/** Both push operations a CRM adapter must expose to the sync orchestrator. */
export interface CrmSyncAdapter {
  syncCustomer: CrmSyncFn;
  syncAppointment: CrmSyncFn;
}
