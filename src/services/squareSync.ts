import type { Pool } from 'pg';
import * as square from './squareClient';
import { type SyncLogger, syncCtx, getIntegrationTokens, TOKEN_BUFFER_MS, withSyncContext } from './tokenManagement';
import { splitName, joinName } from './nameUtils';
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
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
      await syncMapDeleteByLocalId(client, tenantId, 'square', 'customer', customerId);
      log.info(`${prefix} — sync map entry removed`);
      return;
    }

    // Read sync_map BEFORE customers — lock order
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'square', 'customer', customerId);

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
    const customerData: Record<string, string> = {
      given_name: nameParts.firstName,
      family_name: nameParts.lastName,
    };
    if (cust.phone) customerData.phone_number = cust.phone;
    if (cust.email) customerData.email_address = cust.email;

    if (!syncEntry || action === 'create') {
      // Create in Square
      const result = await square.createCustomer(tokens.accessToken, customerData);
      const squareCustomer = result.customer;

      await syncMapUpsertOnCreate(
        client, tenantId, 'square', 'customer', customerId, squareCustomer.id,
        cust.updated_at, squareCustomer.updated_at || new Date().toISOString()
      );
      log.info(`${prefix} — customer pushed to Square (squareId=${squareCustomer.id} name=${cust.name})`);
    } else {
      // Update in Square
      const externalId = syncEntry.external_id;
      await square.updateCustomer(tokens.accessToken, externalId, customerData);

      await syncMapUpdateAfterPush(client, tenantId, 'square', 'customer', customerId, cust.updated_at);
      log.info(`${prefix} — customer updated in Square (squareId=${externalId} name=${cust.name})`);
    }
  } finally {
    client.release();
  }
}

/** Push a local appointment to Square as a booking */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
      const syncEntry = await syncMapFindByLocalId(client, tenantId, 'square', 'appointment', appointmentId);

      if (syncEntry) {
        try {
          await square.cancelBooking(tokens.accessToken, syncEntry.external_id);
        } catch (err) {
          log.warn(`${prefix} — failed to cancel Square booking (squareId=${syncEntry.external_id} | ERROR: ${err})`);
        }

        await syncMapMarkDeleted(client, tenantId, 'square', 'appointment', appointmentId, 'deleted');
      }
      log.info(`${prefix} — sync map entry updated (canceled)`);
      return;
    }

    // Read sync_map BEFORE appointments — lock order
    const syncEntry = await syncMapFindByLocalId(client, tenantId, 'square', 'appointment', appointmentId);

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
    const squareCustomerId = await ensureRemoteCustomer(
      client, pool, tenantId, 'square', appt.customer_id, syncCustomerToSquare, logger, prefix
    );

    // Calculate duration in minutes
    const startTime = new Date(appt.start_time);
    const endTime = new Date(appt.end_time);
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    const bookingData: { start_at: string; appointment_segments: Array<{ duration_minutes: number }>; customer_id?: string } = {
      start_at: startTime.toISOString(),
      appointment_segments: [{ duration_minutes: durationMinutes }],
    };
    if (squareCustomerId) bookingData.customer_id = squareCustomerId;

    if (!syncEntry || action === 'create') {
      const result = await square.createBooking(tokens.accessToken, bookingData);
      const squareBooking = result.booking;

      await syncMapUpsertOnCreate(
        client, tenantId, 'square', 'appointment', appointmentId, squareBooking.id,
        appt.updated_at || new Date().toISOString()
      );
      log.info(`${prefix} — appointment pushed to Square as booking (squareId=${squareBooking.id} customer=${appt.customer_name})`);
    } else {
      const externalId = syncEntry.external_id;
      await square.updateBooking(tokens.accessToken, externalId, bookingData);

      await syncMapUpdateAfterPush(client, tenantId, 'square', 'appointment', appointmentId, appt.updated_at);
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
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
export async function pullSquareCustomer(
  pool: Pool,
  tenantId: string,
  customerData: square.SquareCustomer,
  logger?: SyncLogger
): Promise<void> {
  const prefix = ctx(tenantId, 'customer', 'pull');
  const name = joinName(customerData.given_name, customerData.family_name);
  const phone = customerData.phone_number || '';
  const email = customerData.email_address || null;

  await pullRemoteCustomer({
    pool,
    tenantId,
    provider: 'square',
    changeSource: 'square',
    externalId: customerData.id,
    remoteUpdatedAt: customerData.updated_at || new Date().toISOString(),
    fields: { name, phone, email },
    updateSetClause: 'name = COALESCE($1, name), email = COALESCE($2, email)',
    updateValues: [name, email],
    logger,
    prefix,
  });
}

/** Pull a Square booking into the local appointments table */
// DEADLOCK PREVENTION: Lock order is always entity_sync_map → customers → appointments.
// Push and pull operations must follow this order to prevent circular waits.
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
    await withSyncContext(client, 'square', 'sync-square', async () => {
      const squareId = bookingData.id;
      const remoteUpdatedAt = bookingData.updated_at || new Date().toISOString();

      if (!bookingData.start_at) {
        log.warn(`${prefix} — skipped: Square booking ${squareId} has no start_at`);
        return;
      }

      // Look up local customer via sync map if booking has customer_id
      let localCustomerId: string | null = null;
      if (bookingData.customer_id) {
        const custSync = await syncMapFindByExternalId(client, tenantId, 'square', 'customer', bookingData.customer_id);
        localCustomerId = custSync?.local_id || null;
      }

      const syncEntry = await syncMapFindByExternalId(client, tenantId, 'square', 'appointment', squareId);

      const startTime = new Date(bookingData.start_at);
      const durationMinutes = bookingData.appointment_segments?.[0]?.duration_minutes || 60;
      const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

      const status = bookingData.status === 'CANCELLED_BY_CUSTOMER' || bookingData.status === 'CANCELLED_BY_SELLER'
        ? 'canceled'
        : 'scheduled';

      if (!syncEntry) {
        const insertRes = await client.query(
          `INSERT INTO appointments (tenant_id, customer_id, start_time, end_time, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [tenantId, localCustomerId, startTime.toISOString(), endTime.toISOString(), status]
        );
        const localId = insertRes.rows[0].id;

        await syncMapUpsertOnPull(client, tenantId, 'square', 'appointment', localId, squareId, remoteUpdatedAt);
        log.info(`${prefix} — created local appointment from Square booking (squareId=${squareId} localId=${localId})`);
      } else {
        const { local_id: localId, remote_updated_at: lastRemoteUpdate } = syncEntry;

        if (isAlreadySynced(remoteUpdatedAt, lastRemoteUpdate)) {
          log.info(`${prefix} — skipped: already synced this version (squareId=${squareId})`);
          return;
        }

        await client.query(
          `UPDATE appointments SET start_time = $1, end_time = $2, status = $3, customer_id = COALESCE($4, customer_id)
           WHERE id = $5 AND tenant_id = $6`,
          [startTime.toISOString(), endTime.toISOString(), status, localCustomerId, localId, tenantId]
        );

        await syncMapUpdateAfterPull(client, tenantId, 'square', 'appointment', squareId, remoteUpdatedAt);
        log.info(`${prefix} — updated local appointment from Square (squareId=${squareId} localId=${localId})`);
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

  const contextLabel = `[square-sync] tenant=${tenantId}`;

  const customerResult = await paginateSync<square.SquareCustomer, string | undefined>({
    initialCursor: undefined,
    fetchPage: async (cursor) => {
      const result = await square.listCustomers(tokens.accessToken, cursor);
      return {
        items: result.customers || [],
        nextCursor: result.cursor ?? null,
      };
    },
    processItem: (customer) => pullSquareCustomer(pool, tenantId, customer, logger),
    itemContext: (customer) => customer.id,
    contextLabel,
    entityType: 'customer',
    logger: log,
  });

  const bookingResult = await paginateSync<square.SquareBooking, string | undefined>({
    initialCursor: undefined,
    fetchPage: async (cursor) => {
      const result = await square.listBookings(tokens.accessToken, cursor);
      return {
        items: result.bookings || [],
        nextCursor: result.cursor ?? null,
      };
    },
    processItem: (booking) => pullSquareBooking(pool, tenantId, booking, logger),
    itemContext: (booking) => booking.id,
    contextLabel,
    entityType: 'booking',
    logger: log,
  });

  const customersSynced = customerResult.count;
  const appointmentsSynced = bookingResult.count;
  const errors = customerResult.errors + bookingResult.errors;

  await updateLastSyncAt(pool, tenantId, 'square');
  log.info(`${contextLabel} — full sync complete (customers=${customersSynced} appointments=${appointmentsSynced} errors=${errors})`);
  return { customersSynced, appointmentsSynced, errors };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

