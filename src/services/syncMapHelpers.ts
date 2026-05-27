/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Shared sync-map helpers for all CRM integrations.
 *
 * Eliminates duplication across jobberSync, hubspotSync, squareSync,
 * and servicetitanSync — all of which implemented identical patterns for:
 * - Sync map CRUD (upsert on create, update after push, delete)
 * - Timestamp-based freshness checks (skip already-synced versions)
 * - Timestamp-based merge decisions (remote vs local wins)
 * - "Ensure remote customer before appointment push" prerequisite
 * - Pull customer merge (phone-match-or-create + timestamp merge)
 */

import type { Pool, PoolClient } from 'pg';
import type { SyncLogger } from './tokenManagement';
import { withSyncContext, type ChangeSource } from './tokenManagement';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type SyncAction = 'create' | 'update' | 'delete';
export type EntityType = 'customer' | 'appointment';

/** Fields extracted from a remote customer for pull-merge */
export interface RemoteCustomerFields {
  name: string;
  phone: string;
  email: string | null;
  address?: string | null;
}

/** Result of looking up a sync map entry by local_id */
export interface SyncMapByLocalId {
  external_id: string;
  remote_updated_at: string | null;
}

/** Result of looking up a sync map entry by external_id */
export interface SyncMapByExternalId {
  local_id: string;
  remote_updated_at: string | null;
}

// -----------------------------------------------------------------------
// Sync map CRUD
// -----------------------------------------------------------------------

/** Upsert sync map entry after creating a remote entity (push create) */
export async function syncMapUpsertOnCreate(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  localId: string,
  externalId: string,
  localUpdatedAt: string,
  remoteUpdatedAt?: string
): Promise<void> {
  const cols = remoteUpdatedAt
    ? 'tenant_id, provider, entity_type, local_id, external_id, local_updated_at, remote_updated_at, last_synced_at, sync_status'
    : 'tenant_id, provider, entity_type, local_id, external_id, local_updated_at, last_synced_at, sync_status';
  const vals = remoteUpdatedAt
    ? [tenantId, provider, entityType, localId, externalId, localUpdatedAt, remoteUpdatedAt]
    : [tenantId, provider, entityType, localId, externalId, localUpdatedAt];
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = remoteUpdatedAt
    ? `external_id = $5, local_updated_at = $6, remote_updated_at = $7, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`
    : `external_id = $5, local_updated_at = $6, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL`;

  await client.query(
    `INSERT INTO entity_sync_map (${cols})
     VALUES (${placeholders}, NOW(), 'synced')
     ON CONFLICT (tenant_id, provider, entity_type, local_id) DO UPDATE SET
       ${updateSet}`,
    vals
  );
}

/** Update sync map after pushing an update to a remote entity */
export async function syncMapUpdateAfterPush(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  localId: string,
  localUpdatedAt: string
): Promise<void> {
  await client.query(
    `UPDATE entity_sync_map SET local_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced', error_message = NULL
     WHERE tenant_id = $2 AND provider = $3 AND entity_type = $4 AND local_id = $5`,
    [localUpdatedAt, tenantId, provider, entityType, localId]
  );
}

/** Delete sync map entry (for providers that don't support remote delete) */
export async function syncMapDeleteByLocalId(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  localId: string
): Promise<void> {
  await client.query(
    `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = $2 AND entity_type = $3 AND local_id = $4`,
    [tenantId, provider, entityType, localId]
  );
}

/** Mark sync map entry as deleted/canceled (for providers that support remote cancel) */
export async function syncMapMarkDeleted(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  localId: string,
  status: 'deleted' | 'canceled' = 'deleted'
): Promise<void> {
  await client.query(
    `UPDATE entity_sync_map SET sync_status = $1, last_synced_at = NOW()
     WHERE tenant_id = $2 AND provider = $3 AND entity_type = $4 AND local_id = $5`,
    [status, tenantId, provider, entityType, localId]
  );
}

// -----------------------------------------------------------------------
// Sync map lookups
// -----------------------------------------------------------------------

/** Look up sync map entry by local_id (used in push flows) */
export async function syncMapFindByLocalId(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  localId: string
): Promise<SyncMapByLocalId | null> {
  const res = await client.query(
    `SELECT external_id, remote_updated_at FROM entity_sync_map
     WHERE tenant_id = $1 AND provider = $2 AND entity_type = $3 AND local_id = $4`,
    [tenantId, provider, entityType, localId]
  );
  return res.rows[0] || null;
}

/** Look up sync map entry by external_id (used in pull flows) */
export async function syncMapFindByExternalId(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  externalId: string
): Promise<SyncMapByExternalId | null> {
  const res = await client.query(
    `SELECT local_id, remote_updated_at FROM entity_sync_map
     WHERE tenant_id = $1 AND provider = $2 AND entity_type = $3 AND external_id = $4`,
    [tenantId, provider, entityType, externalId]
  );
  return res.rows[0] || null;
}

/** Look up external_id for a local entity (shorthand for ensure-customer checks) */
export async function syncMapGetExternalId(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  localId: string
): Promise<string | null> {
  const res = await client.query(
    `SELECT external_id FROM entity_sync_map
     WHERE tenant_id = $1 AND provider = $2 AND entity_type = $3 AND local_id = $4`,
    [tenantId, provider, entityType, localId]
  );
  return res.rows[0]?.external_id || null;
}

// -----------------------------------------------------------------------
// Freshness check
// -----------------------------------------------------------------------

/** Returns true if this remote version was already synced (skip it) */
export function isAlreadySynced(remoteUpdatedAt: string, lastRemoteUpdate: string | null): boolean {
  if (!lastRemoteUpdate) return false;
  return new Date(remoteUpdatedAt) <= new Date(lastRemoteUpdate);
}

/** Returns true if the remote record is newer than the local record */
export function isRemoteNewer(remoteUpdatedAt: string, localUpdatedAt: string | Date): boolean {
  return new Date(remoteUpdatedAt) > new Date(localUpdatedAt);
}

// -----------------------------------------------------------------------
// Ensure remote customer before appointment push
// -----------------------------------------------------------------------

/**
 * Ensures a customer is synced to the remote provider before pushing an appointment.
 * If not yet synced, calls the provided pushCustomer function, then re-checks.
 *
 * Returns the external customer ID, or null if sync failed.
 */
export async function ensureRemoteCustomer(
  client: PoolClient,
  pool: Pool,
  tenantId: string,
  provider: string,
  localCustomerId: string,
  pushCustomer: (
    pool: Pool,
    tenantId: string,
    customerId: string,
    action: SyncAction,
    logger?: SyncLogger
  ) => Promise<void>,
  logger?: SyncLogger,
  prefix?: string
): Promise<string | null> {
  const log = logger || { warn: console.warn, error: console.error, info: console.info };

  let externalId = await syncMapGetExternalId(
    client,
    tenantId,
    provider,
    'customer',
    localCustomerId
  );
  if (externalId) return externalId;

  // Customer not yet synced — push them first
  await pushCustomer(pool, tenantId, localCustomerId, 'create', logger);

  externalId = await syncMapGetExternalId(client, tenantId, provider, 'customer', localCustomerId);
  if (!externalId) {
    log.error(
      `${prefix || `[${provider}-sync]`} — cannot push appointment: customer sync failed (customerId=${localCustomerId})`
    );
    return null;
  }
  return externalId;
}

// -----------------------------------------------------------------------
// Pull customer merge (the big shared pattern)
// -----------------------------------------------------------------------

/** Upsert sync map entry after pulling a remote entity (on first pull) */
export async function syncMapUpsertOnPull(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  localId: string,
  externalId: string,
  remoteUpdatedAt: string
): Promise<void> {
  await client.query(
    `INSERT INTO entity_sync_map (tenant_id, provider, entity_type, local_id, external_id, remote_updated_at, last_synced_at, sync_status)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'synced')
     ON CONFLICT (tenant_id, provider, entity_type, external_id) DO UPDATE SET
       local_id = $4, remote_updated_at = $6, last_synced_at = NOW(), sync_status = 'synced'`,
    [tenantId, provider, entityType, localId, externalId, remoteUpdatedAt]
  );
}

/** Update sync map remote_updated_at after pulling an updated version */
export async function syncMapUpdateAfterPull(
  client: PoolClient,
  tenantId: string,
  provider: string,
  entityType: EntityType,
  externalId: string,
  remoteUpdatedAt: string
): Promise<void> {
  await client.query(
    `UPDATE entity_sync_map SET remote_updated_at = $1, last_synced_at = NOW(), sync_status = 'synced'
     WHERE tenant_id = $2 AND provider = $3 AND entity_type = $4 AND external_id = $5`,
    [remoteUpdatedAt, tenantId, provider, entityType, externalId]
  );
}

/**
 * Pull a remote customer into the local customers table with timestamp-based merge.
 *
 * Shared flow used by all 4 CRM providers:
 * 1. Check sync map for existing mapping
 * 2. If new: match by phone or create, then create sync map entry
 * 3. If existing: skip if already synced, compare timestamps, update if remote newer
 *
 * @param updateColumns - SQL SET clause for updating existing customers (provider-specific,
 *   e.g. Jobber includes address, HubSpot doesn't). Placeholders start at $1.
 * @param updateValues - Values for the update columns (before localId, tenantId which are appended)
 */
export async function pullRemoteCustomer(opts: {
  pool: Pool;
  tenantId: string;
  provider: string;
  changeSource: ChangeSource;
  externalId: string;
  remoteUpdatedAt: string;
  fields: RemoteCustomerFields;
  /** SQL SET clause like "name = COALESCE($1, name), email = COALESCE($2, email), address = COALESCE($3, address)" */
  updateSetClause: string;
  /** Values for update placeholders (localId and tenantId will be appended as the last two) */
  updateValues: (string | null)[];
  logger?: SyncLogger;
  prefix?: string;
}): Promise<void> {
  const { pool, tenantId, provider, changeSource, externalId, remoteUpdatedAt, fields, logger } =
    opts;
  const log = logger || { warn: console.warn, error: console.error, info: console.info };
  const prefix = opts.prefix || `[${provider}-sync] tenant=${tenantId}`;

  if (!fields.phone) {
    log.warn(
      `${prefix} — skipped: ${provider} customer ${externalId} has no phone number (required field)`
    );
    return;
  }

  const client = await pool.connect();
  try {
    await withSyncContext(client, changeSource, `sync-${provider}`, async () => {
      const syncEntry = await syncMapFindByExternalId(
        client,
        tenantId,
        provider,
        'customer',
        externalId
      );

      if (!syncEntry) {
        // New — check if customer with same phone exists
        const existingRes = await client.query(
          `SELECT customer_id, updated_at FROM customers WHERE tenant_id = $1 AND phone = $2`,
          [tenantId, fields.phone]
        );

        let localId: string;
        if (existingRes.rows.length > 0) {
          localId = existingRes.rows[0].customer_id;
          const localUpdatedAt = existingRes.rows[0].updated_at;

          if (isRemoteNewer(remoteUpdatedAt, localUpdatedAt)) {
            const localIdIdx = opts.updateValues.length + 1;
            const tenantIdIdx = opts.updateValues.length + 2;
            await client.query(
              `UPDATE customers SET ${opts.updateSetClause}
               WHERE customer_id = $${localIdIdx} AND tenant_id = $${tenantIdIdx}`,
              [...opts.updateValues, localId, tenantId]
            );
            log.info(
              `${prefix} — merged ${provider} customer into existing customer (${provider}Id=${externalId} localId=${localId} phone=${fields.phone} — remote was newer)`
            );
          } else {
            log.info(
              `${prefix} — matched existing customer by phone (${provider}Id=${externalId} localId=${localId} — local was newer, kept local values)`
            );
          }
        } else {
          // Brand new customer
          const insertCols =
            fields.address !== undefined
              ? 'tenant_id, name, phone, email, address'
              : 'tenant_id, name, phone, email';
          const insertVals =
            fields.address !== undefined
              ? [tenantId, fields.name, fields.phone, fields.email, fields.address]
              : [tenantId, fields.name, fields.phone, fields.email];
          const insertPlaceholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');

          const insertRes = await client.query(
            `INSERT INTO customers (${insertCols}) VALUES (${insertPlaceholders}) RETURNING customer_id`,
            insertVals
          );
          localId = insertRes.rows[0].customer_id;
          log.info(
            `${prefix} — created local customer from ${provider} customer (${provider}Id=${externalId} localId=${localId} name=${fields.name})`
          );
        }

        await syncMapUpsertOnPull(
          client,
          tenantId,
          provider,
          'customer',
          localId,
          externalId,
          remoteUpdatedAt
        );
      } else {
        // Existing mapping — timestamp-based merge
        const { local_id: localId, remote_updated_at: lastRemoteUpdate } = syncEntry;

        if (isAlreadySynced(remoteUpdatedAt, lastRemoteUpdate)) {
          log.info(
            `${prefix} — skipped: already synced this version (${provider}Id=${externalId} remoteUpdatedAt=${remoteUpdatedAt})`
          );
          return;
        }

        const localRes = await client.query(
          `SELECT updated_at FROM customers WHERE customer_id = $1 AND tenant_id = $2`,
          [localId, tenantId]
        );
        const localUpdatedAt = localRes.rows[0]?.updated_at;

        if (isRemoteNewer(remoteUpdatedAt, localUpdatedAt)) {
          const localIdIdx = opts.updateValues.length + 1;
          const tenantIdIdx = opts.updateValues.length + 2;
          await client.query(
            `UPDATE customers SET ${opts.updateSetClause}
             WHERE customer_id = $${localIdIdx} AND tenant_id = $${tenantIdIdx}`,
            [...opts.updateValues, localId, tenantId]
          );
          log.info(
            `${prefix} — updated local customer from ${provider} (${provider}Id=${externalId} localId=${localId} — remote was newer)`
          );
        } else {
          log.info(
            `${prefix} — kept local values (${provider}Id=${externalId} localId=${localId} — local was newer)`
          );
        }

        await syncMapUpdateAfterPull(
          client,
          tenantId,
          provider,
          'customer',
          externalId,
          remoteUpdatedAt
        );
      }
    });
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// Full sync: update last_sync_at
// -----------------------------------------------------------------------

/** Update tenant_integration_settings.last_sync_at after a full sync */
export async function updateLastSyncAt(
  pool: Pool,
  tenantId: string,
  provider: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE tenant_integration_settings SET last_sync_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider]
    );
  } finally {
    client.release();
  }
}
