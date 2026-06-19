/**
 * Accounting add-on (federation with MyAccountant). These routes are a thin
 * proxy: they forward the caller's SecHQ JWT to MyAccountant (shared JWT_SECRET)
 * to provision an org / mint an SSO session, and persist the resulting
 * accounting_org_id on the tenant. MyAccountant remains the accounting engine;
 * the dashboard's Accounting tab embeds its UI via the SSO url returned here.
 */
import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import {
  type AppRequest,
  requireAuth,
  requireTenantId,
  withHandler,
  logEvent,
} from '../middleware';

const MYACCOUNTANT_API_URL = process.env.MYACCOUNTANT_API_URL ?? 'http://localhost:4101';
const MYACCOUNTANT_DASHBOARD_URL =
  process.env.MYACCOUNTANT_DASHBOARD_URL ?? 'http://localhost:4100';
const FETCH_TIMEOUT_MS = 15_000;

function callerToken(req: AppRequest): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/** POST JSON to MyAccountant with a timeout; returns the parsed body or throws. */
async function callMyAccountant(
  path: string,
  init: { method: string; token?: string; body?: unknown }
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${MYACCOUNTANT_API_URL}${path}`, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.success === false) {
      throw new Error(typeof data.error === 'string' ? data.error : `MyAccountant ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('MyAccountant request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function registerAccountingRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
): void {
  // Ungated status read — lets the Accounting tab show an upsell when off.
  app.get(
    '/accounting/enabled',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireAuth(req, reply)) return;
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const res = await withTenantClient(tenantId, (client) =>
        client.query(
          'SELECT accounting_enabled, accounting_org_id FROM tenants WHERE tenant_id = $1',
          [tenantId]
        )
      );
      const row = res.rows[0] as
        | { accounting_enabled?: boolean; accounting_org_id?: string }
        | undefined;
      return reply.send({
        success: true,
        accounting_enabled: row?.accounting_enabled ?? false,
        accounting_org_id: row?.accounting_org_id ?? null,
      });
    }, 'Failed to read accounting status')
  );

  // Enable the add-on: provision a MyAccountant org for this tenant + user,
  // store the org id. Owner-only. (Prod also drives this from the Stripe webhook.)
  app.post(
    '/accounting/provision',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireAuth(req, reply)) return;
      if (req.auth!.role !== 'owner') {
        return reply.status(403).send({ success: false, error: 'Owner only' });
      }
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const provisioned = await callMyAccountant('/api/v1/integration/shq/provision', {
        method: 'POST',
        token: callerToken(req),
        body: {},
      });
      const orgId = provisioned.org_id as string;

      await withTenantClient(tenantId, (client) =>
        client.query(
          'UPDATE tenants SET accounting_enabled = true, accounting_org_id = $1 WHERE tenant_id = $2',
          [orgId, tenantId]
        )
      );
      logEvent(req, 'accounting_provisioned', { tenantId, orgId });
      return reply.send({ success: true, accounting_org_id: orgId });
    }, 'Failed to provision accounting')
  );

  // SSO url for the embedded iframe. Exchanges the caller's SecHQ token for a
  // MyAccountant session and returns a dashboard URL that lands logged in.
  app.get(
    '/accounting/sso-url',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireAuth(req, reply)) return;
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, (client) =>
        client.query('SELECT accounting_enabled FROM tenants WHERE tenant_id = $1', [tenantId])
      );
      const enabled = (res.rows[0] as { accounting_enabled?: boolean } | undefined)
        ?.accounting_enabled;
      if (!enabled) {
        return reply.status(402).send({ success: false, error: 'Accounting add-on required' });
      }

      const sso = await callMyAccountant('/api/v1/auth/sso', {
        method: 'POST',
        body: { token: callerToken(req) },
      });
      const url = `${MYACCOUNTANT_DASHBOARD_URL}/sso?token=${encodeURIComponent(
        sso.access_token as string
      )}&refresh=${encodeURIComponent(sso.refresh_token as string)}&org=${encodeURIComponent(
        sso.org_id as string
      )}`;
      return reply.send({ success: true, url });
    }, 'Failed to build accounting SSO url')
  );
}
