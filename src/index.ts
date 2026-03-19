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

// --- Database Pools ---

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

const apiPool = isLocal ? new Pool({
  user: 'api_user',
  host: 'localhost',
  database: 'postgres',
  password: 'api_password',
  port: 5433,
}) : new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/postgres:\/\/[^:]+:[^@]+@/, 'postgres://api_user:api_password@'),
  ssl: { rejectUnauthorized: false },
});

async function withTenantClient<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await apiPool.connect();
  try {
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

// --- Subscription Gate (after auth, before routes) ---
app.addHook('onRequest', subscriptionGate(pool));

// --- Health & Admin ---

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
