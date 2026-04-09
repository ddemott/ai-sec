import type { Pool } from 'pg';
import * as servicetitan from './servicetitanClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS, setSyncContext, clearSyncContext } from './tokenManagement';

function ctx(tenantId: string, entityType: string, action: string) {
  return syncCtx('servicetitan', tenantId, entityType, action);
}

// -----------------------------------------------------------------------
// Token management (delegates to shared tokenManagement.ts, with extra fields)
// -----------------------------------------------------------------------

export async function getTokensWithRefresh(
  pool: Pool,
  tenantId: string,
  logger?: SyncLogger
): Promise<{ accessToken: string; refreshToken: string; appKey: string; tenantSid: string } | null> {
  const log = logger || { warn: console.warn, error: console.error, info: console.info };

  const appKey = process.env.SERVICETITAN_APP_KEY;
  if (!appKey) {
    log.warn(`[servicetitan-sync] tenant=${tenantId} — skipped: SERVICETITAN_APP_KEY not set`);
    return null;
  }

  const result = await getIntegrationTokens(
    pool, tenantId, 'servicetitan', servicetitan.refreshAccessToken,
    TOKEN_BUFFER_MS.STANDARD, logger, 'settings'
  );
  if (!result) return null;

  const tenantSid = result.settings?.tenant_sid;
  if (!tenantSid) {
    log.warn(`[servicetitan-sync] tenant=${tenantId} — skipped: tenant_sid not found in settings`);
    return null;
  }

  return { accessToken: result.accessToken, refreshToken: result.refreshToken, appKey, tenantSid };
}

// -----------------------------------------------------------------------
// PUSH: Local → ServiceTitan
// -----------------------------------------------------------------------

/** Push a local customer to ServiceTitan */
export async function syncCustomerToServiceTitan(
  pool: Pool,
  tenantId: string,
  customerId: string,
  action: 'create' | 'update' | 'delete',
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'customer', action);

  const tokens = await getTokensWithRefresh(pool, tenantId, logger);
  if (!tokens) return;

  const client = await pool.connect();
  try {
    if (action === 'delete') {
      // ServiceTitan doesn't support customer delete — just remove sync map entry
      await client.query(
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'customer' AND local_id = $2`,
        [tenantId, customerId]
      );
      log.info(`${prefix} — sync map entry removed`);
      return;
    }

    const custRes = await client.query(
      `SELECT id, name, phone, email, address, updated_at FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId]
    );
    const cust = custRes.rows[0];
    if (!cust) {
      log.warn(`${prefix} — skipped: customer not found in DB`);
      return;
    }

    const syncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, customerId]
    );

    const customerPayload: Record<string, any> = {
      name: cust.name || 'Customer',
    };
    if (cust.phone) customerPayload.phoneNumber = cust.phone;
    if (cust.email) customerPayload.email = cust.email;

    if (syncRes.rows.length === 0 || action === 'create') {
      // Create in ServiceTitan
      const created = await servicetitan.createCustomer(
        tokens.accessToken, tokens.appKey, tokens.tenantSid, customerPayload as any
      );

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'servicetitan', 'customer', $2, $3, $4, $5, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, remote_updated_at = $5, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, customerId, String(created.id), cust.updated_at, created.modifiedOn || new Date().toISOString()]
      );
      log.info(`${prefix} — customer pushed to ServiceTitan (servicetitanId=${created.id} name=${cust.name})`);
    } else {
      // Update in ServiceTitan
      const externalId = syncRes.rows[0].external_id;
      await servicetitan.updateCustomer(
        tokens.accessToken, tokens.appKey, tokens.tenantSid, externalId, customerPayload
      );

      await client.query(
        `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
         WHERE tenant_id = $2 AND provider = 'servicetitan' AND entity_type = 'customer' AND local_id = $3`,
        [cust.updated_at, tenantId, customerId]
      );
      log.info(`${prefix} — customer updated in ServiceTitan (servicetitanId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to ServiceTitan as a job */
export async function syncAppointmentToServiceTitan(
  pool: Pool,
  tenantId: string,
  appointmentId: string,
  action: 'create' | 'update' | 'delete',
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'appointment', action);

  const tokens = await getTokensWithRefresh(pool, tenantId, logger);
  if (!tokens) return;

  const client = await pool.connect();
  try {
    if (action === 'delete') {
      // Cancel the job in ServiceTitan
      const syncRes = await client.query(
        `SELECT external_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'appointment' AND local_id = $2`,
        [tenantId, appointmentId]
      );

      if (syncRes.rows.length > 0) {
        const externalId = syncRes.rows[0].external_id;
        try {
          await servicetitan.cancelJob(tokens.accessToken, tokens.appKey, tokens.tenantSid, externalId);
        } catch (err) {
          log.warn(`${prefix} — failed to cancel job in ServiceTitan (jobId=${externalId} | ERROR: ${err})`);
        }
        await client.query(
          `UPDATE entity_sync_map SET sync_status = 'canceled', last_synced_at = NOW()
           WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'appointment' AND local_id = $2`,
          [tenantId, appointmentId]
        );
      }
      log.info(`${prefix} — sync map entry updated (canceled)`);
      return;
    }

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

    // Ensure customer is synced to ServiceTitan first
    let servicetitanCustomerId: number | null = null;
    const custSyncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, appt.customer_id]
    );
    servicetitanCustomerId = custSyncRes.rows[0]?.external_id ? Number(custSyncRes.rows[0].external_id) : null;

    if (!servicetitanCustomerId) {
      await syncCustomerToServiceTitan(pool, tenantId, appt.customer_id, 'create', logger);
      const reSyncRes = await client.query(
        `SELECT external_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'customer' AND local_id = $2`,
        [tenantId, appt.customer_id]
      );
      servicetitanCustomerId = reSyncRes.rows[0]?.external_id ? Number(reSyncRes.rows[0].external_id) : null;
    }

    const syncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'appointment' AND local_id = $2`,
      [tenantId, appointmentId]
    );

    const summary = appt.description
      ? `${appt.description} - ${appt.customer_name || 'Customer'}`
      : `Appointment - ${appt.customer_name || 'Customer'}`;

    const jobPayload: Record<string, any> = {
      summary,
      scheduledDate: new Date(appt.start_time).toISOString(),
    };
    if (servicetitanCustomerId) jobPayload.customerId = servicetitanCustomerId;

    if (syncRes.rows.length === 0 || action === 'create') {
      const job = await servicetitan.createJob(
        tokens.accessToken, tokens.appKey, tokens.tenantSid, jobPayload as any
      );

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'servicetitan', 'appointment', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, appointmentId, String(job.id), appt.updated_at || new Date().toISOString()]
      );
      log.info(`${prefix} — appointment pushed to ServiceTitan as job (servicetitanId=${job.id} customer=${appt.customer_name})`);
    } else {
      const externalId = syncRes.rows[0].external_id;
      const updatePayload: Record<string, any> = { ...jobPayload };
      if (appt.status === 'canceled') updatePayload.status = 'Canceled';

      await servicetitan.updateJob(
        tokens.accessToken, tokens.appKey, tokens.tenantSid, externalId, updatePayload
      );

      await client.query(
        `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
         WHERE tenant_id = $2 AND provider = 'servicetitan' AND entity_type = 'appointment' AND local_id = $3`,
        [appt.updated_at, tenantId, appointmentId]
      );
      log.info(`${prefix} — job updated in ServiceTitan (servicetitanId=${externalId})`);
    }
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// PULL: ServiceTitan → Local
// -----------------------------------------------------------------------

/** Pull a ServiceTitan customer into the local customers table */
export async function pullServiceTitanCustomer(
  pool: Pool,
  tenantId: string,
  customerData: servicetitan.ServiceTitanCustomer,
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'customer', 'pull');

  const client = await pool.connect();
  try {
    // Set version tracking context so changes are recorded as coming from ServiceTitan
    await setSyncContext(client, 'servicetitan', 'sync-servicetitan');

    const stId = String(customerData.id);
    const remoteUpdatedAt = customerData.modifiedOn || new Date().toISOString();

    const name = customerData.name || 'Customer';
    const phone = customerData.phoneNumber || '';
    const email = customerData.email || null;

    if (!phone) {
      log.warn(`${prefix} — skipped: ServiceTitan customer ${stId} has no phone number (required field)`);
      return;
    }

    const syncRes = await client.query(
      `SELECT local_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'customer' AND external_id = $2`,
      [tenantId, stId]
    );

    if (syncRes.rows.length === 0) {
      // Check if customer with same phone exists
      const existingRes = await client.query(
        `SELECT id, updated_at FROM customers WHERE tenant_id = $1 AND phone = $2`,
        [tenantId, phone]
      );

      let localId: string;
      if (existingRes.rows.length > 0) {
        localId = existingRes.rows[0].id;
        const localUpdatedAt = existingRes.rows[0].updated_at;

        if (new Date(remoteUpdatedAt) > new Date(localUpdatedAt)) {
          await client.query(
            `UPDATE customers SET name = COALESCE($1, name), email = COALESCE($2, email)
             WHERE id = $3 AND tenant_id = $4`,
            [name, email, localId, tenantId]
          );
          log.info(`${prefix} — merged ServiceTitan customer into existing customer (servicetitanId=${stId} localId=${localId} — remote was newer)`);
        } else {
          log.info(`${prefix} — matched existing customer by phone (servicetitanId=${stId} localId=${localId} — local was newer)`);
        }
      } else {
        const insertRes = await client.query(
          `INSERT INTO customers (tenant_id, name, phone, email) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, name, phone, email]
        );
        localId = insertRes.rows[0].id;
        log.info(`${prefix} — created local customer from ServiceTitan customer (servicetitanId=${stId} localId=${localId} name=${name})`);
      }

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'servicetitan', 'customer', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, external_id) DO UPDATE SET
           local_id = $2, remote_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced'`,
        [tenantId, localId, stId, remoteUpdatedAt]
      );
    } else {
      const localId = syncRes.rows[0].local_id;
      const lastRemoteUpdate = syncRes.rows[0].remote_updated_at;

      if (lastRemoteUpdate && new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate)) {
        log.info(`${prefix} — skipped: already synced this version (servicetitanId=${stId})`);
        return;
      }

      const localRes = await client.query(
        `SELECT updated_at FROM customers WHERE id = $1 AND tenant_id = $2`,
        [localId, tenantId]
      );
      const localUpdatedAt = localRes.rows[0]?.updated_at;

      if (new Date(remoteUpdatedAt) > new Date(localUpdatedAt)) {
        await client.query(
          `UPDATE customers SET name = COALESCE($1, name), email = COALESCE($2, email)
           WHERE id = $3 AND tenant_id = $4`,
          [name, email, localId, tenantId]
        );
        log.info(`${prefix} — updated local customer from ServiceTitan (servicetitanId=${stId} localId=${localId} — remote was newer)`);
      } else {
        log.info(`${prefix} — kept local values (servicetitanId=${stId} localId=${localId} — local was newer)`);
      }

      await client.query(
        `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
         WHERE tenant_id = $2 AND provider = 'servicetitan' AND entity_type = 'customer' AND external_id = $3`,
        [remoteUpdatedAt, tenantId, stId]
      );
    }
  } finally {
    await clearSyncContext(client);
    client.release();
  }
}

/** Pull a ServiceTitan job into the local appointments table */
export async function pullServiceTitanJob(
  pool: Pool,
  tenantId: string,
  jobData: servicetitan.ServiceTitanJob,
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'appointment', 'pull');

  const client = await pool.connect();
  try {
    // Set version tracking context so changes are recorded as coming from ServiceTitan
    await setSyncContext(client, 'servicetitan', 'sync-servicetitan');

    const stId = String(jobData.id);
    const remoteUpdatedAt = jobData.modifiedOn || new Date().toISOString();

    // Lookup the local customer for this job's customerId
    let localCustomerId: string | null = null;
    if (jobData.customerId) {
      const custSyncRes = await client.query(
        `SELECT local_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'customer' AND external_id = $2`,
        [tenantId, String(jobData.customerId)]
      );
      localCustomerId = custSyncRes.rows[0]?.local_id || null;
    }

    const syncRes = await client.query(
      `SELECT local_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'servicetitan' AND entity_type = 'appointment' AND external_id = $2`,
      [tenantId, stId]
    );

    if (syncRes.rows.length === 0) {
      if (!localCustomerId) {
        log.warn(`${prefix} — skipped: ServiceTitan job ${stId} has no mapped local customer`);
        return;
      }

      const startTime = jobData.scheduledDate ? new Date(jobData.scheduledDate).toISOString() : new Date().toISOString();
      const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(); // default 1hr

      const insertRes = await client.query(
        `INSERT INTO appointments (tenant_id, customer_id, start_time, end_time, description, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, localCustomerId, startTime, endTime, jobData.summary || 'ServiceTitan Job', jobData.status === 'Canceled' ? 'canceled' : 'scheduled']
      );
      const localId = insertRes.rows[0].id;

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'servicetitan', 'appointment', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, external_id) DO UPDATE SET
           local_id = $2, remote_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced'`,
        [tenantId, localId, stId, remoteUpdatedAt]
      );
      log.info(`${prefix} — created local appointment from ServiceTitan job (servicetitanId=${stId} localId=${localId})`);
    } else {
      const localId = syncRes.rows[0].local_id;
      const lastRemoteUpdate = syncRes.rows[0].remote_updated_at;

      if (lastRemoteUpdate && new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate)) {
        log.info(`${prefix} — skipped: already synced this version (servicetitanId=${stId})`);
        return;
      }

      await client.query(
        `UPDATE appointments SET description = COALESCE($1, description), status = $2
         WHERE id = $3 AND tenant_id = $4`,
        [jobData.summary, jobData.status === 'Canceled' ? 'canceled' : 'scheduled', localId, tenantId]
      );

      await client.query(
        `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
         WHERE tenant_id = $2 AND provider = 'servicetitan' AND entity_type = 'appointment' AND external_id = $3`,
        [remoteUpdatedAt, tenantId, stId]
      );
      log.info(`${prefix} — updated local appointment from ServiceTitan job (servicetitanId=${stId} localId=${localId})`);
    }
  } finally {
    await clearSyncContext(client);
    client.release();
  }
}

// -----------------------------------------------------------------------
// Full sync
// -----------------------------------------------------------------------

export async function fullSync(
  pool: Pool,
  tenantId: string,
  logger?: SyncLogger
): Promise<{ customersSynced: number; appointmentsSynced: number; errors: number }> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const tokens = await getTokensWithRefresh(pool, tenantId, logger);
  if (!tokens) return { customersSynced: 0, appointmentsSynced: 0, errors: 0 };

  let customersSynced = 0;
  let appointmentsSynced = 0;
  let errors = 0;

  // Sync customers
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    try {
      const result = await servicetitan.listCustomers(tokens.accessToken, tokens.appKey, tokens.tenantSid, page);
      for (const customer of result.data) {
        try {
          await pullServiceTitanCustomer(pool, tenantId, customer, logger);
          customersSynced++;
        } catch (err) {
          errors++;
          log.error(`[servicetitan-sync] tenant=${tenantId} — failed to pull customer ${customer.id}: ${err}`);
        }
      }
      hasMore = result.hasMore;
      page++;
    } catch (err) {
      log.error(`[servicetitan-sync] tenant=${tenantId} — customer pagination failed: ${err}`);
      break;
    }
  }

  // Sync jobs
  page = 1;
  hasMore = true;
  while (hasMore) {
    try {
      const result = await servicetitan.listJobs(tokens.accessToken, tokens.appKey, tokens.tenantSid, page);
      for (const job of result.data) {
        try {
          await pullServiceTitanJob(pool, tenantId, job, logger);
          appointmentsSynced++;
        } catch (err) {
          errors++;
          log.error(`[servicetitan-sync] tenant=${tenantId} — failed to pull job ${job.id}: ${err}`);
        }
      }
      hasMore = result.hasMore;
      page++;
    } catch (err) {
      log.error(`[servicetitan-sync] tenant=${tenantId} — job pagination failed: ${err}`);
      break;
    }
  }

  // Update last_sync_at
  const syncClient = await pool.connect();
  try {
    await syncClient.query(
      `UPDATE tenant_integration_settings SET last_sync_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND provider = 'servicetitan'`,
      [tenantId]
    );
  } finally {
    syncClient.release();
  }

  log.info(`[servicetitan-sync] tenant=${tenantId} — full sync complete (customers=${customersSynced} appointments=${appointmentsSynced} errors=${errors})`);
  return { customersSynced, appointmentsSynced, errors };
}
