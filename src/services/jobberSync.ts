import type { Pool } from 'pg';
import * as jobber from './jobberClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS } from './tokenManagement';

function ctx(tenantId: string, entityType: string, action: string) {
  return syncCtx('jobber', tenantId, entityType, action);
}

// -----------------------------------------------------------------------
// Token management (delegates to shared tokenManagement.ts)
// -----------------------------------------------------------------------

export async function getTokensWithRefresh(
  pool: Pool,
  tenantId: string,
  logger?: SyncLogger
): Promise<{ accessToken: string; refreshToken: string } | null> {
  return getIntegrationTokens(pool, tenantId, 'jobber', jobber.refreshAccessToken, TOKEN_BUFFER_MS.STANDARD, logger);
}

// -----------------------------------------------------------------------
// PUSH: Local → Jobber
// -----------------------------------------------------------------------

/** Push a local customer to Jobber (create or update) */
export async function syncCustomerToJobber(
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
      // Remove sync map entry — Jobber doesn't support hard delete via API
      await client.query(
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'customer' AND local_id = $2`,
        [tenantId, customerId]
      );
      log.info(`${prefix} — sync map entry removed (Jobber client archived, not deleted)`);
      return;
    }

    // Fetch local customer
    const custRes = await client.query(
      `SELECT id, name, phone, email, address, metadata, updated_at FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId]
    );
    const cust = custRes.rows[0];
    if (!cust) {
      log.warn(`${prefix} — skipped: customer not found in DB`);
      return;
    }

    // Check sync map for existing mapping
    const syncRes = await client.query(
      `SELECT external_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, customerId]
    );

    const nameParts = splitName(cust.name);
    const clientInput: Record<string, any> = {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      phones: cust.phone ? [{ number: cust.phone, primary: true }] : [],
      emails: cust.email ? [{ address: cust.email, primary: true }] : [],
    };
    if (cust.address) {
      clientInput.billingAddress = { street1: cust.address };
    }

    if (syncRes.rows.length === 0 || action === 'create') {
      // Create in Jobber
      const result = await jobber.graphql(tokens.accessToken, jobber.QUERIES.createClient, { input: clientInput });
      const jobberClient = result.data?.clientCreate?.client;
      if (!jobberClient?.id) {
        const errors = result.data?.clientCreate?.userErrors;
        log.error(`${prefix} — Jobber clientCreate failed (WHO: tenant=${tenantId} customer=${customerId} | WHAT: GraphQL mutation returned errors | WHY: ${JSON.stringify(errors)} | HOW: check field validation)`);
        return;
      }

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'jobber', 'customer', $2, $3, $4, $5, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, remote_updated_at = $5, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, customerId, jobberClient.id, cust.updated_at, jobberClient.updatedAt || new Date().toISOString()]
      );
      log.info(`${prefix} — customer pushed to Jobber (jobberId=${jobberClient.id} name=${cust.name})`);
    } else {
      // Update in Jobber
      const externalId = syncRes.rows[0].external_id;
      const result = await jobber.graphql(tokens.accessToken, jobber.QUERIES.updateClient, {
        clientId: externalId,
        input: clientInput,
      });
      const errors = result.data?.clientUpdate?.userErrors;
      if (errors && errors.length > 0) {
        log.error(`${prefix} — Jobber clientUpdate failed (jobberId=${externalId} | errors=${JSON.stringify(errors)})`);
        return;
      }

      await client.query(
        `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
         WHERE tenant_id = $2 AND provider = 'jobber' AND entity_type = 'customer' AND local_id = $3`,
        [cust.updated_at, tenantId, customerId]
      );
      log.info(`${prefix} — customer updated in Jobber (jobberId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to Jobber as a Job+Visit */
export async function syncAppointmentToJobber(
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
      await client.query(
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'appointment' AND local_id = $2`,
        [tenantId, appointmentId]
      );
      log.info(`${prefix} — sync map entry removed`);
      return;
    }

    // Fetch appointment with customer details
    const apptRes = await client.query(
      `SELECT a.*, c.name as customer_name, c.phone as customer_phone,
              r.name as resource_name
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

    // Find Jobber client ID for customer (needed to create a job)
    const custSyncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, appt.customer_id]
    );

    let jobberClientId = custSyncRes.rows[0]?.external_id;
    if (!jobberClientId) {
      // Customer not yet synced — push them first
      await syncCustomerToJobber(pool, tenantId, appt.customer_id, 'create', logger);
      const reSyncRes = await client.query(
        `SELECT external_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'customer' AND local_id = $2`,
        [tenantId, appt.customer_id]
      );
      jobberClientId = reSyncRes.rows[0]?.external_id;
      if (!jobberClientId) {
        log.error(`${prefix} — cannot push appointment: customer sync failed (customerId=${appt.customer_id})`);
        return;
      }
    }

    // Check if already synced
    const syncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'appointment' AND local_id = $2`,
      [tenantId, appointmentId]
    );

    if (syncRes.rows.length === 0 || action === 'create') {
      // Create Job+Visit in Jobber
      const title = appt.description || `Appointment - ${appt.customer_name || 'Customer'}`;
      const result = await jobber.graphql(tokens.accessToken, jobber.QUERIES.createJob, {
        input: {
          clientId: jobberClientId,
          title,
          startAt: appt.start_time,
          endAt: appt.end_time,
          visits: [{
            title,
            startAt: appt.start_time,
            endAt: appt.end_time,
          }],
        },
      });

      const job = result.data?.jobCreate?.job;
      if (!job?.id) {
        const errors = result.data?.jobCreate?.userErrors;
        log.error(`${prefix} — Jobber jobCreate failed (WHO: tenant=${tenantId} | WHAT: GraphQL mutation returned errors | WHY: ${JSON.stringify(errors)})`);
        return;
      }

      // Use the visit ID as the external ID (visits are what have schedule)
      const visitId = job.visits?.nodes?.[0]?.id || job.id;
      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'jobber', 'appointment', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, appointmentId, visitId, appt.updated_at || new Date().toISOString()]
      );
      log.info(`${prefix} — appointment pushed to Jobber as job (jobId=${job.id} visitId=${visitId} customer=${appt.customer_name})`);
    } else {
      // Update not supported via simple visit update yet — log it
      log.info(`${prefix} — appointment update sync not yet implemented for Jobber (jobberId=${syncRes.rows[0].external_id})`);
    }
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// PULL: Jobber → Local
// -----------------------------------------------------------------------

/** Pull a Jobber client into the local customers table */
export async function pullJobberClient(
  pool: Pool,
  tenantId: string,
  jobberClientData: jobber.JobberClient,
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'customer', 'pull');

  const client = await pool.connect();
  try {
    const jobberId = jobberClientData.id;
    const remoteUpdatedAt = jobberClientData.updatedAt;

    // Check sync map for existing mapping
    const syncRes = await client.query(
      `SELECT local_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'customer' AND external_id = $2`,
      [tenantId, jobberId]
    );

    const name = joinName(jobberClientData.firstName, jobberClientData.lastName);
    const phone = jobberClientData.phones?.find(p => p.primary)?.number || jobberClientData.phones?.[0]?.number || '';
    const email = jobberClientData.emails?.find(e => e.primary)?.address || jobberClientData.emails?.[0]?.address || null;
    const address = jobberClientData.billingAddress
      ? [jobberClientData.billingAddress.street1, jobberClientData.billingAddress.city, jobberClientData.billingAddress.province].filter(Boolean).join(', ')
      : null;

    if (!phone) {
      log.warn(`${prefix} — skipped: Jobber client ${jobberId} has no phone number (required field)`);
      return;
    }

    if (syncRes.rows.length === 0) {
      // New client from Jobber — check if customer with same phone exists
      const existingRes = await client.query(
        `SELECT id, updated_at FROM customers WHERE tenant_id = $1 AND phone = $2`,
        [tenantId, phone]
      );

      let localId: string;
      if (existingRes.rows.length > 0) {
        // Match by phone — merge
        localId = existingRes.rows[0].id;
        const localUpdatedAt = existingRes.rows[0].updated_at;

        if (new Date(remoteUpdatedAt) > new Date(localUpdatedAt)) {
          // Remote is newer — update local
          await client.query(
            `UPDATE customers SET name = COALESCE($1, name), email = COALESCE($2, email), address = COALESCE($3, address)
             WHERE id = $4 AND tenant_id = $5`,
            [name, email, address, localId, tenantId]
          );
          log.info(`${prefix} — merged Jobber client into existing customer (jobberId=${jobberId} localId=${localId} phone=${phone} — remote was newer)`);
        } else {
          log.info(`${prefix} — matched existing customer by phone (jobberId=${jobberId} localId=${localId} — local was newer, kept local values)`);
        }
      } else {
        // Brand new customer
        const insertRes = await client.query(
          `INSERT INTO customers (tenant_id, name, phone, email, address)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [tenantId, name, phone, email, address]
        );
        localId = insertRes.rows[0].id;
        log.info(`${prefix} — created local customer from Jobber client (jobberId=${jobberId} localId=${localId} name=${name})`);
      }

      // Create sync map entry
      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'jobber', 'customer', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, external_id) DO UPDATE SET
           local_id = $2, remote_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced'`,
        [tenantId, localId, jobberId, remoteUpdatedAt]
      );
    } else {
      // Existing mapping — timestamp-based merge
      const localId = syncRes.rows[0].local_id;
      const lastRemoteUpdate = syncRes.rows[0].remote_updated_at;

      // Skip if we've already processed this version
      if (lastRemoteUpdate && new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate)) {
        log.info(`${prefix} — skipped: already synced this version (jobberId=${jobberId} remoteUpdatedAt=${remoteUpdatedAt})`);
        return;
      }

      // Get local record to compare timestamps
      const localRes = await client.query(
        `SELECT updated_at FROM customers WHERE id = $1 AND tenant_id = $2`,
        [localId, tenantId]
      );
      const localUpdatedAt = localRes.rows[0]?.updated_at;

      if (new Date(remoteUpdatedAt) > new Date(localUpdatedAt)) {
        // Remote is newer — update local with non-null fields
        await client.query(
          `UPDATE customers SET name = COALESCE($1, name), email = COALESCE($2, email), address = COALESCE($3, address)
           WHERE id = $4 AND tenant_id = $5`,
          [name, email, address, localId, tenantId]
        );
        log.info(`${prefix} — updated local customer from Jobber (jobberId=${jobberId} localId=${localId} — remote was newer)`);
      } else {
        log.info(`${prefix} — kept local values (jobberId=${jobberId} localId=${localId} — local was newer)`);
      }

      // Update sync map
      await client.query(
        `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
         WHERE tenant_id = $2 AND provider = 'jobber' AND entity_type = 'customer' AND external_id = $3`,
        [remoteUpdatedAt, tenantId, jobberId]
      );
    }
  } finally {
    client.release();
  }
}

/** Pull a Jobber visit into the local appointments table */
export async function pullJobberVisit(
  pool: Pool,
  tenantId: string,
  visitData: jobber.JobberVisit,
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'appointment', 'pull');

  const client = await pool.connect();
  try {
    const jobberId = visitData.id;
    const remoteUpdatedAt = visitData.updatedAt;

    // Find local customer from Jobber client ID
    const jobberClientId = visitData.job?.client?.id;
    if (!jobberClientId) {
      log.warn(`${prefix} — skipped: Jobber visit ${jobberId} has no associated client`);
      return;
    }

    const custSyncRes = await client.query(
      `SELECT local_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'customer' AND external_id = $2`,
      [tenantId, jobberClientId]
    );
    if (custSyncRes.rows.length === 0) {
      log.warn(`${prefix} — skipped: Jobber client ${jobberClientId} not yet synced locally (pull the client first)`);
      return;
    }
    const localCustomerId = custSyncRes.rows[0].local_id;

    // Get default resource for this tenant
    const resourceRes = await client.query(
      `SELECT id FROM resources WHERE tenant_id = $1 AND (is_active = true OR is_active IS NULL) ORDER BY created_at LIMIT 1`,
      [tenantId]
    );
    if (resourceRes.rows.length === 0) {
      log.warn(`${prefix} — skipped: tenant ${tenantId} has no active resources (needed to create appointment)`);
      return;
    }
    const resourceId = resourceRes.rows[0].id;

    // Check sync map
    const syncRes = await client.query(
      `SELECT local_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'jobber' AND entity_type = 'appointment' AND external_id = $2`,
      [tenantId, jobberId]
    );

    const description = visitData.title || visitData.job?.title || 'Jobber Visit';

    if (syncRes.rows.length === 0) {
      // Create local appointment
      const insertRes = await client.query(
        `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
         RETURNING id`,
        [tenantId, resourceId, localCustomerId, visitData.startAt, visitData.endAt, description]
      );
      const localId = insertRes.rows[0].id;

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'jobber', 'appointment', $2, $3, $4, NOW(), 'synced')`,
        [tenantId, localId, jobberId, remoteUpdatedAt]
      );
      log.info(`${prefix} — created local appointment from Jobber visit (jobberId=${jobberId} localId=${localId} description=${description})`);
    } else {
      // Existing — timestamp merge
      const localId = syncRes.rows[0].local_id;
      const lastRemoteUpdate = syncRes.rows[0].remote_updated_at;

      if (lastRemoteUpdate && new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate)) {
        log.info(`${prefix} — skipped: already synced this version (jobberId=${jobberId})`);
        return;
      }

      const localRes = await client.query(
        `SELECT updated_at FROM appointments WHERE id = $1 AND tenant_id = $2`,
        [localId, tenantId]
      );
      const localUpdatedAt = localRes.rows[0]?.updated_at;

      if (new Date(remoteUpdatedAt) > new Date(localUpdatedAt)) {
        await client.query(
          `UPDATE appointments SET start_time = $1, end_time = $2, description = COALESCE($3, description)
           WHERE id = $4 AND tenant_id = $5`,
          [visitData.startAt, visitData.endAt, description, localId, tenantId]
        );
        log.info(`${prefix} — updated local appointment from Jobber visit (jobberId=${jobberId} localId=${localId} — remote was newer)`);
      } else {
        log.info(`${prefix} — kept local values (jobberId=${jobberId} localId=${localId} — local was newer)`);
      }

      await client.query(
        `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
         WHERE tenant_id = $2 AND provider = 'jobber' AND entity_type = 'appointment' AND external_id = $3`,
        [remoteUpdatedAt, tenantId, jobberId]
      );
    }
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// Full sync (periodic reconciliation)
// -----------------------------------------------------------------------

/** Paginate through all Jobber clients and sync to local */
export async function fullSync(
  pool: Pool,
  tenantId: string,
  logger?: SyncLogger
): Promise<{ clientsSynced: number; visitsSynced: number; errors: number }> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const tokens = await getTokensWithRefresh(pool, tenantId, logger);
  if (!tokens) return { clientsSynced: 0, visitsSynced: 0, errors: 0 };

  let clientsSynced = 0;
  let visitsSynced = 0;
  let errors = 0;

  // Sync clients
  let hasNextPage = true;
  let cursor: string | null = null;
  while (hasNextPage) {
    try {
      const result = await jobber.graphql<{ clients: { nodes: jobber.JobberClient[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }>(
        tokens.accessToken,
        jobber.QUERIES.listClients,
        { first: 100, after: cursor }
      );

      const clients = result.data?.clients;
      if (!clients) break;

      for (const jClient of clients.nodes) {
        try {
          await pullJobberClient(pool, tenantId, jClient, logger);
          clientsSynced++;
        } catch (err) {
          errors++;
          log.error(`[jobber-sync] tenant=${tenantId} — failed to pull client ${jClient.id}: ${err}`);
        }
      }

      hasNextPage = clients.pageInfo.hasNextPage;
      cursor = clients.pageInfo.endCursor;
    } catch (err) {
      log.error(`[jobber-sync] tenant=${tenantId} — client pagination failed: ${err}`);
      break;
    }
  }

  // Sync visits
  hasNextPage = true;
  cursor = null;
  while (hasNextPage) {
    try {
      const result = await jobber.graphql<{ visits: { nodes: jobber.JobberVisit[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }>(
        tokens.accessToken,
        jobber.QUERIES.listVisits,
        { first: 100, after: cursor }
      );

      const visits = result.data?.visits;
      if (!visits) break;

      for (const visit of visits.nodes) {
        try {
          await pullJobberVisit(pool, tenantId, visit, logger);
          visitsSynced++;
        } catch (err) {
          errors++;
          log.error(`[jobber-sync] tenant=${tenantId} — failed to pull visit ${visit.id}: ${err}`);
        }
      }

      hasNextPage = visits.pageInfo.hasNextPage;
      cursor = visits.pageInfo.endCursor;
    } catch (err) {
      log.error(`[jobber-sync] tenant=${tenantId} — visit pagination failed: ${err}`);
      break;
    }
  }

  // Update last_sync_at
  const syncClient = await pool.connect();
  try {
    await syncClient.query(
      `UPDATE tenant_integration_settings SET last_sync_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND provider = 'jobber'`,
      [tenantId]
    );
  } finally {
    syncClient.release();
  }

  log.info(`[jobber-sync] tenant=${tenantId} — full sync complete (clients=${clientsSynced} visits=${visitsSynced} errors=${errors})`);
  return { clientsSynced, visitsSynced, errors };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function splitName(name: string | null): { firstName: string; lastName: string } {
  if (!name) return { firstName: '', lastName: '' };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function joinName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Customer';
}
