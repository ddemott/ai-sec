import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { Pool, PoolClient } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

import { registerAuthRoutes } from './routes/auth';
import { registerTenantRoutes } from './routes/tenants';
import { registerAppointmentRoutes } from './routes/appointments';
import { registerCustomerRoutes } from './routes/customers';
import { registerEmployeeRoutes } from './routes/employees';
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
import { VapiClient } from './services/vapiClient';
import { createGetEmbedding } from '../shared/getEmbedding';
import { createNormalizer } from '../shared/normalizeForEmbedding';
import { tenantMiddleware } from './middleware';

// --- Environment Validation ---
// Fail fast on missing required env vars in production
const isProduction = process.env.NODE_ENV === 'production';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? '' : 'dev-jwt-secret-change-in-production');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const VAPI_API_KEY = process.env.VAPI_API_KEY || '';
const VAPI_SERVER_URL = process.env.VAPI_SERVER_URL || 'https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools';
const VAPI_SERVER_URL_SECRET = process.env.VAPI_SERVER_URL_SECRET || '';

if (isProduction) {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!JWT_SECRET) missing.push('JWT_SECRET');
  if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (missing.length > 0) {
    console.error(`FATAL: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  // Warn for optional but important vars
  if (!VAPI_API_KEY) console.warn('WARNING: VAPI_API_KEY not set — phone provisioning disabled');
  if (!VAPI_SERVER_URL_SECRET) console.warn('WARNING: VAPI_SERVER_URL_SECRET not set — webhook auth disabled');
  if (!process.env.GOOGLE_CLIENT_ID) console.warn('WARNING: GOOGLE_CLIENT_ID not set — Google Calendar sync disabled');
}

const getEmbedding = createGetEmbedding(OPENAI_API_KEY);
const normalizeForEmbedding = createNormalizer(OPENAI_API_KEY);

// --- Server Setup ---

const useHttps = process.env.NODE_ENV !== 'production';
const certDir = path.resolve(__dirname, '..', '..', 'certs');
const app = Fastify(
  (useHttps
    ? {
        logger: true,
        https: {
          key: fs.readFileSync(path.join(certDir, 'localhost-key.pem')),
          cert: fs.readFileSync(path.join(certDir, 'localhost-cert.pem')),
        },
      }
    : { logger: true }) as any
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
// Single pool using postgres role. RLS is enforced via FORCE ROW LEVEL SECURITY
// on all tables + set_tenant_context() GUC. Works on both local Docker and Supabase.

const isLocal = process.env.DATABASE_URL?.includes('localhost') || !process.env.DATABASE_URL;
const pool = isLocal ? new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres',
  password: 'postgres',
  port: 5433,
}) : new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function withTenantClient<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    // Validate tenant exists (before setting context, so RLS doesn't block the check)
    const tenantCheck = await client.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
    if (tenantCheck.rows.length === 0) {
      const err = new Error(`Tenant ${tenantId} not found`);
      (err as unknown as { statusCode: number }).statusCode = 404;
      (err as unknown as { code: string }).code = 'TENANT_NOT_FOUND';
      throw err;
    }
    // Set tenant context — RLS policies filter by this GUC
    await client.query('SELECT set_tenant_context($1::UUID)', [tenantId]);
    return await fn(client);
  } finally {
    await client.query("SELECT set_config('app.current_tenant_id', '', false)").catch(() => {});
    client.release();
  }
}

// --- Auth ---

function generateToken(payload: { tenant_id: string; user_id: string; email: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY as any });
}

function verifyToken(token: string): { tenant_id: string; user_id: string; email: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

const PUBLIC_ROUTES = [
  '/health', '/login', '/', '/demo',
  '/billing/webhook',
  // OAuth callbacks (redirects from external providers — no JWT available)
  '/calendar/auth/google/callback',
  '/calendar/auth/outlook/callback',
  '/hubspot/auth/callback',
  '/jobber/auth/callback',
  '/square/auth/callback',
  '/servicetitan/auth/callback',
  // CRM webhooks (authenticated via HMAC/signature, not JWT)
  '/hubspot/webhook',
  '/square/webhook',
  '/servicetitan/webhook',
];
app.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') return;
  const urlPath = request.url.split('?')[0];
  if (PUBLIC_ROUTES.includes(urlPath) || urlPath.startsWith('/jobber/webhook/')) return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    request.log.warn({ url: request.url, ip: request.ip }, 'JWT verification failed — invalid or expired token');
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }

  (request as any).auth = decoded;
});

// --- Tenant Context Middleware (extracts tenant_id, enriches logger) ---
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
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://localhost:3001';
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

const vapiClient = VAPI_API_KEY
  ? new VapiClient(VAPI_API_KEY, VAPI_SERVER_URL, VAPI_SERVER_URL_SECRET)
  : null;
registerProvisioningRoutes(app, pool, vapiClient);
registerJobberRoutes(app, pool, withTenantClient);
registerHubSpotRoutes(app, pool, withTenantClient);
registerSquareRoutes(app, pool, withTenantClient);
registerServiceTitanRoutes(app, pool, withTenantClient);

// --- Start Server ---

const port = Number(process.env.PORT || 3000);

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
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
