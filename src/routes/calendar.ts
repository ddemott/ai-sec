
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

export function registerCalendarRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.post('/calendar/sync', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as any;
    return reply.status(202).send({ status: 'accepted', source: body?.provider || 'unknown' });
  }, 'Failed to sync calendar'));

  app.get('/calendar/settings', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM tenant_calendar_settings WHERE tenant_id = $1', [tenantId]);
    });
    return reply.send(res.rows[0] || null);
  }, 'Failed to fetch calendar settings'));

  app.post('/calendar/settings', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as any;
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `INSERT INTO tenant_calendar_settings (tenant_id, provider, external_calendar_id, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (tenant_id)
         DO UPDATE SET provider = $2, external_calendar_id = $3, is_active = true, updated_at = NOW()
         RETURNING *`,
        [tenantId, body.provider, body.external_calendar_id]
      );
    });

    logEvent(req, 'calendar_settings_updated', { provider: body.provider });
    return reply.send({ success: true, settings: res.rows[0] });
  }, 'Failed to update calendar settings'));

  app.post('/calendar/settings/disconnect', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, async (client) => {
      await client.query('DELETE FROM tenant_calendar_settings WHERE tenant_id = $1', [tenantId]);
    });

    logEvent(req, 'calendar_disconnected', {});
    return reply.send({ success: true });
  }, 'Failed to disconnect calendar'));
}
