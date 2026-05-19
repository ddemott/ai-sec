import type { Pool } from 'pg';
import type { AppFastifyInstance } from '../types/fastify';
import { z } from 'zod';
import { withHandler, logEvent, logError, type AppRequest } from '../middleware';
import { type TelnyxNumbersClient } from '../services/telnyxNumbers';

const ActivateSchema = z.object({
  tenant_id: z.string().uuid(),
  area_code: z.string().regex(/^\d{3}$/).optional(),
});

export interface TelnyxProvisioningConfig {
  client: TelnyxNumbersClient;
  sipConnectionId: string;
}

export function registerProvisioningRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  telnyx: TelnyxProvisioningConfig | null
) {

  // POST /provisioning/activate — purchase a Telnyx number and route it to LiveKit
  app.post('/provisioning/activate', withHandler(async (req: AppRequest, reply) => {
    if (!telnyx) {
      return reply.status(503).send({
        success: false,
        error: 'Phone provisioning not configured (missing TELNYX_API_KEY or TELNYX_SIP_CONNECTION_ID)',
      });
    }

    const parsed = ActivateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const { tenant_id, area_code } = parsed.data;

    const client = await pool.connect();
    try {
      const tenantRes = await client.query(
        `SELECT tenant_id, name, phone_status FROM tenants WHERE tenant_id = $1`,
        [tenant_id]
      );
      if (tenantRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Tenant not found', tenant_id, timestamp: new Date().toISOString() });
      }

      const tenant = tenantRes.rows[0];

      if (tenant.phone_status === 'active') {
        return reply.status(409).send({
          error: 'Phone is already active for this tenant',
          tenant_id, tenant_name: tenant.name,
          current_status: tenant.phone_status,
          timestamp: new Date().toISOString(),
        });
      }
      if (tenant.phone_status === 'provisioning') {
        return reply.status(409).send({
          error: 'Phone provisioning is already in progress',
          tenant_id, tenant_name: tenant.name,
          current_status: tenant.phone_status,
          timestamp: new Date().toISOString(),
        });
      }

      await client.query('UPDATE tenants SET phone_status = $1 WHERE tenant_id = $2', ['provisioning', tenant_id]);

      let purchasedId: string | null = null;
      let purchasedNumber: string | null = null;

      try {
        const available = await telnyx.client.searchAvailable(area_code);
        if (!available) {
          throw new Error(area_code
            ? `No available phone numbers in area code ${area_code}`
            : 'No available phone numbers in Telnyx inventory'
          );
        }

        const ordered = await telnyx.client.orderNumber(available.phone_number);
        purchasedId = ordered.id;
        purchasedNumber = ordered.phone_number;

        await telnyx.client.assignToConnection(ordered.id, telnyx.sipConnectionId);

        await client.query(
          `UPDATE tenants SET
            telnyx_phone_number_id = $1,
            inbound_phone = $2,
            phone_status = 'active'
          WHERE tenant_id = $3`,
          [ordered.id, ordered.phone_number, tenant_id]
        );

        logEvent(req, 'phone_provisioned', {
          tenant_id,
          phone: ordered.phone_number,
          telnyx_phone_number_id: ordered.id,
        });

        return reply.send({
          success: true,
          phone_number: ordered.phone_number,
          telnyx_phone_number_id: ordered.id,
        });

      } catch (err: unknown) {
        // Best-effort rollback: release the number if it was purchased before
        // the connection assignment failed.
        if (purchasedId) {
          try {
            await telnyx.client.release(purchasedId);
          } catch (cleanupError) {
            logError(req, 'telnyx_number_cleanup_failed', cleanupError, { purchasedId, purchasedNumber });
          }
        }

        await client.query('UPDATE tenants SET phone_status = $1 WHERE tenant_id = $2', ['failed', tenant_id]);

        const detail = err instanceof Error ? err.message : String(err);
        logError(req, 'phone_provisioning_failed', err, { tenant_id, purchasedId });
        return reply.status(502).send({
          error: 'Phone provisioning failed',
          detail,
          tenant_id,
          tenant_name: tenant.name,
          number_purchased: !!purchasedId,
          rolled_back: !!purchasedId,
          timestamp: new Date().toISOString(),
        });
      }

    } finally {
      client.release();
    }
  }, 'Failed to activate phone'));

  // POST /provisioning/deactivate — release the Telnyx number
  app.post('/provisioning/deactivate', withHandler(async (req: AppRequest, reply) => {
    if (!telnyx) {
      return reply.status(503).send({
        success: false,
        error: 'Phone provisioning not configured (missing TELNYX_API_KEY or TELNYX_SIP_CONNECTION_ID)',
      });
    }

    const deactiveParsed = z.object({ tenant_id: z.string().uuid() }).safeParse(req.body);
    if (!deactiveParsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: deactiveParsed.error.issues });
    }
    const { tenant_id } = deactiveParsed.data;

    const client = await pool.connect();
    try {
      const tenantRes = await client.query(
        'SELECT telnyx_phone_number_id FROM tenants WHERE tenant_id = $1',
        [tenant_id]
      );
      if (tenantRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Tenant not found' });
      }

      const { telnyx_phone_number_id } = tenantRes.rows[0];
      const warnings: string[] = [];

      if (telnyx_phone_number_id) {
        try {
          await telnyx.client.release(telnyx_phone_number_id);
        } catch (err) {
          const msg = `Failed to release Telnyx number ${telnyx_phone_number_id}: ${err instanceof Error ? err.message : 'unknown error'}. It may need manual cleanup in the Telnyx portal.`;
          warnings.push(msg);
          logError(req, 'telnyx_number_release_failed', err, { telnyx_phone_number_id, tenant_id });
        }
      }

      // Clear tenant columns — DB deactivation always succeeds even if Telnyx cleanup failed
      await client.query(
        `UPDATE tenants SET
          telnyx_phone_number_id = NULL,
          inbound_phone = NULL,
          phone_status = 'deprovisioned'
        WHERE tenant_id = $1`,
        [tenant_id]
      );

      logEvent(req, 'phone_deprovisioned', { tenant_id, warnings_count: warnings.length });

      return reply.send({
        success: true,
        ...(warnings.length > 0 ? { warnings } : {}),
      });

    } finally {
      client.release();
    }
  }, 'Failed to deactivate phone'));

  // GET /provisioning/status — get phone provisioning status for a tenant
  app.get('/provisioning/status', withHandler(async (req: AppRequest, reply) => {
    const { tenant_id } = req.query as { tenant_id: string };
    if (!tenant_id) {
      return reply.status(400).send({ success: false, error: 'tenant_id query parameter is required' });
    }

    const client = await pool.connect();
    try {
      const res = await client.query(
        'SELECT phone_status, inbound_phone, telnyx_phone_number_id FROM tenants WHERE tenant_id = $1',
        [tenant_id]
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Tenant not found' });
      }

      return reply.send(res.rows[0]);
    } finally {
      client.release();
    }
  }, 'Failed to get provisioning status'));
}
