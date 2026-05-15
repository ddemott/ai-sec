import type { Pool } from 'pg';
import * as jobber from './jobberClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS, withSyncContext } from './tokenManagement';
import { splitName, joinName } from './nameUtils';
import {
  syncMapUpsertOnCreate,
  syncMapUpdateAfterPush,
  syncMapDeleteByLocalId,
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
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
      await syncMapDeleteByLocalId(client, tenantId, 'jobber', 'customer', customerId);
      log.info(`${prefix} — sync map entry removed (Jobber client archived, not deleted)`);
      return;
    }

    // Check sync map for existing mapping (read sync_map BEFORE customers — lock order)
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'jobber', 'customer', customerId);

    // Fetch local customer
    const custRes = await client.query(
      `SELECT customer_id, name, phone, email, address, metadata, updated_at FROM customers WHERE customer_id = $1 AND tenant_id = $2`,
      [customerId, tenantId]
    );
    const cust = custRes.rows[0];
    if (!cust) {
      log.warn(`${prefix} — skipped: customer not found in DB`);
      return;
    }

    const nameParts = splitName(cust.name);
    const clientInput: Record<string, unknown> = {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      phones: cust.phone ? [{ number: cust.phone, primary: true }] : [],
      emails: cust.email ? [{ address: cust.email, primary: true }] : [],
    };
    if (cust.address) {
      clientInput.billingAddress = { street1: cust.address };
    }

    if (!syncEntry || action === 'create') {
      // Create in Jobber
      const result = await jobber.graphql(tokens.accessToken, jobber.QUERIES.createClient, { input: clientInput });
      const jobberClient = result.data?.clientCreate?.client;
      if (!jobberClient?.id) {
        const errors = result.data?.clientCreate?.userErrors;
        log.error(`${prefix} — Jobber clientCreate failed (WHO: tenant=${tenantId} customer=${customerId} | WHAT: GraphQL mutation returned errors | WHY: ${JSON.stringify(errors)} | HOW: check field validation)`);
        return;
      }

      await syncMapUpsertOnCreate(
        client, tenantId, 'jobber', 'customer', customerId, jobberClient.id,
        cust.updated_at, jobberClient.updatedAt || new Date().toISOString()
      );
      log.info(`${prefix} — customer pushed to Jobber (jobberId=${jobberClient.id} name=${cust.name})`);
    } else {
      // Update in Jobber
      const externalId = syncEntry.external_id;
      const result = await jobber.graphql(tokens.accessToken, jobber.QUERIES.updateClient, {
        clientId: externalId,
        input: clientInput,
      });
      const errors = result.data?.clientUpdate?.userErrors;
      if (errors && errors.length > 0) {
        log.error(`${prefix} — Jobber clientUpdate failed (jobberId=${externalId} | errors=${JSON.stringify(errors)})`);
        return;
      }

      await syncMapUpdateAfterPush(client, tenantId, 'jobber', 'customer', customerId, cust.updated_at);
      log.info(`${prefix} — customer updated in Jobber (jobberId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to Jobber as a Job+Visit */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
      await syncMapDeleteByLocalId(client, tenantId, 'jobber', 'appointment', appointmentId);
      log.info(`${prefix} — sync map entry removed`);
      return;
    }

    // Check if already synced (read sync_map BEFORE appointments — lock order)
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'jobber', 'appointment', appointmentId);

    // Fetch appointment with customer details
    const apptRes = await client.query(
      `SELECT a.*, c.name as customer_name, c.phone as customer_phone,
              r.name as resource_name
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

    // Ensure Jobber client exists for customer
    const jobberClientId = await ensureRemoteCustomer(
      client, pool, tenantId, 'jobber', appt.customer_id, syncCustomerToJobber, logger, prefix
    );
    if (!jobberClientId) return;

    if (!syncEntry || action === 'create') {
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
      await syncMapUpsertOnCreate(
        client, tenantId, 'jobber', 'appointment', appointmentId, visitId,
        appt.updated_at || new Date().toISOString()
      );
      log.info(`${prefix} — appointment pushed to Jobber as job (jobId=${job.id} visitId=${visitId} customer=${appt.customer_name})`);
    } else {
      // Update not supported via simple visit update yet — log it
      log.info(`${prefix} — appointment update sync not yet implemented for Jobber (jobberId=${syncEntry.external_id})`);
    }
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// PULL: Jobber → Local
// -----------------------------------------------------------------------

/** Pull a Jobber client into the local customers table */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
export async function pullJobberClient(
  pool: Pool,
  tenantId: string,
  jobberClientData: jobber.JobberClient,
  logger?: SyncLogger
): Promise<void> {
  const prefix = ctx(tenantId, 'customer', 'pull');
  const name = joinName(jobberClientData.firstName, jobberClientData.lastName);
  const phone = jobberClientData.phones?.find(p => p.primary)?.number || jobberClientData.phones?.[0]?.number || '';
  const email = jobberClientData.emails?.find(e => e.primary)?.address || jobberClientData.emails?.[0]?.address || null;
  const address = jobberClientData.billingAddress
    ? [jobberClientData.billingAddress.street1, jobberClientData.billingAddress.city, jobberClientData.billingAddress.province].filter(Boolean).join(', ')
    : null;

  await pullRemoteCustomer({
    pool,
    tenantId,
    provider: 'jobber',
    changeSource: 'jobber',
    externalId: jobberClientData.id,
    remoteUpdatedAt: jobberClientData.updatedAt,
    fields: { name, phone, email, address },
    updateSetClause: 'name = COALESCE($1, name), email = COALESCE($2, email), address = COALESCE($3, address)',
    updateValues: [name, email, address],
    logger,
    prefix,
  });
}

/** Pull a Jobber visit into the local appointments table */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
    await withSyncContext(client, 'jobber', 'sync-jobber', async () => {
      const jobberId = visitData.id;
      const remoteUpdatedAt = visitData.updatedAt;

      // Find local customer from Jobber client ID
      const jobberClientId = visitData.job?.client?.id;
      if (!jobberClientId) {
        log.warn(`${prefix} — skipped: Jobber visit ${jobberId} has no associated client`);
        return;
      }

      const custSync = await syncMapFindByExternalId(client, tenantId, 'jobber', 'customer', jobberClientId);
      if (!custSync) {
        log.warn(`${prefix} — skipped: Jobber client ${jobberClientId} not yet synced locally (pull the client first)`);
        return;
      }
      const localCustomerId = custSync.local_id;

      // Get default resource for this tenant
      const resourceRes = await client.query(
        `SELECT resource_id FROM resources WHERE tenant_id = $1 AND (is_active = true OR is_active IS NULL) ORDER BY created_at LIMIT 1`,
        [tenantId]
      );
      if (resourceRes.rows.length === 0) {
        log.warn(`${prefix} — skipped: tenant ${tenantId} has no active resources (needed to create appointment)`);
        return;
      }
      const resourceId = resourceRes.rows[0].resource_id;

      // Check sync map
      const syncEntry = await syncMapFindByExternalId(client, tenantId, 'jobber', 'appointment', jobberId);
      const description = visitData.title || visitData.job?.title || 'Jobber Visit';

      if (!syncEntry) {
        // Create local appointment
        const insertRes = await client.query(
          `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
           RETURNING appointment_id`,
          [tenantId, resourceId, localCustomerId, visitData.startAt, visitData.endAt, description]
        );
        const localId = insertRes.rows[0].appointment_id;

        await syncMapUpsertOnPull(client, tenantId, 'jobber', 'appointment', localId, jobberId, remoteUpdatedAt);
        log.info(`${prefix} — created local appointment from Jobber visit (jobberId=${jobberId} localId=${localId} description=${description})`);
      } else {
        // Existing — timestamp merge
        const { local_id: localId, remote_updated_at: lastRemoteUpdate } = syncEntry;

        if (isAlreadySynced(remoteUpdatedAt, lastRemoteUpdate)) {
          log.info(`${prefix} — skipped: already synced this version (jobberId=${jobberId})`);
          return;
        }

        const localRes = await client.query(
          `SELECT updated_at FROM appointments WHERE appointment_id = $1 AND tenant_id = $2`,
          [localId, tenantId]
        );
        const localUpdatedAt = localRes.rows[0]?.updated_at;

        if (isRemoteNewer(remoteUpdatedAt, localUpdatedAt)) {
          await client.query(
            `UPDATE appointments SET start_time = $1, end_time = $2, description = COALESCE($3, description)
             WHERE appointment_id = $4 AND tenant_id = $5`,
            [visitData.startAt, visitData.endAt, description, localId, tenantId]
          );
          log.info(`${prefix} — updated local appointment from Jobber visit (jobberId=${jobberId} localId=${localId} — remote was newer)`);
        } else {
          log.info(`${prefix} — kept local values (jobberId=${jobberId} localId=${localId} — local was newer)`);
        }

        await syncMapUpdateAfterPull(client, tenantId, 'jobber', 'appointment', jobberId, remoteUpdatedAt);
      }
    });
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

  const contextLabel = `[jobber-sync] tenant=${tenantId}`;

  const clientResult = await paginateSync<jobber.JobberClient, string | null>({
    initialCursor: null,
    fetchPage: async (cursor) => {
      const result = await jobber.graphql<{ clients: { nodes: jobber.JobberClient[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }>(
        tokens.accessToken,
        jobber.QUERIES.listClients,
        { first: 100, after: cursor }
      );
      const clients = result.data?.clients;
      if (!clients) return { items: [], nextCursor: null };
      return {
        items: clients.nodes,
        nextCursor: clients.pageInfo.hasNextPage ? clients.pageInfo.endCursor : null,
      };
    },
    processItem: (jClient) => pullJobberClient(pool, tenantId, jClient, logger),
    itemContext: (jClient) => jClient.id,
    contextLabel,
    entityType: 'client',
    logger: log,
  });

  const visitResult = await paginateSync<jobber.JobberVisit, string | null>({
    initialCursor: null,
    fetchPage: async (cursor) => {
      const result = await jobber.graphql<{ visits: { nodes: jobber.JobberVisit[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }>(
        tokens.accessToken,
        jobber.QUERIES.listVisits,
        { first: 100, after: cursor }
      );
      const visits = result.data?.visits;
      if (!visits) return { items: [], nextCursor: null };
      return {
        items: visits.nodes,
        nextCursor: visits.pageInfo.hasNextPage ? visits.pageInfo.endCursor : null,
      };
    },
    processItem: (visit) => pullJobberVisit(pool, tenantId, visit, logger),
    itemContext: (visit) => visit.id,
    contextLabel,
    entityType: 'visit',
    logger: log,
  });

  const clientsSynced = clientResult.count;
  const visitsSynced = visitResult.count;
  const errors = clientResult.errors + visitResult.errors;

  await updateLastSyncAt(pool, tenantId, 'jobber');
  log.info(`${contextLabel} — full sync complete (clients=${clientsSynced} visits=${visitsSynced} errors=${errors})`);
  return { clientsSynced, visitsSynced, errors };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

