import type { Pool } from 'pg';
import * as hubspot from './hubspotClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS, setSyncContext, clearSyncContext } from './tokenManagement';
import { splitName, joinName } from './nameUtils';

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
      await client.query(
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'hubspot' AND entity_type = 'customer' AND local_id = $2`,
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
       WHERE tenant_id = $1 AND provider = 'hubspot' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, customerId]
    );

    const nameParts = splitName(cust.name);
    const properties: Record<string, string> = {
      firstname: nameParts.firstName,
      lastname: nameParts.lastName,
    };
    if (cust.phone) properties.phone = cust.phone;
    if (cust.email) properties.email = cust.email;

    if (syncRes.rows.length === 0 || action === 'create') {
      // Create in HubSpot
      const contact = await hubspot.createContact(tokens.accessToken, properties);

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'hubspot', 'customer', $2, $3, $4, $5, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, remote_updated_at = $5, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, customerId, contact.id, cust.updated_at, contact.properties.lastmodifieddate || new Date().toISOString()]
      );
      log.info(`${prefix} — customer pushed to HubSpot (hubspotId=${contact.id} name=${cust.name})`);
    } else {
      // Update in HubSpot
      const externalId = syncRes.rows[0].external_id;
      await hubspot.updateContact(tokens.accessToken, externalId, properties);

      await client.query(
        `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
         WHERE tenant_id = $2 AND provider = 'hubspot' AND entity_type = 'customer' AND local_id = $3`,
        [cust.updated_at, tenantId, customerId]
      );
      log.info(`${prefix} — customer updated in HubSpot (hubspotId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to HubSpot as a meeting */
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
      await client.query(
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'hubspot' AND entity_type = 'appointment' AND local_id = $2`,
        [tenantId, appointmentId]
      );
      log.info(`${prefix} — sync map entry removed`);
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

    // Ensure customer is synced to HubSpot first
    let hubspotContactId: string | null = null;
    const custSyncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'hubspot' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, appt.customer_id]
    );
    hubspotContactId = custSyncRes.rows[0]?.external_id || null;

    if (!hubspotContactId) {
      await syncCustomerToHubSpot(pool, tenantId, appt.customer_id, 'create', logger);
      const reSyncRes = await client.query(
        `SELECT external_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'hubspot' AND entity_type = 'customer' AND local_id = $2`,
        [tenantId, appt.customer_id]
      );
      hubspotContactId = reSyncRes.rows[0]?.external_id || null;
    }

    const syncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'hubspot' AND entity_type = 'appointment' AND local_id = $2`,
      [tenantId, appointmentId]
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

    if (syncRes.rows.length === 0 || action === 'create') {
      const meeting = await hubspot.createMeeting(tokens.accessToken, meetingProps);

      // Associate meeting with contact
      if (hubspotContactId) {
        try {
          await hubspot.associateMeetingToContact(tokens.accessToken, meeting.id, hubspotContactId);
        } catch (err) {
          log.warn(`${prefix} — meeting created but association failed (meetingId=${meeting.id} contactId=${hubspotContactId} | ERROR: ${err})`);
        }
      }

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'hubspot', 'appointment', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, appointmentId, meeting.id, appt.updated_at || new Date().toISOString()]
      );
      log.info(`${prefix} — appointment pushed to HubSpot as meeting (hubspotId=${meeting.id} customer=${appt.customer_name})`);
    } else {
      const externalId = syncRes.rows[0].external_id;
      await hubspot.updateMeeting(tokens.accessToken, externalId, meetingProps);

      await client.query(
        `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
         WHERE tenant_id = $2 AND provider = 'hubspot' AND entity_type = 'appointment' AND local_id = $3`,
        [appt.updated_at, tenantId, appointmentId]
      );
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
export async function pullHubSpotContact(
  pool: Pool,
  tenantId: string,
  contactData: hubspot.HubSpotContact,
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'customer', 'pull');

  const client = await pool.connect();
  try {
    // Set version tracking context so changes are recorded as coming from HubSpot
    await setSyncContext(client, 'hubspot', 'sync-hubspot');

    const hubspotId = contactData.id;
    const props = contactData.properties;
    const remoteUpdatedAt = props.lastmodifieddate || new Date().toISOString();

    const name = joinName(props.firstname, props.lastname);
    const phone = props.phone || '';
    const email = props.email || null;

    if (!phone) {
      log.warn(`${prefix} — skipped: HubSpot contact ${hubspotId} has no phone number (required field)`);
      return;
    }

    const syncRes = await client.query(
      `SELECT local_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'hubspot' AND entity_type = 'customer' AND external_id = $2`,
      [tenantId, hubspotId]
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
          log.info(`${prefix} — merged HubSpot contact into existing customer (hubspotId=${hubspotId} localId=${localId} — remote was newer)`);
        } else {
          log.info(`${prefix} — matched existing customer by phone (hubspotId=${hubspotId} localId=${localId} — local was newer)`);
        }
      } else {
        const insertRes = await client.query(
          `INSERT INTO customers (tenant_id, name, phone, email) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, name, phone, email]
        );
        localId = insertRes.rows[0].id;
        log.info(`${prefix} — created local customer from HubSpot contact (hubspotId=${hubspotId} localId=${localId} name=${name})`);
      }

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'hubspot', 'customer', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, external_id) DO UPDATE SET
           local_id = $2, remote_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced'`,
        [tenantId, localId, hubspotId, remoteUpdatedAt]
      );
    } else {
      const localId = syncRes.rows[0].local_id;
      const lastRemoteUpdate = syncRes.rows[0].remote_updated_at;

      if (lastRemoteUpdate && new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate)) {
        log.info(`${prefix} — skipped: already synced this version (hubspotId=${hubspotId})`);
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
        log.info(`${prefix} — updated local customer from HubSpot (hubspotId=${hubspotId} localId=${localId} — remote was newer)`);
      } else {
        log.info(`${prefix} — kept local values (hubspotId=${hubspotId} localId=${localId} — local was newer)`);
      }

      await client.query(
        `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
         WHERE tenant_id = $2 AND provider = 'hubspot' AND entity_type = 'customer' AND external_id = $3`,
        [remoteUpdatedAt, tenantId, hubspotId]
      );
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
): Promise<{ contactsSynced: number; meetingsSynced: number; errors: number }> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const tokens = await getTokensWithRefresh(pool, tenantId, logger);
  if (!tokens) return { contactsSynced: 0, meetingsSynced: 0, errors: 0 };

  let contactsSynced = 0;
  let meetingsSynced = 0;
  let errors = 0;

  // Sync contacts
  let after: string | undefined;
  let hasMore = true;
  while (hasMore) {
    try {
      const result = await hubspot.listContacts(tokens.accessToken, after);
      for (const contact of result.results) {
        try {
          await pullHubSpotContact(pool, tenantId, contact, logger);
          contactsSynced++;
        } catch (err) {
          errors++;
          log.error(`[hubspot-sync] tenant=${tenantId} — failed to pull contact ${contact.id}: ${err}`);
        }
      }
      after = result.paging?.next?.after;
      hasMore = !!after;
    } catch (err) {
      log.error(`[hubspot-sync] tenant=${tenantId} — contact pagination failed: ${err}`);
      break;
    }
  }

  // Update last_sync_at
  const syncClient = await pool.connect();
  try {
    await syncClient.query(
      `UPDATE tenant_integration_settings SET last_sync_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND provider = 'hubspot'`,
      [tenantId]
    );
  } finally {
    syncClient.release();
  }

  log.info(`[hubspot-sync] tenant=${tenantId} — full sync complete (contacts=${contactsSynced} meetings=${meetingsSynced} errors=${errors})`);
  return { contactsSynced, meetingsSynced, errors };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

