import Fastify from 'fastify';
import cors from '@fastify/cors';
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
import { createGetEmbedding } from '../shared/getEmbedding';
import { createNormalizer } from '../shared/normalizeForEmbedding';
import { tenantMiddleware } from './middleware';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

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
      return reply.redirect(301, url);
    }
  }
});

app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 },
});

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

const PUBLIC_ROUTES = ['/health', '/login', '/', '/billing/webhook'];
app.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') return;
  const urlPath = request.url.split('?')[0];
  if (PUBLIC_ROUTES.includes(urlPath)) return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
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
    return reply.status(404).send({ error: error.message, code: 'TENANT_NOT_FOUND' });
  }
  app.log.error(error);
  return reply.status(statusCode).send({ error: error.message || 'Internal server error' });
});

// --- Health & Admin ---

app.get('/', async (_req, reply) => {
  reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SecretaryHQ</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { text-align: center; max-width: 600px; padding: 2rem; }
    .logo { font-size: 3rem; font-weight: 700; background: linear-gradient(135deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; }
    .tagline { font-size: 1.25rem; color: #94a3b8; margin-bottom: 2rem; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; background: #1e293b; border: 1px solid #334155; border-radius: 9999px; padding: 0.5rem 1.25rem; font-size: 0.875rem; color: #94a3b8; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .features { margin-top: 2.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; text-align: left; }
    .feature { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1.25rem; }
    .feature h3 { font-size: 0.875rem; font-weight: 600; color: #e2e8f0; margin-bottom: 0.25rem; }
    .feature p { font-size: 0.75rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">SecretaryHQ</div>
    <div class="tagline">AI-Powered Reception for Service Businesses</div>
    <div class="status"><span class="dot"></span> API Online</div>
    <div class="features">
      <div class="feature"><h3>Voice AI</h3><p>Handles inbound calls, books appointments, answers questions</p></div>
      <div class="feature"><h3>Smart Scheduling</h3><p>Staff skills, resource availability, shift coverage</p></div>
      <div class="feature"><h3>Knowledge Base</h3><p>RAG-powered answers from your business docs</p></div>
      <div class="feature"><h3>Multi-Tenant</h3><p>One platform, unlimited businesses</p></div>
    </div>
  </div>
</body>
</html>`);
});
app.get('/health', async () => ({ status: 'ok' }));

app.post('/admin/purge-soft-reservations', async (req, reply) => {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT purge_expired_soft_reservations() as deleted_count');
    return reply.send({ success: true, deleted_count: res.rows[0].deleted_count });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to purge soft reservations' });
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

// --- Start Server ---

const port = Number(process.env.PORT || 3000);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Server listening on port ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
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
