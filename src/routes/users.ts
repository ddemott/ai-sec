/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import { createHash, randomBytes } from 'crypto';
import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  withHandler,
  logEvent,
  requireTenantId,
  type AppRequest,
  type UserRole,
} from '../middleware';
import { sendUserInviteEmail } from '../services/communications/systemEmail';
import { SUPER_ADMIN_TENANT_ID } from '../constants';

const INVITE_TTL_MINUTES = 60 * 24 * 3; // 3 days

const InviteSchema = z.object({
  tenant_id: z.string().uuid(),
  email: z.string().email().max(200),
  full_name: z.string().min(1).max(200),
  role: z.enum(['owner', 'front_desk']),
});

const UpdateRoleSchema = z.object({
  tenant_id: z.string().uuid(),
  role: z.enum(['owner', 'front_desk']),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Owner-only authz gate. Super-admins (tenant_id = SUPER_ADMIN_TENANT_ID)
 * always pass. Non-owners (front_desk) get 403 — they should not be able
 * to invite teammates or change anyone's role, including their own.
 *
 * Returns true if authorized, otherwise sends a 401/403 and returns false.
 */
function requireOwner(
  req: AppRequest,
  reply: { status: (n: number) => { send: (b: unknown) => unknown } }
): boolean {
  if (!req.auth) {
    reply.status(401).send({ success: false, error: 'Authentication required' });
    return false;
  }
  if (req.auth.tenant_id === SUPER_ADMIN_TENANT_ID) return true;
  if (req.auth.role !== 'owner') {
    reply.status(403).send({ success: false, error: 'Only owners can manage team logins' });
    return false;
  }
  return true;
}

export function registerUserRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // ── GET /users — list logins for current tenant ─────────────────────
  // Returns the team-access view: id, email, full_name, role, plus a flag
  // marking the requester's own row so the UI can disable self-edits.
  app.get(
    '/users',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireOwner(req, reply)) return;
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT user_id::text, email, full_name, role, created_at
         FROM users
         WHERE tenant_id = $1
         ORDER BY created_at ASC`,
          [tenantId]
        );
      });

      const selfId = req.auth?.user_id ?? null;
      return reply.send({
        success: true,
        users: res.rows.map((u) => ({ ...u, is_self: u.user_id === selfId })),
      });
    }, 'Failed to list users')
  );

  // ── POST /users/invite — create login + email password-set link ─────
  // Reuses the password_resets infrastructure so the new user lands on
  // /reset-password to choose their own password rather than being given
  // one by the owner. Avoids an "owner knows the staff password" failure
  // mode and avoids needing a separate invite-token table.
  app.post(
    '/users/invite',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withHandler(async (req: AppRequest, reply) => {
      if (!requireOwner(req, reply)) return;
      const parsed = InviteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const { tenant_id, email, full_name, role } = parsed.data;
      const normalizedEmail = email.toLowerCase().trim();

      // Resolve the inviting business name for the email body. We do this
      // outside the per-tenant transaction so the lookup works for super-
      // admins inviting into a managed tenant (admin_bypass_users RLS
      // policy gives them tenant-table read; the invite write below uses
      // withTenantClient for the new row so RLS pins the tenant_id).
      const tenantRow = await pool.query('SELECT name FROM tenants WHERE tenant_id = $1', [
        tenant_id,
      ]);
      if (tenantRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Tenant not found' });
      }
      const businessName = tenantRow.rows[0].name as string;

      const bcrypt = await import('bcrypt');
      // The user never types this password — they set their own via the
      // reset link. We bcrypt-hash a random string anyway so the column is
      // never empty; if the email never reaches them, no one can log in
      // with the placeholder.
      const placeholderPassword = randomBytes(32).toString('base64url');
      const placeholderHash = await bcrypt.hash(placeholderPassword, 10);

      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(rawToken);

      let userId: string;
      try {
        userId = await withTenantClient(tenant_id, async (client) => {
          const userRes = await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING user_id`,
            [tenant_id, normalizedEmail, placeholderHash, full_name, role]
          );
          const newUserId = userRes.rows[0].user_id as string;
          await client.query(
            `INSERT INTO password_resets (user_id, token_hash, channel, expires_at)
           VALUES ($1, $2, 'email', NOW() + ($3 || ' minutes')::interval)`,
            [newUserId, tokenHash, INVITE_TTL_MINUTES]
          );
          return newUserId;
        });
      } catch (err: unknown) {
        // Postgres unique violation on (tenant_id, email) → 409
        if (err instanceof Error && (err as { code?: string }).code === '23505') {
          return reply.status(409).send({
            success: false,
            error: 'A user with that email already exists for this business',
          });
        }
        throw err;
      }

      const dashboardUrl = process.env.DASHBOARD_URL || 'https://localhost:4000';
      const resetLink = `${dashboardUrl}/reset-password?token=${rawToken}`;
      try {
        await sendUserInviteEmail(
          normalizedEmail,
          resetLink,
          INVITE_TTL_MINUTES,
          businessName,
          role
        );
      } catch (err) {
        // Log but don't roll back — owner can resend if delivery fails.
        // The user row + reset token already exist; resend reuses the row.
        req.log.error({ err, userId, email: normalizedEmail }, 'Failed to send invite email');
      }

      logEvent(req, 'user_invited', { userId, email: normalizedEmail, role });
      return reply.status(201).send({ success: true, user_id: userId });
    }, 'Failed to invite user')
  );

  // ── PATCH /users/:id/role — change a user's role ────────────────────
  // Owners can promote a front_desk user to owner, or demote an owner to
  // front_desk. They cannot change their own role — that's a foot-gun
  // (an owner could lock themselves out of Back Office and need a SQL
  // fix). Super-admins can change anyone's role including their own
  // user-record role, but their access is gated by tenant_id, not the
  // role column, so demoting their user record has no UI effect.
  app.patch(
    '/users/:id/role',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireOwner(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const parsed = UpdateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      if (req.auth?.user_id === id && req.auth.tenant_id !== SUPER_ADMIN_TENANT_ID) {
        return reply.status(400).send({ success: false, error: 'You cannot change your own role' });
      }

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `UPDATE users SET role = $1 WHERE user_id = $2 AND tenant_id = $3 RETURNING user_id, role`,
          [parsed.data.role, id, tenantId]
        );
      });
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'User not found' });
      }

      logEvent(req, 'user_role_updated', { userId: id, role: parsed.data.role });
      return reply.send({ success: true, role: res.rows[0].role as UserRole });
    }, 'Failed to update user role')
  );
}
