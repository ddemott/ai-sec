/**
 * Tenant + owner bootstrap.
 *
 * Public self-service registration (`POST /register`) and admin tenant
 * creation (`POST /tenants/create`) used to maintain near-identical
 * transactional flows: BEGIN, duplicate check, INSERT INTO tenants,
 * bcrypt hash, INSERT INTO users, COMMIT (with ROLLBACK on error).
 * Both lived to serve different policy decisions:
 *
 *   - Different duplicate keys (email globally vs tenant name)
 *   - Different conflict messages
 *   - Different user columns (admin sets first_name/last_name)
 *
 * This module owns the transactional shape; callers express policy via
 * a small parameter object and get back a discriminated-union result.
 *
 * NOTE: This helper opens its own connection from `pool` and manages
 * its own transaction. Do not call it inside an existing transaction
 * on a shared client.
 */

import type { Pool } from 'pg';

export interface CreateTenantWithOwnerParams {
  tenantName: string;
  businessType: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFullName: string;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  /**
   * Which duplicate key blocks creation:
   *   - 'email':       fail if this email already exists on any user
   *                    (public self-serve register flow — one account per
   *                    email globally).
   *   - 'tenant_name': fail if this tenant name already exists,
   *                    case-insensitively (admin create flow — owners
   *                    expect distinct business names in the picker).
   */
  duplicateCheck: 'email' | 'tenant_name';
}

export type CreateTenantWithOwnerResult =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; conflictMessage: string };

export async function createTenantWithOwner(
  pool: Pool,
  params: CreateTenantWithOwnerParams
): Promise<CreateTenantWithOwnerResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (params.duplicateCheck === 'email') {
      const existing = await client.query(
        'SELECT user_id FROM users WHERE email = $1',
        [params.ownerEmail]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          conflictMessage: 'An account with this email already exists',
        };
      }
    } else {
      const existing = await client.query(
        'SELECT tenant_id FROM tenants WHERE LOWER(name) = LOWER($1)',
        [params.tenantName]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          conflictMessage: `A business named "${params.tenantName}" already exists.`,
        };
      }
    }

    const tenantRes = await client.query(
      'INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING tenant_id',
      [params.tenantName, params.businessType]
    );
    const tenantId = tenantRes.rows[0].tenant_id;

    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(params.ownerPassword, 10);

    const userRes = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING user_id`,
      [
        tenantId,
        params.ownerEmail,
        passwordHash,
        params.ownerFullName,
        params.ownerFirstName ?? null,
        params.ownerLastName ?? null,
      ]
    );
    const userId = userRes.rows[0].user_id;

    await client.query('COMMIT');
    return { ok: true, tenantId, userId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
