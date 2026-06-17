/**
 * Self-service appointment actions — token-gated, no session auth required.
 *
 * These routes are intentionally unauthenticated: the token (sent via SMS/email
 * link) IS the auth. They are registered WITHOUT tenantMiddleware so the JWT
 * hook never fires; the token's `tenant_id` + `appointment_id` claims scope
 * every DB write.
 *
 * Currently supported:
 *   GET /self/cancel?token=... — cancel a single appointment
 */

import type { Pool } from 'pg';
import type { AppFastifyInstance } from '../types/fastify.js';
import { withHandler } from '../middleware.js';
import { verifySelfServiceToken } from '../services/selfServiceToken.js';
import { logEvent } from '../middleware.js';

export function registerSelfServiceRoutes(app: AppFastifyInstance, pool: Pool) {
  /**
   * GET /self/cancel?token=...
   *
   * Cancel a single appointment via a 24-hour signed token.
   * Returns JSON so mobile browsers and raw curl both get a usable response.
   * Idempotent: canceling an already-canceled appointment returns 200.
   */
  app.get(
    '/self/cancel',
    withHandler(async (req, reply) => {
      const { token } = req.query as { token?: string };
      if (!token) {
        return reply
          .status(400)
          .send({ success: false, error: 'Missing cancel token. The link may be incomplete.' });
      }

      const payload = verifySelfServiceToken(token, 'cancel');
      if (!payload) {
        return reply.status(400).send({
          success: false,
          error:
            'This cancel link has expired or is invalid. Please call us to cancel your appointment.',
        });
      }

      const { appointment_id, tenant_id } = payload;

      // Scope the update to both appointment_id AND tenant_id — token claims
      // provide both; cross-tenant cancel is structurally impossible even if
      // somehow a valid token were replayed against a different tenant.
      const result = await pool.query(
        `UPDATE appointments
         SET status = 'canceled'
         WHERE appointment_id = $1
           AND tenant_id = $2
           AND status != 'canceled'
         RETURNING appointment_id`,
        [appointment_id, tenant_id]
      );

      if (result.rowCount === 0) {
        // Either not found (wrong tenant) or already canceled — both idempotent
        const check = await pool.query(
          `SELECT status FROM appointments WHERE appointment_id = $1 AND tenant_id = $2`,
          [appointment_id, tenant_id]
        );
        if (check.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Appointment not found. It may have already been removed.',
          });
        }
        // Already canceled — idempotent success
        return reply.send({
          success: true,
          message: 'Your appointment has already been canceled.',
        });
      }

      logEvent(req, 'appointment_self_canceled', {
        appointmentId: appointment_id,
        tenantId: tenant_id,
      });

      return reply.send({
        success: true,
        message: 'Your appointment has been canceled. We hope to see you again soon!',
      });
    }, 'Failed to cancel appointment')
  );
}
