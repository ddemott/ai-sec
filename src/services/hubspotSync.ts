import type { Pool } from 'pg';
import * as hubspot from './hubspotClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS, withSyncContext } from './tokenManagement';
import { splitName, joinName } from './nameUtils';
import {
  syncMapUpsertOnCreate,
  syncMapUpdateAfterPush,
  syncMapDeleteByLocalId,
  syncMapFindByLocalId,
  ensureRemoteCustomer,
  pullRemoteCustomer,
  updateLastSyncAt,
} from './syncMapHelpers';
import { paginateSync } from './syncPaginate';

function ctx(tenantId: string, entityType: string, action: string) {
  return syncCtx('hubspot', tenantId, entityType, action);
}

// -----------------------------------------------------------------------
// Token management (delegates to shared tokenManagement.ts)
// -----------------------------------------------------------------------

export async function getTokensWithRefresh(
  pool: Pool,
  tenantId: string,
  logger?: SyncLogger
): Promise<{ accessToken: string; refreshToken: string } | null> {
  return getIntegrationTokens(pool, tenantId, 'hubspot', hubspot.refreshAccessToken, TOKEN_BUFFER_MS.STANDARD, logger);
}

// -----------------------------------------------------------------------
// PUSH: Local → HubSpot
// -----------------------------------------------------------------------

/** Push a local customer to HubSpot as a contact */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
export async function syncCustomerToHubSpot(
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
      await syncMapDeleteByLocalId(client, tenantId, 'hubspot', 'customer', customerId);
      log.info(`${prefix} — sync map entry removed`);
      return;
    }

    // Read sync_map BEFORE customers — lock order
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'hubspot', 'customer', customerId);

    const custRes = await client.query(
      `SELECT id, name, phone, email, address, updated_at FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId]
    );
    const cust = custRes.rows[0];
    if (!cust) {
      log.warn(`${prefix} — skipped: customer not found in DB`);
      return;
    }

    const nameParts = splitName(cust.name);
    const properties: Record<string, string> = {
      firstname: nameParts.firstName,
      lastname: nameParts.lastName,
    };
    if (cust.phone) properties.phone = cust.phone;
    if (cust.email) properties.email = cust.email;

    if (!syncEntry || action === 'create') {
      // Create in HubSpot
      const contact = await hubspot.createContact(tokens.accessToken, properties);

      await syncMapUpsertOnCreate(
        client, tenantId, 'hubspot', 'customer', customerId, contact.id,
        cust.updated_at, contact.properties.lastmodifieddate || new Date().toISOString()
      );
      log.info(`${prefix} — customer pushed to HubSpot (hubspotId=${contact.id} name=${cust.name})`);
    } else {
      // Update in HubSpot
      const externalId = syncEntry.external_id;
      await hubspot.updateContact(tokens.accessToken, externalId, properties);

      await syncMapUpdateAfterPush(client, tenantId, 'hubspot', 'customer', customerId, cust.updated_at);
      log.info(`${prefix} — customer updated in HubSpot (hubspotId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to HubSpot as a meeting */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
export async function syncAppointmentToHubSpot(
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
      await syncMapDeleteByLocalId(client, tenantId, 'hubspot', 'appointment', appointmentId);
      log.info(`${prefix} — sync map entry removed`);
      return;
    }

    // Read sync_map BEFORE appointments — lock order
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'hubspot', 'appointment', appointmentId);

    const apptRes = await client.query(
      `SELECT a.*, c.name as customer_name, c.phone as customer_phone, r.name as resource_name
       FROM appointments a
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN resources r ON r.resource_id = a.resource_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [appointmentId, tenantId]
    );
    const appt = apptRes.rows[0];
    if (!appt) {
      log.warn(`${prefix} — skipped: appointment not found in DB`);
      return;
    }

    // Ensure customer is synced to HubSpot first
    const hubspotContactId = await ensureRemoteCustomer(
      client, pool, tenantId, 'hubspot', appt.customer_id, syncCustomerToHubSpot, logger, prefix
    );

    const title = appt.description
      ? `${appt.description} - ${appt.customer_name || 'Customer'}`
      : `Appointment - ${appt.customer_name || 'Customer'}`;

    const bodyParts: string[] = [];
    if (appt.customer_name) bodyParts.push(`Customer: ${appt.customer_name}`);
    if (appt.customer_phone) bodyParts.push(`Phone: ${appt.customer_phone}`);
    if (appt.resource_name) bodyParts.push(`Resource: ${appt.resource_name}`);
    bodyParts.push('Booked via Secretary HQ');

    const meetingProps: Record<string, string> = {
      hs_meeting_title: title,
      hs_meeting_body: bodyParts.join('\n'),
      hs_meeting_start_time: new Date(appt.start_time).toISOString(),
      hs_meeting_end_time: new Date(appt.end_time).toISOString(),
      hs_meeting_outcome: appt.status === 'canceled' ? 'CANCELED' : appt.status === 'completed' ? 'COMPLETED' : 'SCHEDULED',
      hs_timestamp: new Date(appt.start_time).toISOString(),
    };
    if (appt.location) meetingProps.hs_meeting_location = appt.location;

    if (!syncEntry || action === 'create') {
      const meeting = await hubspot.createMeeting(tokens.accessToken, meetingProps);

      // Associate meeting with contact
      if (hubspotContactId) {
        try {
          await hubspot.associateMeetingToContact(tokens.accessToken, meeting.id, hubspotContactId);
        } catch (err) {
          log.warn(`${prefix} — meeting created but association failed (meetingId=${meeting.id} contactId=${hubspotContactId} | ERROR: ${err})`);
        }
      }

      await syncMapUpsertOnCreate(
        client, tenantId, 'hubspot', 'appointment', appointmentId, meeting.id,
        appt.updated_at || new Date().toISOString()
      );
      log.info(`${prefix} — appointment pushed to HubSpot as meeting (hubspotId=${meeting.id} customer=${appt.customer_name})`);
    } else {
      const externalId = syncEntry.external_id;
      await hubspot.updateMeeting(tokens.accessToken, externalId, meetingProps);

      await syncMapUpdateAfterPush(client, tenantId, 'hubspot', 'appointment', appointmentId, appt.updated_at);
      log.info(`${prefix} — meeting updated in HubSpot (hubspotId=${externalId})`);
    }
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// PULL: HubSpot → Local
// -----------------------------------------------------------------------

/** Pull a HubSpot contact into the local customers table */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
export async function pullHubSpotContact(
  pool: Pool,
  tenantId: string,
  contactData: hubspot.HubSpotContact,
  logger?: SyncLogger
): Promise<void> {
  const prefix = ctx(tenantId, 'customer', 'pull');
  const props = contactData.properties;
  const name = joinName(props.firstname, props.lastname);
  const phone = props.phone || '';
  const email = props.email || null;

  await pullRemoteCustomer({
    pool,
    tenantId,
    provider: 'hubspot',
    changeSource: 'hubspot',
    externalId: contactData.id,
    remoteUpdatedAt: props.lastmodifieddate || new Date().toISOString(),
    fields: { name, phone, email },
    updateSetClause: 'name = COALESCE($1, name), email = COALESCE($2, email)',
    updateValues: [name, email],
    logger,
    prefix,
  });
}

// -----------------------------------------------------------------------
// Full sync
// -----------------------------------------------------------------------

export async function fullSync(
  pool: Pool,
  tenantId: string,
  logger?: SyncLogger
): Promise<{ contactsSynced: number; meetingsSynced: number; errors: number }> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const tokens = await getTokensWithRefresh(pool, tenantId, logger);
  if (!tokens) return { contactsSynced: 0, meetingsSynced: 0, errors: 0 };

  const contextLabel = `[hubspot-sync] tenant=${tenantId}`;
  const meetingsSynced = 0;

  const contactResult = await paginateSync<hubspot.HubSpotContact, string | undefined>({
    initialCursor: undefined,
    fetchPage: async (after) => {
      const result = await hubspot.listContacts(tokens.accessToken, after);
      return {
        items: result.results,
        nextCursor: result.paging?.next?.after ?? null,
      };
    },
    processItem: (contact) => pullHubSpotContact(pool, tenantId, contact, logger),
    itemContext: (contact) => contact.id,
    contextLabel,
    entityType: 'contact',
    logger: log,
  });

  const contactsSynced = contactResult.count;
  const errors = contactResult.errors;

  await updateLastSyncAt(pool, tenantId, 'hubspot');
  log.info(`${contextLabel} — full sync complete (contacts=${contactsSynced} meetings=${meetingsSynced} errors=${errors})`);
  return { contactsSynced, meetingsSynced, errors };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

