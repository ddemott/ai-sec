import type { Pool } from 'pg';
import * as servicetitan from './servicetitanClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS, withSyncContext } from './tokenManagement';
import {
  syncMapUpsertOnCreate,
  syncMapUpdateAfterPush,
  syncMapDeleteByLocalId,
  syncMapMarkDeleted,
  syncMapFindByLocalId,
  syncMapFindByExternalId,
  syncMapUpsertOnPull,
  syncMapUpdateAfterPull,
  ensureRemoteCustomer,
  pullRemoteCustomer,
  isAlreadySynced,
  isRemoteNewer,
  updateLastSyncAt,
} from './syncMapHelpers';
import { paginateSync } from './syncPaginate';

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
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
      await syncMapDeleteByLocalId(client, tenantId, 'servicetitan', 'customer', customerId);
      log.info(`${prefix} — sync map entry removed`);
      return;
    }

    // Read sync_map BEFORE customers — lock order
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'servicetitan', 'customer', customerId);

    const custRes = await client.query(
      `SELECT customer_id, name, phone, email, address, updated_at FROM customers WHERE customer_id = $1 AND tenant_id = $2`,
      [customerId, tenantId]
    );
    const cust = custRes.rows[0];
    if (!cust) {
      log.warn(`${prefix} — skipped: customer not found in DB`);
      return;
    }

    // The ServiceTitan createCustomer/updateCustomer signatures accept the
    // same shape; using the strict type here lets TS catch a typo'd
    // field name at compile time instead of a 4xx response from
    // ServiceTitan at runtime.
    const customerPayload: { name: string; email?: string; phoneNumber?: string } = {
      name: cust.name || 'Customer',
    };
    if (cust.phone) customerPayload.phoneNumber = cust.phone;
    if (cust.email) customerPayload.email = cust.email;

    if (!syncEntry || action === 'create') {
      // Create in ServiceTitan
      const created = await servicetitan.createCustomer(
        tokens.accessToken, tokens.appKey, tokens.tenantSid, customerPayload
      );

      await syncMapUpsertOnCreate(
        client, tenantId, 'servicetitan', 'customer', customerId, String(created.id),
        cust.updated_at, created.modifiedOn || new Date().toISOString()
      );
      log.info(`${prefix} — customer pushed to ServiceTitan (servicetitanId=${created.id} name=${cust.name})`);
    } else {
      // Update in ServiceTitan
      const externalId = syncEntry.external_id;
      await servicetitan.updateCustomer(
        tokens.accessToken, tokens.appKey, tokens.tenantSid, externalId, customerPayload
      );

      await syncMapUpdateAfterPush(client, tenantId, 'servicetitan', 'customer', customerId, cust.updated_at);
      log.info(`${prefix} — customer updated in ServiceTitan (servicetitanId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to ServiceTitan as a job */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
      const syncEntry = await syncMapFindByLocalId(client, tenantId, 'servicetitan', 'appointment', appointmentId);

      if (syncEntry) {
        try {
          await servicetitan.cancelJob(tokens.accessToken, tokens.appKey, tokens.tenantSid, syncEntry.external_id);
        } catch (err) {
          log.warn(`${prefix} — failed to cancel job in ServiceTitan (jobId=${syncEntry.external_id} | ERROR: ${err})`);
        }
        await syncMapMarkDeleted(client, tenantId, 'servicetitan', 'appointment', appointmentId, 'canceled');
      }
      log.info(`${prefix} — sync map entry updated (canceled)`);
      return;
    }

    // Read sync_map BEFORE appointments — lock order
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'servicetitan', 'appointment', appointmentId);

    const apptRes = await client.query(
      `SELECT a.*, c.name as customer_name, c.phone as customer_phone, r.name as resource_name
       FROM appointments a
       LEFT JOIN customers c ON c.customer_id = a.customer_id
       LEFT JOIN resources r ON r.resource_id = a.resource_id
       WHERE a.appointment_id = $1 AND a.tenant_id = $2`,
      [appointmentId, tenantId]
    );
    const appt = apptRes.rows[0];
    if (!appt) {
      log.warn(`${prefix} — skipped: appointment not found in DB`);
      return;
    }

    // Ensure customer is synced to ServiceTitan first
    const servicetitanCustomerIdStr = await ensureRemoteCustomer(
      client, pool, tenantId, 'servicetitan', appt.customer_id, syncCustomerToServiceTitan, logger, prefix
    );
    const servicetitanCustomerId = servicetitanCustomerIdStr ? Number(servicetitanCustomerIdStr) : null;

    const summary = appt.description
      ? `${appt.description} - ${appt.customer_name || 'Customer'}`
      : `Appointment - ${appt.customer_name || 'Customer'}`;

    // Same compile-time-safety reasoning as customerPayload above. The
    // createJob signature requires `customerId: number` (no optional);
    // we use a union so we can build the partial payload first then
    // narrow before the createJob call.
    const jobPayload: { summary: string; scheduledDate: string; customerId?: number } = {
      summary,
      scheduledDate: new Date(appt.start_time).toISOString(),
    };
    if (servicetitanCustomerId) jobPayload.customerId = servicetitanCustomerId;

    if (!syncEntry || action === 'create') {
      if (!jobPayload.customerId) {
        log.warn(`${prefix} — skipped: cannot create ServiceTitan job without customerId`);
        return;
      }
      const job = await servicetitan.createJob(
        tokens.accessToken, tokens.appKey, tokens.tenantSid,
        // Narrowed: customerId is now confirmed defined; TS can see it.
        { customerId: jobPayload.customerId, summary: jobPayload.summary, scheduledDate: jobPayload.scheduledDate }
      );

      await syncMapUpsertOnCreate(
        client, tenantId, 'servicetitan', 'appointment', appointmentId, String(job.id),
        appt.updated_at || new Date().toISOString()
      );
      log.info(`${prefix} — appointment pushed to ServiceTitan as job (servicetitanId=${job.id} customer=${appt.customer_name})`);
    } else {
      const externalId = syncEntry.external_id;
      // updateJob's signature is { summary?, scheduledDate?, status? } — same
      // strict shape catches typo'd fields at compile time.
      const updatePayload: { summary?: string; scheduledDate?: string; status?: string } = {
        summary: jobPayload.summary,
        scheduledDate: jobPayload.scheduledDate,
      };
      if (appt.status === 'canceled') updatePayload.status = 'Canceled';

      await servicetitan.updateJob(
        tokens.accessToken, tokens.appKey, tokens.tenantSid, externalId, updatePayload
      );

      await syncMapUpdateAfterPush(client, tenantId, 'servicetitan', 'appointment', appointmentId, appt.updated_at);
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
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
export async function pullServiceTitanCustomer(
  pool: Pool,
  tenantId: string,
  customerData: servicetitan.ServiceTitanCustomer,
  logger?: SyncLogger
): Promise<void> {
  const prefix = ctx(tenantId, 'customer', 'pull');
  const name = customerData.name || 'Customer';
  const phone = customerData.phoneNumber || '';
  const email = customerData.email || null;

  await pullRemoteCustomer({
    pool,
    tenantId,
    provider: 'servicetitan',
    changeSource: 'servicetitan',
    externalId: String(customerData.id),
    remoteUpdatedAt: customerData.modifiedOn || new Date().toISOString(),
    fields: { name, phone, email },
    updateSetClause: 'name = COALESCE($1, name), email = COALESCE($2, email)',
    updateValues: [name, email],
    logger,
    prefix,
  });
}

/** Pull a ServiceTitan job into the local appointments table */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
    await withSyncContext(client, 'servicetitan', 'sync-servicetitan', async () => {
      const stId = String(jobData.id);
      const remoteUpdatedAt = jobData.modifiedOn || new Date().toISOString();

      // Lookup the local customer for this job's customerId
      let localCustomerId: string | null = null;
      if (jobData.customerId) {
        const custSync = await syncMapFindByExternalId(client, tenantId, 'servicetitan', 'customer', String(jobData.customerId));
        localCustomerId = custSync?.local_id || null;
      }

      const syncEntry = await syncMapFindByExternalId(client, tenantId, 'servicetitan', 'appointment', stId);

      if (!syncEntry) {
        if (!localCustomerId) {
          log.warn(`${prefix} — skipped: ServiceTitan job ${stId} has no mapped local customer`);
          return;
        }

        const startTime = jobData.scheduledDate ? new Date(jobData.scheduledDate).toISOString() : new Date().toISOString();
        const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(); // default 1hr

        const insertRes = await client.query(
          `INSERT INTO appointments (tenant_id, customer_id, start_time, end_time, description, status)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING appointment_id`,
          [tenantId, localCustomerId, startTime, endTime, jobData.summary || 'ServiceTitan Job', jobData.status === 'Canceled' ? 'canceled' : 'scheduled']
        );
        const localId = insertRes.rows[0].appointment_id;

        await syncMapUpsertOnPull(client, tenantId, 'servicetitan', 'appointment', localId, stId, remoteUpdatedAt);
        log.info(`${prefix} — created local appointment from ServiceTitan job (servicetitanId=${stId} localId=${localId})`);
      } else {
        const { local_id: localId, remote_updated_at: lastRemoteUpdate } = syncEntry;

        if (isAlreadySynced(remoteUpdatedAt, lastRemoteUpdate)) {
          log.info(`${prefix} — skipped: already synced this version (servicetitanId=${stId})`);
          return;
        }

        await client.query(
          `UPDATE appointments SET description = COALESCE($1, description), status = $2
           WHERE appointment_id = $3 AND tenant_id = $4`,
          [jobData.summary, jobData.status === 'Canceled' ? 'canceled' : 'scheduled', localId, tenantId]
        );

        await syncMapUpdateAfterPull(client, tenantId, 'servicetitan', 'appointment', stId, remoteUpdatedAt);
        log.info(`${prefix} — updated local appointment from ServiceTitan job (servicetitanId=${stId} localId=${localId})`);
      }
    });
  } finally {
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

  const contextLabel = `[servicetitan-sync] tenant=${tenantId}`;

  const customerResult = await paginateSync<servicetitan.ServiceTitanCustomer, number>({
    initialCursor: 1,
    fetchPage: async (page) => {
      const result = await servicetitan.listCustomers(tokens.accessToken, tokens.appKey, tokens.tenantSid, page);
      return {
        items: result.data,
        nextCursor: result.hasMore ? page + 1 : null,
      };
    },
    processItem: (customer) => pullServiceTitanCustomer(pool, tenantId, customer, logger),
    itemContext: (customer) => String(customer.id),
    contextLabel,
    entityType: 'customer',
    logger: log,
  });

  const jobResult = await paginateSync<servicetitan.ServiceTitanJob, number>({
    initialCursor: 1,
    fetchPage: async (page) => {
      const result = await servicetitan.listJobs(tokens.accessToken, tokens.appKey, tokens.tenantSid, page);
      return {
        items: result.data,
        nextCursor: result.hasMore ? page + 1 : null,
      };
    },
    processItem: (job) => pullServiceTitanJob(pool, tenantId, job, logger),
    itemContext: (job) => String(job.id),
    contextLabel,
    entityType: 'job',
    logger: log,
  });

  const customersSynced = customerResult.count;
  const appointmentsSynced = jobResult.count;
  const errors = customerResult.errors + jobResult.errors;

  await updateLastSyncAt(pool, tenantId, 'servicetitan');
  log.info(`${contextLabel} — full sync complete (customers=${customersSynced} appointments=${appointmentsSynced} errors=${errors})`);
  return { customersSynced, appointmentsSynced, errors };
}
