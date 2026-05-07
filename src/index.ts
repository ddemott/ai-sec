import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { collectStartupWarnings } from './services/envWarnings';
import multipart from '@fastify/multipart';
import { getPool, closePool, createWithTenantClient } from './database';
import { buildLogger } from './services/logger';
import fs from 'node:fs';
import path from 'node:path';

import { registerAuthRoutes } from './routes/auth';
import { registerTenantRoutes } from './routes/tenants';
import { registerAppointmentRoutes } from './routes/appointments';
import { registerCustomerRoutes } from './routes/customers';
import { registerEmployeeRoutes } from './routes/employees';
import { registerUserRoutes } from './routes/users';
import { registerShiftRoutes } from './routes/shifts';
import { registerResourceRoutes } from './routes/resources';
import { registerServiceRoutes } from './routes/services';
import { registerMappingRoutes } from './routes/mappings';
import { registerSkillRoutes } from './routes/skills';
import { registerCalendarRoutes } from './routes/calendar';
import { registerKnowledgeRoutes } from './routes/knowledge';
import { registerAnalyticsRoutes } from './routes/analytics';
import { registerVocabularyRoutes } from './routes/vocabulary';
import { registerBillingRoutes, subscriptionGate } from './routes/billing';
import { registerProvisioningRoutes } from './routes/provisioning';
import { registerJobberRoutes } from './routes/jobber';
import { registerHubSpotRoutes } from './routes/hubspot';
import { registerSquareRoutes } from './routes/square';
import { registerServiceTitanRoutes } from './routes/servicetitan';
import { registerAgentToolRoutes } from './routes/agentTools';
import { registerVoiceRoutes } from './routes/voice';
import { registerVersionHistoryRoutes } from './routes/versionHistory';
import { registerCommunicationRoutes } from './routes/communications';
import { registerReminderRoutes } from './routes/reminders';
import { TelnyxNumbersClient } from './services/telnyxNumbers';
import { startReminderScheduler, stopReminderScheduler } from './workers/reminderScheduler';
import { createGetEmbedding } from '../shared/getEmbedding';
import { createNormalizer } from '../shared/normalizeForEmbedding';
import { tenantMiddleware, generateToken, registerJwtAuthHook } from './middleware';

// --- Environment Validation ---
// Fail fast on missing required env vars in production
const isProduction = process.env.NODE_ENV === 'production';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || '';
const TELNYX_SIP_CONNECTION_ID = process.env.TELNYX_SIP_CONNECTION_ID || '';

if (isProduction) {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (missing.length > 0) {
    console.error(`FATAL: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  // Warn for optional-but-important vars. Logic lives in envWarnings.ts
  // so the warning list is testable without booting the full server.
  for (const warning of collectStartupWarnings({
    env: process.env,
    TELNYX_API_KEY,
    TELNYX_SIP_CONNECTION_ID,
  })) {
    console.warn(`WARNING: ${warning}`);
  }
}

const getEmbedding = createGetEmbedding(OPENAI_API_KEY);
const normalizeForEmbedding = createNormalizer(OPENAI_API_KEY);

// --- Server Setup ---

const useHttps = process.env.NODE_ENV !== 'production';
const certDir = path.resolve(__dirname, '..', '..', 'certs');
const logger = buildLogger({ service: 'ai-sec-backend' });
const app = Fastify(
  (useHttps
    ? {
        logger,
        https: {
          key: fs.readFileSync(path.join(certDir, 'localhost-key.pem')),
          cert: fs.readFileSync(path.join(certDir, 'localhost-cert.pem')),
        },
      }
    : { logger }) as any
);

// Enforce HTTPS when behind a proxy
app.addHook('onRequest', async (request, reply) => {
  const protoHeader = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (proto && proto !== 'https') {
    const hostHeader = request.headers['host'];
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    if (host) {
      const url = `https://${host}${request.raw.url}`;
      return reply.redirect(url);
    }
  }
});

app.register(helmet, {
  contentSecurityPolicy: false, // CSP managed by frontend framework
});

app.register(cors, {
  origin: process.env.CORS_ORIGIN || true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1', '::1'],
});

app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- Raw Body Preservation for Stripe Webhooks ---
// Stripe signature verification requires the raw request body.
// This content-type parser preserves the raw buffer for webhook routes.
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify content parser types require raw request access
  async (req: any, rawBody: Buffer) => {
    // Store raw body for webhook signature verification
    req.rawBody = rawBody;
    // Parse JSON normally
    try {
      return JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('Invalid JSON');
    }
  }
);

// --- Database Pool ---
// Single shared pool (see src/database/index.ts) — same instance is used by
// every Fastify route, the reminder scheduler, and the communications
// service, so deadlock-prevention timeouts apply everywhere. RLS is
// enforced via FORCE ROW LEVEL SECURITY on all tables + set_tenant_context()
// GUC. Works on both local Docker and Supabase.

const pool = getPool();
const withTenantClient = createWithTenantClient(pool);

// --- Auth + Tenant Middleware ---
registerJwtAuthHook(app as any, pool);
tenantMiddleware(app as any);

// --- Subscription Gate (after auth, before routes) ---
app.addHook('onRequest', subscriptionGate(pool));

// --- Global Error Handler ---
app.setErrorHandler(async (error: Error & { statusCode?: number; code?: string }, _request: unknown, reply: { status: (code: number) => { send: (body: Record<string, unknown>) => void } }) => {
  const statusCode = error.statusCode || 500;
  const code = error.code;
  if (code === 'TENANT_NOT_FOUND') {
    return reply.status(404).send({ success: false, error: error.message, code: 'TENANT_NOT_FOUND' });
  }
  app.log.error({
    event: 'unhandled_error',
    error_message: error.message,
    error_code: code || null,
    error_stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    statusCode,
    timestamp: new Date().toISOString(),
  }, `unhandled_error: ${error.message}`);
  return reply.status(statusCode).send({ success: false, error: error.message || 'Internal server error' });
});

// --- Health & Admin ---

app.get('/', async (_req, reply) => {
  const htmlPath = path.resolve(__dirname, '..', '..', 'public', 'index.html');
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://localhost:4000';
  const html = fs.readFileSync(htmlPath, 'utf-8')
    .replace(/\{\{DASHBOARD_URL\}\}/g, dashboardUrl);
  reply.type('text/html').send(html);
});
app.get('/demo', async (_req, reply) => {
  const htmlPath = path.resolve(__dirname, '..', '..', 'public', 'secretaryhq-demo.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  reply.type('text/html').send(html);
});
app.get('/health', async () => ({ status: 'ok' }));

app.post('/admin/purge-soft-reservations', async (_req, reply) => {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT purge_expired_soft_reservations() as deleted_count');
    return reply.send({ success: true, deleted_count: res.rows[0].deleted_count });
  } catch (err) {
    app.log.error({
      event: 'purge_soft_reservations_failed',
      error_message: (err as Error).message,
      error_stack: (err as Error).stack?.split('\n').slice(0, 5).join('\n'),
      timestamp: new Date().toISOString(),
    }, `purge_soft_reservations_failed: ${(err as Error).message}`);
    return reply.status(500).send({ success: false, error: 'Failed to purge soft reservations' });
  } finally {
    client.release();
  }
});

// --- Register Route Modules ---

registerAuthRoutes(app, pool, generateToken);
registerTenantRoutes(app, pool);
registerAppointmentRoutes(app, pool, withTenantClient);
registerCustomerRoutes(app, pool, withTenantClient);
registerEmployeeRoutes(app, pool, withTenantClient);
registerUserRoutes(app, pool, withTenantClient);
registerShiftRoutes(app, pool, withTenantClient);
registerResourceRoutes(app, pool, withTenantClient);
registerServiceRoutes(app, pool, withTenantClient);
registerMappingRoutes(app, pool, withTenantClient);
registerSkillRoutes(app, pool, withTenantClient);
registerCalendarRoutes(app, pool, withTenantClient);
registerKnowledgeRoutes(app, pool, getEmbedding, withTenantClient, normalizeForEmbedding);
registerAnalyticsRoutes(app, pool, withTenantClient);
registerVocabularyRoutes(app, pool, withTenantClient);
registerBillingRoutes(app, pool);

const telnyxProvisioning = (TELNYX_API_KEY && TELNYX_SIP_CONNECTION_ID)
  ? { client: new TelnyxNumbersClient(TELNYX_API_KEY), sipConnectionId: TELNYX_SIP_CONNECTION_ID }
  : null;
registerProvisioningRoutes(app, pool, telnyxProvisioning);
registerJobberRoutes(app, pool, withTenantClient);
registerHubSpotRoutes(app, pool, withTenantClient);
registerSquareRoutes(app, pool, withTenantClient);
registerServiceTitanRoutes(app, pool, withTenantClient);
registerVoiceRoutes(app, pool, withTenantClient);
registerVersionHistoryRoutes(app, pool, withTenantClient);
registerCommunicationRoutes(app, pool, withTenantClient);
registerReminderRoutes(app, pool, withTenantClient);
registerAgentToolRoutes(app, pool, withTenantClient, getEmbedding, normalizeForEmbedding);

// --- Start Reminder Scheduler ---
// Only start in production or if explicitly enabled
if (isProduction || process.env.ENABLE_REMINDER_SCHEDULER === 'true') {
  startReminderScheduler();
}

// --- Start Server ---

const port = Number(process.env.PORT || 4001);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Server listening on port ${port}`);
  })
  .catch((err) => {
    app.log.error({
      event: 'server_startup_failed',
      error_message: (err as Error).message,
      error_stack: (err as Error).stack?.split('\n').slice(0, 5).join('\n'),
      port,
      timestamp: new Date().toISOString(),
    }, `server_startup_failed: ${(err as Error).message}`);
    process.exit(1);
  });

// Graceful shutdown — Railway sends SIGTERM during deploys
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down...`);
    stopReminderScheduler();
    await app.close();
    await closePool();
    process.exit(0);
  });
}
