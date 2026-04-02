import type { Pool } from 'pg';
import * as square from './squareClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS } from './tokenManagement';

function ctx(tenantId: string, entityType: string, action: string) {
  return syncCtx('square', tenantId, entityType, action);
}

// -----------------------------------------------------------------------
// Token management (delegates to shared tokenManagement.ts)
// -----------------------------------------------------------------------

export async function getTokensWithRefresh(
  pool: Pool,
  tenantId: string,
  logger?: SyncLogger
): Promise<{ accessToken: string; refreshToken: string } | null> {
  // Square tokens expire in ~30 days — use 24h buffer instead of standard 5min
  return getIntegrationTokens(pool, tenantId, 'square', square.refreshAccessToken, TOKEN_BUFFER_MS.SQUARE, logger);
}

// -----------------------------------------------------------------------
// PUSH: Local → Square
// -----------------------------------------------------------------------

/** Push a local customer to Square */
export async function syncCustomerToSquare(
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
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'customer' AND local_id = $2`,
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
       WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, customerId]
    );

    const nameParts = splitName(cust.name);
    const customerData: Record<string, string> = {
      given_name: nameParts.firstName,
      family_name: nameParts.lastName,
    };
    if (cust.phone) customerData.phone_number = cust.phone;
    if (cust.email) customerData.email_address = cust.email;

    if (syncRes.rows.length === 0 || action === 'create') {
      // Create in Square
      const result = await square.createCustomer(tokens.accessToken, customerData);
      const squareCustomer = result.customer;

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'square', 'customer', $2, $3, $4, $5, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, remote_updated_at = $5, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, customerId, squareCustomer.id, cust.updated_at, squareCustomer.updated_at || new Date().toISOString()]
      );
      log.info(`${prefix} — customer pushed to Square (squareId=${squareCustomer.id} name=${cust.name})`);
    } else {
      // Update in Square
      const externalId = syncRes.rows[0].external_id;
      await square.updateCustomer(tokens.accessToken, externalId, customerData);

      await client.query(
        `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
         WHERE tenant_id = $2 AND provider = 'square' AND entity_type = 'customer' AND local_id = $3`,
        [cust.updated_at, tenantId, customerId]
      );
      log.info(`${prefix} — customer updated in Square (squareId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to Square as a booking */
export async function syncAppointmentToSquare(
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
      const syncRes = await client.query(
        `SELECT external_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'appointment' AND local_id = $2`,
        [tenantId, appointmentId]
      );

      if (syncRes.rows.length > 0) {
        const externalId = syncRes.rows[0].external_id;
        try {
          await square.cancelBooking(tokens.accessToken, externalId);
        } catch (err) {
          log.warn(`${prefix} — failed to cancel Square booking (squareId=${externalId} | ERROR: ${err})`);
        }

        await client.query(
          `UPDATE entity_sync_map SET sync_status = 'deleted', last_synced_at = NOW()
           WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'appointment' AND local_id = $2`,
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

    // Ensure customer is synced to Square first
    let squareCustomerId: string | null = null;
    const custSyncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'customer' AND local_id = $2`,
      [tenantId, appt.customer_id]
    );
    squareCustomerId = custSyncRes.rows[0]?.external_id || null;

    if (!squareCustomerId) {
      await syncCustomerToSquare(pool, tenantId, appt.customer_id, 'create', logger);
      const reSyncRes = await client.query(
        `SELECT external_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'customer' AND local_id = $2`,
        [tenantId, appt.customer_id]
      );
      squareCustomerId = reSyncRes.rows[0]?.external_id || null;
    }

    const syncRes = await client.query(
      `SELECT external_id FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'appointment' AND local_id = $2`,
      [tenantId, appointmentId]
    );

    // Calculate duration in minutes
    const startTime = new Date(appt.start_time);
    const endTime = new Date(appt.end_time);
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    const bookingData: any = {
      start_at: startTime.toISOString(),
      appointment_segments: [{ duration_minutes: durationMinutes }],
    };
    if (squareCustomerId) bookingData.customer_id = squareCustomerId;

    if (syncRes.rows.length === 0 || action === 'create') {
      const result = await square.createBooking(tokens.accessToken, bookingData);
      const squareBooking = result.booking;

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, local_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'square', 'appointment', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
           external_id = $3, local_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`,
        [tenantId, appointmentId, squareBooking.id, appt.updated_at || new Date().toISOString()]
      );
      log.info(`${prefix} — appointment pushed to Square as booking (squareId=${squareBooking.id} customer=${appt.customer_name})`);
    } else {
      const externalId = syncRes.rows[0].external_id;
      await square.updateBooking(tokens.accessToken, externalId, bookingData);

      await client.query(
        `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
         WHERE tenant_id = $2 AND provider = 'square' AND entity_type = 'appointment' AND local_id = $3`,
        [appt.updated_at, tenantId, appointmentId]
      );
      log.info(`${prefix} — booking updated in Square (squareId=${externalId})`);
    }
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// PULL: Square → Local
// -----------------------------------------------------------------------

/** Pull a Square customer into the local customers table */
export async function pullSquareCustomer(
  pool: Pool,
  tenantId: string,
  customerData: square.SquareCustomer,
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'customer', 'pull');

  const client = await pool.connect();
  try {
    const squareId = customerData.id;
    const remoteUpdatedAt = customerData.updated_at || new Date().toISOString();

    const name = joinName(customerData.given_name, customerData.family_name);
    const phone = customerData.phone_number || '';
    const email = customerData.email_address || null;

    if (!phone) {
      log.warn(`${prefix} — skipped: Square customer ${squareId} has no phone number (required field)`);
      return;
    }

    const syncRes = await client.query(
      `SELECT local_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'customer' AND external_id = $2`,
      [tenantId, squareId]
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
          log.info(`${prefix} — merged Square customer into existing customer (squareId=${squareId} localId=${localId} — remote was newer)`);
        } else {
          log.info(`${prefix} — matched existing customer by phone (squareId=${squareId} localId=${localId} — local was newer)`);
        }
      } else {
        const insertRes = await client.query(
          `INSERT INTO customers (tenant_id, name, phone, email) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, name, phone, email]
        );
        localId = insertRes.rows[0].id;
        log.info(`${prefix} — created local customer from Square customer (squareId=${squareId} localId=${localId} name=${name})`);
      }

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'square', 'customer', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, external_id) DO UPDATE SET
           local_id = $2, remote_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced'`,
        [tenantId, localId, squareId, remoteUpdatedAt]
      );
    } else {
      const localId = syncRes.rows[0].local_id;
      const lastRemoteUpdate = syncRes.rows[0].remote_updated_at;

      if (lastRemoteUpdate && new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate)) {
        log.info(`${prefix} — skipped: already synced this version (squareId=${squareId})`);
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
        log.info(`${prefix} — updated local customer from Square (squareId=${squareId} localId=${localId} — remote was newer)`);
      } else {
        log.info(`${prefix} — kept local values (squareId=${squareId} localId=${localId} — local was newer)`);
      }

      await client.query(
        `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
         WHERE tenant_id = $2 AND provider = 'square' AND entity_type = 'customer' AND external_id = $3`,
        [remoteUpdatedAt, tenantId, squareId]
      );
    }
  } finally {
    client.release();
  }
}

/** Pull a Square booking into the local appointments table */
export async function pullSquareBooking(
  pool: Pool,
  tenantId: string,
  bookingData: square.SquareBooking,
  logger?: SyncLogger
): Promise<void> {
  const log: SyncLogger = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = ctx(tenantId, 'appointment', 'pull');

  const client = await pool.connect();
  try {
    const squareId = bookingData.id;
    const remoteUpdatedAt = bookingData.updated_at || new Date().toISOString();

    if (!bookingData.start_at) {
      log.warn(`${prefix} — skipped: Square booking ${squareId} has no start_at`);
      return;
    }

    // Look up local customer via sync map if booking has customer_id
    let localCustomerId: string | null = null;
    if (bookingData.customer_id) {
      const custSyncRes = await client.query(
        `SELECT local_id FROM entity_sync_map
         WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'customer' AND external_id = $2`,
        [tenantId, bookingData.customer_id]
      );
      localCustomerId = custSyncRes.rows[0]?.local_id || null;
    }

    const syncRes = await client.query(
      `SELECT local_id, remote_updated_at FROM entity_sync_map
       WHERE tenant_id = $1 AND provider = 'square' AND entity_type = 'appointment' AND external_id = $2`,
      [tenantId, squareId]
    );

    const startTime = new Date(bookingData.start_at);
    const durationMinutes = bookingData.appointment_segments?.[0]?.duration_minutes || 60;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    const status = bookingData.status === 'CANCELLED_BY_CUSTOMER' || bookingData.status === 'CANCELLED_BY_SELLER'
      ? 'canceled'
      : 'scheduled';

    if (syncRes.rows.length === 0) {
      const insertRes = await client.query(
        `INSERT INTO appointments (tenant_id, customer_id, start_time, end_time, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, localCustomerId, startTime.toISOString(), endTime.toISOString(), status]
      );
      const localId = insertRes.rows[0].id;

      await client.query(
        `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
         VALUES ($1, 'square', 'appointment', $2, $3, $4, NOW(), 'synced')
         ON CONFLICT (tenant_id, provider, entity_type, external_id) DO UPDATE SET
           local_id = $2, remote_updated_at = $4, last_synced_at = NOW(), sync_status = 'synced'`,
        [tenantId, localId, squareId, remoteUpdatedAt]
      );

      log.info(`${prefix} — created local appointment from Square booking (squareId=${squareId} localId=${localId})`);
    } else {
      const localId = syncRes.rows[0].local_id;
      const lastRemoteUpdate = syncRes.rows[0].remote_updated_at;

      if (lastRemoteUpdate && new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate)) {
        log.info(`${prefix} — skipped: already synced this version (squareId=${squareId})`);
        return;
      }

      await client.query(
        `UPDATE appointments SET start_time = $1, end_time = $2, status = $3, customer_id = COALESCE($4, customer_id)
         WHERE id = $5 AND tenant_id = $6`,
        [startTime.toISOString(), endTime.toISOString(), status, localCustomerId, localId, tenantId]
      );

      await client.query(
        `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
         WHERE tenant_id = $2 AND provider = 'square' AND entity_type = 'appointment' AND external_id = $3`,
        [remoteUpdatedAt, tenantId, squareId]
      );

      log.info(`${prefix} — updated local appointment from Square (squareId=${squareId} localId=${localId})`);
    }
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

  let customersSynced = 0;
  let appointmentsSynced = 0;
  let errors = 0;

  // Sync customers
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    try {
      const result = await square.listCustomers(tokens.accessToken, cursor);
      const customers = result.customers || [];
      for (const customer of customers) {
        try {
          await pullSquareCustomer(pool, tenantId, customer, logger);
          customersSynced++;
        } catch (err) {
          errors++;
          log.error(`[square-sync] tenant=${tenantId} — failed to pull customer ${customer.id}: ${err}`);
        }
      }
      cursor = result.cursor;
      hasMore = !!cursor;
    } catch (err) {
      log.error(`[square-sync] tenant=${tenantId} — customer pagination failed: ${err}`);
      break;
    }
  }

  // Sync bookings
  cursor = undefined;
  hasMore = true;
  while (hasMore) {
    try {
      const result = await square.listBookings(tokens.accessToken, cursor);
      const bookings = result.bookings || [];
      for (const booking of bookings) {
        try {
          await pullSquareBooking(pool, tenantId, booking, logger);
          appointmentsSynced++;
        } catch (err) {
          errors++;
          log.error(`[square-sync] tenant=${tenantId} — failed to pull booking ${booking.id}: ${err}`);
        }
      }
      cursor = result.cursor;
      hasMore = !!cursor;
    } catch (err) {
      log.error(`[square-sync] tenant=${tenantId} — booking pagination failed: ${err}`);
      break;
    }
  }

  // Update last_sync_at
  const syncClient = await pool.connect();
  try {
    await syncClient.query(
      `UPDATE tenant_integration_settings SET last_sync_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND provider = 'square'`,
      [tenantId]
    );
  } finally {
    syncClient.release();
  }

  log.info(`[square-sync] tenant=${tenantId} — full sync complete (customers=${customersSynced} appointments=${appointmentsSynced} errors=${errors})`);
  return { customersSynced, appointmentsSynced, errors };
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

function joinName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Customer';
}
