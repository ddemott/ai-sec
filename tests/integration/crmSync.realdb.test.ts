/**
 * Real-DB companion for getCrmSyncStatus + disconnectCrmIntegration.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): these two service functions run static
 * SQL over tenant_integration_settings + entity_sync_map (a status SELECT with
 * a GROUP BY fold, and two DELETEs). The mocked suite proves the fold logic on
 * fake rows; it can't prove the columns exist or that disconnect actually
 * removes the rows. This suite runs them against real Postgres via a
 * tenant-scoped client.
 *
 * 5W for sad-path failures:
 *   WHO  — an owner viewing / disconnecting their Square integration
 *   WHAT — getCrmSyncStatus (status fold) / disconnectCrmIntegration (2 DELETEs)
 *   WHEN — CRM settings page load / "Disconnect" click
 *   WHERE — crmSyncStatus.ts / crmDisconnect.ts SQL over integration tables
 *   WHY  — a wrong column 500s the settings page; a disconnect that leaves
 *          entity_sync_map rows keeps syncing after the owner unplugged it
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, type PoolClient, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { getCrmSyncStatus } from '../../src/services/crmSyncStatus';
import { disconnectCrmIntegration } from '../../src/services/crmDisconnect';

let setup: Client;
let pool: Pool;
let withTenantClient: <T>(id: string, fn: (c: PoolClient) => Promise<T>) => Promise<T>;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

async function seedIntegration(): Promise<void> {
  await setup.query(
    `INSERT INTO tenant_integration_settings (tenant_id, provider, is_active, last_sync_at)
     VALUES ($1, 'square', true, now())
     ON CONFLICT (tenant_id, provider) DO UPDATE SET last_sync_at = now()`,
    [tenantId]
  );
  // Two synced customers, one pending appointment, one errored appointment.
  const rows: Array<[string, string, string]> = [
    ['customer', 'synced', 'ext-c1'],
    ['customer', 'synced', 'ext-c2'],
    ['appointment', 'pending', 'ext-a1'],
    ['appointment', 'error', 'ext-a2'],
  ];
  for (const [entity, status, ext] of rows) {
    await setup.query(
      `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, sync_status, local_id, external_id)
       VALUES ($1, 'square', $2, $3, gen_random_uuid(), $4)`,
      [tenantId, entity, status, ext]
    );
  }
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    withTenantClient = createWithTenantClient(pool);
    tenantId = await createTenant(setup, 'CRM Sync Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    await seedIntegration();
    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[crmSync.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('getCrmSyncStatus → real DB', () => {
  it('HAPPY: folds entity_sync_map into pending/error counts + total_mapped, with last_sync_at', async () => {
    const status = await withTenantClient(tenantId, (client) =>
      getCrmSyncStatus(client, tenantId, 'square')
    );
    expect(status.last_sync_at).toBeTruthy();
    expect(status.pending_count).toBe(1);
    expect(status.error_count).toBe(1);
    expect(status.total_mapped.customers).toBe(2);
    expect(status.total_mapped.appointments).toBe(2);
  });
});

describe('disconnectCrmIntegration → real DB', () => {
  it('HAPPY: removes the settings row AND every entity_sync_map row for the provider', async () => {
    // WHY: a disconnect that leaves sync-map rows keeps the CRM linked in
    // effect — the owner clicked Disconnect but sync could resume.
    await withTenantClient(tenantId, (client) =>
      disconnectCrmIntegration(client, tenantId, 'square')
    );

    const settings = await setup.query(
      `SELECT 1 FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'square'`,
      [tenantId]
    );
    expect(settings.rows).toHaveLength(0);
    const maps = await setup.query(
      `SELECT 1 FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'square'`,
      [tenantId]
    );
    expect(maps.rows).toHaveLength(0);

    // And a status read after disconnect is the empty/zero shape (no 500).
    const status = await withTenantClient(tenantId, (client) =>
      getCrmSyncStatus(client, tenantId, 'square')
    );
    expect(status.last_sync_at).toBeNull();
    expect(status.pending_count).toBe(0);
    expect(status.total_mapped.customers).toBe(0);
  });
});
