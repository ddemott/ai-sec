/**
 * Demo tenant endpoints.
 *
 * POST /demo/start — public, no auth required.
 *   Provisions an ephemeral Postgres tenant (is_demo=true, TTL=30 min),
 *   seeds it with realistic automotive data, and returns a scoped JWT.
 *
 * Safety properties:
 *   - Tenant ID generated server-side only.
 *   - JWT is never super-admin (role='owner', tenant_id = demo tenant).
 *   - Per-IP rate limit: 3 starts per 15 minutes.
 *   - Global cap: at most MAX_ACTIVE_DEMO_TENANTS concurrent demo tenants.
 *   - Demo JWT expiry aligns with demo_expires_at (30 min).
 *   - is_demo=true guards outbound SMS / CRM sync in other services.
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool } from 'pg';
import type { UserRole } from '../middleware';
import { withHandler } from '../middleware';
import { seedDemoTenant } from '../services/demoSeed';

// Per-IP burst limit for demo provisioning.
const DEMO_RATE_LIMIT_MAX = 3;
const DEMO_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 min

// Maximum concurrent active demo tenants. Keeps the DB from being
// flooded if the rate-limit is bypassed or hits are spread across IPs.
const MAX_ACTIVE_DEMO_TENANTS = 50;

// Demo TTL in minutes.
const DEMO_TTL_MINUTES = 30;

// In-process per-IP store: { ip → count of starts in current window }
// Resets when the process restarts, which is fine — demo rate-limiting
// is a soft DoS guard, not a hard security boundary.
const ipWindowStart = new Map<string, number>();
const ipCount = new Map<string, number>();

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = ipWindowStart.get(ip) ?? 0;
  if (now - windowStart > DEMO_RATE_LIMIT_WINDOW_MS) {
    ipWindowStart.set(ip, now);
    ipCount.set(ip, 1);
    return true; // first request in fresh window
  }
  const count = (ipCount.get(ip) ?? 0) + 1;
  ipCount.set(ip, count);
  return count <= DEMO_RATE_LIMIT_MAX;
}

/** Clear rate-limit state. Only used in tests to prevent cross-test bleed. */
export function resetDemoRateLimitForTesting(): void {
  ipWindowStart.clear();
  ipCount.clear();
}

export function registerDemoRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  generateToken: (payload: {
    tenant_id: string;
    user_id: string;
    email: string;
    role: UserRole;
  }) => string
): void {
  // POST /demo/start
  app.post(
    '/demo/start',
    withHandler(async (req, reply) => {
      // Use x-forwarded-for first so we get the real client IP when
      // behind Railway's reverse proxy. Falls back to req.ip for direct
      // connections and local dev.
      const xff = req.headers['x-forwarded-for'];
      const ip =
        (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() ?? req.ip;

      if (!checkIpRateLimit(ip)) {
        return reply.status(429).send({
          success: false,
          error: 'Too many demo sessions from this IP. Try again in 15 minutes.',
        });
      }

      // Global cap check — count non-expired demo tenants.
      const capRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM tenants
         WHERE is_demo = true AND demo_expires_at > NOW()`
      );
      const activeCount = parseInt(capRes.rows[0]?.count ?? '0', 10);
      if (activeCount >= MAX_ACTIVE_DEMO_TENANTS) {
        return reply.status(503).send({
          success: false,
          error: 'Demo capacity is full. Please try again in a few minutes.',
        });
      }

      const expiresAt = new Date(Date.now() + DEMO_TTL_MINUTES * 60 * 1000);

      // Provision tenant + owner user in one transaction.
      const provisionRes = await pool.query<{ tenant_id: string; user_id: string }>(
        `WITH new_tenant AS (
           INSERT INTO tenants (name, business_type, timezone, is_demo, demo_expires_at)
           VALUES ('Quick Lube Demo', 'automotive', 'America/Chicago', true, $1)
           RETURNING tenant_id
         ),
         new_user AS (
           INSERT INTO users (tenant_id, email, password_hash, full_name, role)
           SELECT tenant_id,
                  'demo@quicklubedemo.invalid',
                  -- bcrypt hash of a random 32-char string — no one can log in via password
                  '$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                  'Demo Owner',
                  'owner'
           FROM new_tenant
           RETURNING tenant_id, user_id
         )
         SELECT new_tenant.tenant_id, new_user.user_id
         FROM new_tenant JOIN new_user ON new_tenant.tenant_id = new_user.tenant_id`,
        [expiresAt.toISOString()]
      );

      const { tenant_id: tenantId, user_id: userId } = provisionRes.rows[0];

      // Seed business data.
      await seedDemoTenant(pool, { tenantId, userId });

      // Issue a scoped, time-limited JWT. Expiry matches demo_expires_at.
      // jsonwebtoken accepts expiresIn as seconds (number).
      const ttlSeconds = Math.floor(DEMO_TTL_MINUTES * 60);
      // generateToken uses the global JWT_EXPIRY env default; we need a
      // short expiry here. Sign directly with the same secret instead.
      const jwt = await import('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
      const token = jwt.default.sign(
        {
          tenant_id: tenantId,
          user_id: userId,
          email: 'demo@quicklubedemo.invalid',
          role: 'owner' as UserRole,
        },
        JWT_SECRET,
        { expiresIn: ttlSeconds }
      );

      return reply.send({
        success: true,
        token,
        tenant_id: tenantId,
        user_id: userId,
        expires_at: expiresAt.toISOString(),
        ttl_minutes: DEMO_TTL_MINUTES,
      });
    }, 'POST /demo/start failed')
  );
}
