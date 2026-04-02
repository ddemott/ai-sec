import type { Pool } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, logError, type AppRequest } from '../middleware';
import { VapiClient } from '../services/vapiClient';

const ActivateSchema = z.object({
  tenant_id: z.string().uuid(),
  area_code: z.string().regex(/^\d{3}$/).optional(),
});

export function registerProvisioningRoutes(
  app: any,
  pool: Pool,
  vapiClient: VapiClient | null
) {

  // POST /provisioning/activate — provision Vapi assistant + phone number for a tenant
  app.post('/provisioning/activate', withHandler(async (req: AppRequest, reply) => {
    if (!vapiClient) {
      return reply.status(503).send({ success: false, error: 'Phone provisioning not configured (missing VAPI_API_KEY)' });
    }

    const parsed = ActivateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const { tenant_id, area_code } = parsed.data;

    const client = await pool.connect();
    try {
      // Fetch tenant config
      const tenantRes = await client.query(
        `SELECT id, name, business_type, voice_id, system_prompt, first_message, phone_status
         FROM tenants WHERE id = $1`,
        [tenant_id]
      );
      if (tenantRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Tenant not found', tenant_id, timestamp: new Date().toISOString() });
      }

      const tenant = tenantRes.rows[0];

      // Validate prerequisites — tell the caller exactly which fields are missing
      const missingFields: string[] = [];
      if (!tenant.business_type) missingFields.push('business_type');
      if (!tenant.voice_id) missingFields.push('voice_id');
      if (!tenant.system_prompt) missingFields.push('system_prompt');
      if (missingFields.length > 0) {
        return reply.status(400).send({
          error: 'Tenant is missing required configuration for phone activation',
          missing_fields: missingFields,
          tenant_id,
          tenant_name: tenant.name,
          timestamp: new Date().toISOString(),
        });
      }

      // Check status
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

      // Get default resource for this tenant
      const resourceRes = await client.query(
        'SELECT id FROM resources WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1',
        [tenant_id]
      );
      const defaultResourceId = resourceRes.rows[0]?.id || tenant_id;

      // Set provisioning status
      await client.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['provisioning', tenant_id]);

      let assistantId: string | null = null;

      try {
        // Create Vapi assistant
        const assistantResult = await vapiClient.createAssistant({
          id: tenant.id,
          name: tenant.name,
          business_type: tenant.business_type,
          voice_id: tenant.voice_id,
          system_prompt: tenant.system_prompt,
          first_message: tenant.first_message || `Thanks for calling ${tenant.name}! How can I help you today?`,
          default_resource_id: defaultResourceId,
        });
        assistantId = assistantResult.id;

        // Provision phone number
        const phoneResult = await vapiClient.createPhoneNumber(assistantId, area_code);

        // Update tenant with all provisioning data
        await client.query(
          `UPDATE tenants SET
            vapi_assistant_id = $1,
            vapi_phone_number_id = $2,
            inbound_phone = $3,
            phone_status = 'active'
          WHERE id = $4`,
          [assistantId, phoneResult.id, phoneResult.number, tenant_id]
        );

        logEvent(req, 'phone_provisioned', { tenant_id, phone: phoneResult.number, assistant_id: assistantId });

        return reply.send({
          success: true,
          phone_number: phoneResult.number,
          assistant_id: assistantId,
          phone_number_id: phoneResult.id,
        });

      } catch (vapiError: any) {
        // Rollback: delete assistant if it was created
        if (assistantId) {
          try {
            await vapiClient.deleteAssistant(assistantId);
          } catch (cleanupError) {
            logError(req, 'vapi_assistant_cleanup_failed', cleanupError, { assistantId });
          }
        }

        await client.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['failed', tenant_id]);

        logError(req, 'phone_provisioning_failed', vapiError, { tenant_id, assistantId });
        return reply.status(502).send({
          error: 'Phone provisioning failed',
          detail: vapiError.message || 'Unknown Vapi API error',
          tenant_id,
          tenant_name: tenant.name,
          assistant_created: !!assistantId,
          rolled_back: !!assistantId,
          timestamp: new Date().toISOString(),
        });
      }

    } finally {
      client.release();
    }
  }, 'Failed to activate phone'));

  // POST /provisioning/deactivate — remove Vapi assistant + phone number
  app.post('/provisioning/deactivate', withHandler(async (req: AppRequest, reply) => {
    if (!vapiClient) {
      return reply.status(503).send({ success: false, error: 'Phone provisioning not configured (missing VAPI_API_KEY)' });
    }

    const deactiveParsed = z.object({ tenant_id: z.string().uuid() }).safeParse(req.body);
    if (!deactiveParsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: deactiveParsed.error.issues });
    }
    const { tenant_id } = deactiveParsed.data;

    const client = await pool.connect();
    try {
      const tenantRes = await client.query(
        'SELECT vapi_assistant_id, vapi_phone_number_id FROM tenants WHERE id = $1',
        [tenant_id]
      );
      if (tenantRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Tenant not found' });
      }

      const { vapi_assistant_id, vapi_phone_number_id } = tenantRes.rows[0];
      const warnings: string[] = [];

      // Delete phone number first (depends on assistant)
      if (vapi_phone_number_id) {
        try {
          await vapiClient.deletePhoneNumber(vapi_phone_number_id);
        } catch (err: any) {
          const msg = `Failed to delete Vapi phone number ${vapi_phone_number_id}: ${err.message || 'unknown error'}. It may need manual cleanup in the Vapi dashboard.`;
          warnings.push(msg);
          logError(req, 'vapi_phone_delete_failed', err, { vapi_phone_number_id, tenant_id });
        }
      }

      // Delete assistant
      if (vapi_assistant_id) {
        try {
          await vapiClient.deleteAssistant(vapi_assistant_id);
        } catch (err: any) {
          const msg = `Failed to delete Vapi assistant ${vapi_assistant_id}: ${err.message || 'unknown error'}. It may need manual cleanup in the Vapi dashboard.`;
          warnings.push(msg);
          logError(req, 'vapi_assistant_delete_failed', err, { vapi_assistant_id, tenant_id });
        }
      }

      // Clear tenant columns — DB deactivation always succeeds even if Vapi cleanup failed
      await client.query(
        `UPDATE tenants SET
          vapi_assistant_id = NULL,
          vapi_phone_number_id = NULL,
          inbound_phone = NULL,
          phone_status = 'deprovisioned'
        WHERE id = $1`,
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
        'SELECT phone_status, inbound_phone, vapi_assistant_id FROM tenants WHERE id = $1',
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
