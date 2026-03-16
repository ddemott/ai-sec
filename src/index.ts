import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import pdfParse from 'pdf-parse';
import { Pool, PoolClient } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { InMemoryBookingStorage } from './storage/inMemoryBookingStorage';
import { LoggingTelephonyProvider } from './providers/loggingTelephonyProvider';
import { ConsoleNotificationProvider } from './providers/consoleNotificationProvider';
import { BookingService } from './services/bookingService';
import { MockLlmProvider } from './services/mockLlmProvider';
import type { TimeWindow } from './core/models';
import { z } from 'zod';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

/**
 * Helper to generate embeddings via OpenAI
 */
async function getEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured in environment');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input: text.replace(/\n/g, ' '),
      model: 'text-embedding-3-small',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI Embedding Error: ${JSON.stringify(error)}`);
  }

  const result = await response.json() as any;
  return result.data[0].embedding;
}

const useHttps = process.env.NODE_ENV !== 'production';

const certDir = path.resolve(__dirname, '..', 'certs');
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

// Enforce HTTPS when behind a proxy that sets x-forwarded-proto.
// This is noop for local/tests (no header), but in production any HTTP
// request proxied to this service will be 301-redirected to HTTPS.
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

// Register CORS
app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Register Multipart for file uploads
app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Database Connection
const isLocal = process.env.DATABASE_URL?.includes('localhost') || !process.env.DATABASE_URL;
const pool = isLocal ? new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres',
  password: 'postgres',
  port: 5433,
}) : new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// BUG-007: RLS-enforced pool using api_user (subject to row-level security)
const apiPool = isLocal ? new Pool({
  user: 'api_user',
  host: 'localhost',
  database: 'postgres',
  password: 'api_password',
  port: 5433,
}) : new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/postgres:\/\/[^:]+:[^@]+@/, 'postgres://api_user:api_password@'),
  ssl: { rejectUnauthorized: false }
});

/**
 * BUG-007: Execute a query with RLS tenant isolation.
 * Gets a connection from the api_user pool, sets tenant context, runs the callback.
 */
async function withTenantClient<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await apiPool.connect();
  try {
    await client.query('SELECT set_tenant_context($1::UUID)', [tenantId]);
    return await fn(client);
  } finally {
    // Reset the tenant context before returning client to pool
    await client.query("SELECT set_config('app.current_tenant_id', '', false)").catch(() => {});
    client.release();
  }
}

/**
 * BUG-012: JWT authentication helper
 */
function generateToken(payload: { tenant_id: string; user_id: string; email: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token: string): { tenant_id: string; user_id: string; email: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

// BUG-011: Input validation schemas for critical endpoints
const CustomerCreateSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  phone: z.string().min(1).max(30),
  email: z.string().email().optional().nullable(),
  first_name: z.string().max(100).optional().nullable(),
  last_name: z.string().max(100).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  address_line2: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  postal_code: z.string().max(20).optional().nullable(),
  timezone: z.string().max(50).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

const AppointmentCreateSchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  description: z.string().min(1).max(1000),
  location: z.string().max(500).optional().nullable(),
  employee_id: z.union([z.string(), z.number()]).optional().nullable(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Core wiring
const storage = new InMemoryBookingStorage();
const telephony = new LoggingTelephonyProvider();
const notifications = new ConsoleNotificationProvider(telephony, '+10000000000');
const bookingService = new BookingService(storage, notifications);
const llm = new MockLlmProvider();

app.get('/health', async () => ({ status: 'ok' }));

// BUG-013: Purge expired soft reservations (callable via cron or admin)
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

// BUG-012: JWT authentication preHandler for protected routes
// Extracts tenant_id from JWT and attaches to request
const PUBLIC_ROUTES = ['/health', '/login', '/'];
app.addHook('onRequest', async (request, reply) => {
  // Skip auth for public routes and OPTIONS
  if (request.method === 'OPTIONS') return;
  const urlPath = request.url.split('?')[0];
  if (PUBLIC_ROUTES.includes(urlPath)) return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Allow unauthenticated requests for backward compatibility during migration
    // TODO: Once all clients send JWT, return 401 here
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  // Attach auth context to request for downstream use
  (request as any).auth = decoded;
});

// Login endpoint for multi-tenancy (BUG-011: validated)
app.post('/login', async (req, reply) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ success: false, error: 'Invalid email or password format' });
  }
  const { email, password } = parsed.data;
  const client = await pool.connect();
  try {
    // Fetch user by email
    const res = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    const user = res.rows[0];
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid email or password'
      });
    }
    // Use bcrypt to compare password
    const bcrypt = await import('bcrypt');
    const match = await bcrypt.compare(password, user.password_hash);
    if (match) {
      const token = generateToken({
        tenant_id: user.tenant_id,
        user_id: user.id,
        email: user.email,
      });
      return reply.send({
        success: true,
        tenant_id: user.tenant_id,
        user_id: user.id,
        user_name: user.full_name,
        token,
      });
    } else {
      return reply.status(401).send({
        success: false,
        error: 'Invalid email or password'
      });
    }
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// NEW: List all Tenants (Super-Admin only)
app.get('/tenants', async (req, reply) => {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM tenants ORDER BY created_at DESC');
        app.log.info(`Found ${res.rows.length} tenants`);
        return reply.send(res.rows);
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to fetch tenants' });
    } finally {
        client.release();
    }
});

// NEW: Update Tenant attributes (Super-Admin only)
// NEW: Delete a Tenant (Super-Admin only)
app.delete('/tenants/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
        await client.query('DELETE FROM tenants WHERE id = $1', [id]);
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete tenant' });
    } finally {
        client.release();
    }
});

// NEW: Delete an Appointment (BUG-007: now tenant-scoped via RLS)
app.delete('/appointments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
        await withTenantClient(tenantId, async (client) => {
            await client.query('DELETE FROM appointments WHERE id = $1', [id]);
        });
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete appointment' });
    }
});

// NEW: Delete a Customer (BUG-007: now tenant-scoped via RLS)
app.delete('/customers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
        await withTenantClient(tenantId, async (client) => {
            await client.query('DELETE FROM customers WHERE id = $1', [id]);
        });
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete customer' });
    }
});

// NEW: Manual Appointment Creation (BUG-007 + BUG-011: validated + RLS-enforced)
app.post('/appointments/create', async (req, reply) => {
  const parsed = AppointmentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
  }
  const body = parsed.data;

  try {
    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        'SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          body.tenant_id,
          body.resource_id,
          body.customer_id,
          body.start_time,
          body.end_time,
          body.description,
          'manual-entry',
          body.location || null,
          body.employee_id ? body.employee_id.toString() : null
        ]
      );
    });
    const result = res.rows[0];
    if (result.success) {
      return reply.send({ success: true, appointment_id: result.appointment_id });
    } else {
      return reply.status(400).send({ success: false, error: result.error_message });
    }
  } catch (err: any) {
    app.log.error(err);
    if (err.code === '22P02') {
      return reply
      .status(400)
      .send({ success: false, error: 'Invalid identifier or time format', detail: err.detail });
    }
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// NEW: List Appointments for a tenant (BUG-007: RLS-enforced for non-admin, BUG-020: pagination)
app.get('/appointments', async (req, reply) => {
  const tenantId = (req.query as any)['tenant_id'];
  const limit = Math.min(parseInt((req.query as any)['limit']) || 200, 1000);
  const offset = parseInt((req.query as any)['offset']) || 0;

  if (!tenantId) {
    return reply.status(400).send({ error: 'tenant_id is required' });
  }

  const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

  const baseQuery = `
    SELECT
       a.*,
       COALESCE(a.employee_id::text, a.assigned_to_user_id::text) as employee_id,
       jsonb_build_object(
         'name', c.name,
         'first_name', c.first_name,
         'last_name', c.last_name,
         'phone', c.phone,
         'metadata', c.metadata
       ) AS customers,
       jsonb_build_object(
         'name', r.name
       ) AS resources
     FROM appointments a
     LEFT JOIN customers c ON c.id = a.customer_id
     LEFT JOIN resources r ON r.id = a.resource_id
     ${isSuperAdmin ? '' : 'WHERE a.tenant_id = $1'}
     ORDER BY a.start_time ASC`;

  try {
    if (isSuperAdmin) {
      const client = await pool.connect();
      try {
        const res = await client.query(`${baseQuery} LIMIT $1 OFFSET $2`, [limit, offset]);
        return reply.send(res.rows);
      } finally {
        client.release();
      }
    } else {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(`${baseQuery} LIMIT $2 OFFSET $3`, [tenantId, limit, offset]);
      });
      return reply.send(res.rows);
    }
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch appointments' });
  }
});

// Calendar sync stub endpoint for future Outlook/Google integrations
app.post('/calendar/sync', async (req, reply) => {
  const body = req.body as any;
  // For now we just acknowledge receipt; provider-specific handling will be added later
  return reply.status(202).send({ status: 'accepted', source: body?.provider || 'unknown' });
});

// NEW: Get Resources for a tenant
app.get('/resources', async (req, reply) => {
  const tenantId = (req.query as any)['tenant_id'];
  const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;
  
    const client = await pool.connect();
    try {
        const query = isSuperAdmin 
          ? 'SELECT * FROM resources' 
          : 'SELECT * FROM resources WHERE tenant_id = $1';
        const res = isSuperAdmin
          ? await client.query(query)
          : await client.query(query, [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        return reply.status(500).send({ error: 'Failed to fetch resources' });
    } finally {
        client.release();
    }
});

// NEW: Create a resource (bay / service unit) for a tenant
app.post('/resources/create', async (req, reply) => {
  const body = req.body as { tenant_id: string; name: string; description?: string };

  if (!body.tenant_id || !body.name) {
    return reply.status(400).send({ success: false, error: 'tenant_id and name are required' });
  }

  const client = await pool.connect();
  try {
    const res = await client.query(
      'INSERT INTO resources (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [body.tenant_id, body.name, body.description || null]
    );
    return reply.send({ success: true, resource: res.rows[0] });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ success: false, error: 'Failed to create resource' });
  } finally {
    client.release();
  }
});

// NEW: Update basic resource attributes (name, description, active flag)
app.post('/resources/:id/update', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { name?: string; description?: string; is_active?: boolean };

  const client = await pool.connect();
  try {
    const fields: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      fields.push('name');
      values.push(body.name);
    }
    if (body.description !== undefined) {
      fields.push('description');
      values.push(body.description || null);
    }
    if (body.is_active !== undefined) {
      fields.push('is_active');
      values.push(body.is_active);
    }

    if (fields.length === 0) {
      return reply.status(400).send({ success: false, error: 'No updatable fields provided' });
    }

    const setClause = fields
      .map((field, index) => `${field} = $${index + 1}`)
      .join(', ');

    values.push(id);

    await client.query(`UPDATE resources SET ${setClause} WHERE id = $${values.length}`, values);

    return reply.send({ success: true });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ success: false, error: 'Failed to update resource' });
  } finally {
    client.release();
  }
});

// NEW: Get Customers for a tenant (BUG-007: RLS-enforced for non-admin, BUG-020: pagination)
app.get('/customers', async (req, reply) => {
  const tenantId = (req.query as any)['tenant_id'];
  const limit = Math.min(parseInt((req.query as any)['limit']) || 200, 1000);
  const offset = parseInt((req.query as any)['offset']) || 0;

  if (!tenantId) {
    return reply.status(400).send({ error: 'tenant_id is required' });
  }

  const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

  try {
    if (isSuperAdmin) {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT * FROM customers ORDER BY name LIMIT $1 OFFSET $2', [limit, offset]);
        return reply.send(res.rows);
      } finally {
        client.release();
      }
    } else {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query('SELECT * FROM customers WHERE tenant_id = $1 ORDER BY name LIMIT $2 OFFSET $3', [tenantId, limit, offset]);
      });
      return reply.send(res.rows);
    }
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch customers' });
  }
});

// NEW: Manual Customer Creation (BUG-007 + BUG-011: validated + RLS-enforced)
app.post('/customers/create', async (req, reply) => {
    const parsed = CustomerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

    try {
        const res = await withTenantClient(body.tenant_id, async (client) => {
            return client.query(
                `INSERT INTO customers (
                   tenant_id, name, phone, email, address, address_line2,
                   city, state, postal_code, metadata, first_name, last_name, timezone
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [
                  body.tenant_id,
                  body.name,
                  body.phone,
                  body.email || null,
                  body.address || null,
                  body.address_line2 || null,
                  body.city || null,
                  body.state || null,
                  body.postal_code || null,
                  body.metadata || {},
                  body.first_name || null,
                  body.last_name || null,
                  body.timezone || 'America/New_York'
                ]
            );
        });
        return reply.send({ success: true, customer: res.rows[0] });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to create customer' });
    }
});

// NEW: Update existing customer
app.put('/customers/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as any;
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE customers SET
         first_name = $1,
         last_name = $2,
         name = $3,
         phone = $4,
         email = $5,
         address = $6,
         address_line2 = $7,
         city = $8,
         state = $9,
         postal_code = $10,
         metadata = $11,
         timezone = $12
       WHERE id = $13`,
      [
        body.first_name || null,
        body.last_name || null,
        body.name || null,
        body.phone,
        body.email,
        body.address,
        body.address_line2 || null,
        body.city || null,
        body.state || null,
        body.postal_code || null,
        body.metadata || {},
        body.timezone || 'America/New_York',
        id
      ]
    );
    return reply.send({ success: true });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to update customer' });
  } finally {
    client.release();
  }
});



app.post('/tenants/:id/update-attributes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const client = await pool.connect();
    try {
        await client.query(
            `UPDATE tenants SET
                name = $1,
                business_type = $2,
                timezone = $3,
                voice_id = $4,
                system_prompt = $5,
                first_message = $6,
                owner_phone = $7,
                inbound_phone = $8
             WHERE id = $9`,
            [
                body.name,
                body.business_type,
                body.timezone,
                body.voice_id,
                body.system_prompt,
                body.first_message,
                body.owner_phone,
                body.inbound_phone,
                id
            ]
        );

        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to update tenant' });
    } finally {
        client.release();
    }
});

// --- Employees Management ---
app.get('/employees', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
        // We UNION employees (integer IDs) and users (UUID IDs). 
        // We cast IDs to TEXT to allow the UNION.
        const res = await client.query(`
            SELECT id::text, name, skills, is_active, 'employee' as type
            FROM employees 
            WHERE tenant_id = $1
            UNION ALL
            SELECT id::text, COALESCE(full_name, email) as name, '{}'::text[] as skills, true as is_active, 'user' as type
            FROM users
            WHERE tenant_id = $1
            ORDER BY name ASC
        `, [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to fetch employees' });
    } finally {
        client.release();
    }
});

app.post('/employees/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; skills?: string[] };
    const client = await pool.connect();
    try {
        const res = await client.query(
            'INSERT INTO employees (tenant_id, name, skills) VALUES ($1, $2, $3) RETURNING *',
            [body.tenant_id, body.name, body.skills || []]
        );
        return reply.send({ success: true, employee: res.rows[0] });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to create employee' });
    } finally {
        client.release();
    }
});

app.post('/employees/:id/update', async (req, reply) => {
    const id = (req.params as any).id;
    const body = req.body as { name?: string; skills?: string[]; is_active?: boolean };
    const client = await pool.connect();
    try {
        const res = await client.query(
            'UPDATE employees SET name = COALESCE($1, name), skills = COALESCE($2, skills), is_active = COALESCE($3, is_active), updated_at = NOW() WHERE id = $4 RETURNING *',
            [body.name, body.skills, body.is_active, id]
        );
        return reply.send({ success: true, employee: res.rows[0] });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to update employee' });
    } finally {
        client.release();
    }
});

// --- Shift Management ---
app.get('/shifts', async (req, reply) => {
  const tenantId = (req.query as any).tenant_id;
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM employee_shifts WHERE tenant_id = $1 ORDER BY day_of_week, start_time', [tenantId]);
    return reply.send(res.rows);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch shifts' });
  } finally {
    client.release();
  }
});

app.post('/shifts/create', async (req, reply) => {
  const body = req.body as { tenant_id: string; employee_id: number; day_of_week: number; start_time: string; end_time: string };
  const client = await pool.connect();
  try {
    const res = await client.query(
      'INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [body.tenant_id, body.employee_id, body.day_of_week, body.start_time, body.end_time]
    );
    return reply.send({ success: true, shift: res.rows[0] });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to create shift' });
  } finally {
    client.release();
  }
});

// BUG-047: Update shift times
app.post('/shifts/:id/update', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as { tenant_id: string; start_time?: string; end_time?: string; day_of_week?: number; is_active?: boolean };
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE employee_shifts SET
        start_time = COALESCE($1, start_time),
        end_time = COALESCE($2, end_time),
        day_of_week = COALESCE($3, day_of_week),
        is_active = COALESCE($4, is_active)
      WHERE id = $5 AND tenant_id = $6
      RETURNING *`,
      [body.start_time, body.end_time, body.day_of_week, body.is_active, id, body.tenant_id]
    );
    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Shift not found' });
    }
    return reply.send({ success: true, shift: res.rows[0] });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to update shift' });
  } finally {
    client.release();
  }
});

app.delete('/shifts/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const tenantId = (req.query as any).tenant_id;
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return reply.send({ success: true });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete shift' });
  } finally {
    client.release();
  }
});

// --- Calendar Settings ---
app.get('/calendar/settings', async (req, reply) => {
  const tenantId = (req.query as any).tenant_id;
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM tenant_calendar_settings WHERE tenant_id = $1', [tenantId]);
    return reply.send(res.rows[0] || null);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch calendar settings' });
  } finally {
    client.release();
  }
});

app.post('/calendar/settings', async (req, reply) => {
  const body = req.body as any;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO tenant_calendar_settings (tenant_id, provider, external_calendar_id, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (tenant_id) 
       DO UPDATE SET provider = $2, external_calendar_id = $3, is_active = true, updated_at = NOW()
       RETURNING *`,
      [body.tenant_id, body.provider, body.external_calendar_id]
    );
    return reply.send({ success: true, settings: res.rows[0] });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to update calendar settings' });
  } finally {
    client.release();
  }
});

app.post('/calendar/settings/disconnect', async (req, reply) => {
  const { tenant_id } = req.body as any;
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM tenant_calendar_settings WHERE tenant_id = $1', [tenant_id]);
    return reply.send({ success: true });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to disconnect calendar' });
  } finally {
    client.release();
  }
});

// --- Analytics ---
app.post('/analytics/stats', async (req, reply) => {
  // Existing analytics logic...
});

// --- Call Summaries (BUG-054: replace direct Supabase usage in dashboard) ---
app.get('/call-summaries', async (req, reply) => {
  const tenantId = (req.query as any).tenant_id;
  const customerId = (req.query as any).customer_id;
  if (!tenantId || !customerId) {
    return reply.status(400).send({ error: 'tenant_id and customer_id are required' });
  }
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT * FROM call_summaries WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC',
      [tenantId, customerId]
    );
    return reply.send(res.rows);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch call summaries' });
  } finally {
    client.release();
  }
});

// --- Master Skills Management ---
app.get('/skills', async (req, reply) => {
  const tenantId = (req.query as any).tenant_id;
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM tenant_skills WHERE tenant_id = $1 ORDER BY name', [tenantId]);
    return reply.send(res.rows);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch master skills' });
  } finally {
    client.release();
  }
});

app.post('/skills/create', async (req, reply) => {
  const body = req.body as { tenant_id: string; name: string; description?: string };
  const client = await pool.connect();
  try {
    const res = await client.query(
      'INSERT INTO tenant_skills (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [body.tenant_id, body.name.toLowerCase().trim().replace(/\s+/g, '-'), body.description]
    );
    return reply.send({ success: true, skill: res.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') return reply.status(400).send({ error: 'Skill already exists' });
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to create skill' });
  } finally {
    client.release();
  }
});

app.delete('/skills/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const tenantId = (req.query as any).tenant_id;
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return reply.send({ success: true });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete skill' });
  } finally {
    client.release();
  }
});

// --- Services Management ---
app.get('/services', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM services WHERE tenant_id = $1 ORDER BY name ASC', [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to fetch services' });
    } finally {
        client.release();
    }
});

app.post('/services/:id/update', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string; duration_minutes?: number; price?: number };
    const client = await pool.connect();
    try {
        const res = await client.query(
            'UPDATE services SET name = COALESCE($1, name), description = COALESCE($2, description), duration_minutes = COALESCE($3, duration_minutes), price = COALESCE($4, price), updated_at = NOW() WHERE id = $5 RETURNING *',
            [body.name, body.description, body.duration_minutes, body.price, id]
        );
        return reply.send({ success: true, service: res.rows[0] });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to update service' });
    } finally {
        client.release();
    }
});

app.delete('/services/:id/delete', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
        // Check for active appointments or mappings
        const mappings = await client.query(
            'SELECT (SELECT count(*) FROM service_resource WHERE service_id = $1) + (SELECT count(*) FROM service_employee WHERE service_id = $1) as count', 
            [id]
        );
        if (parseInt(mappings.rows[0].count) > 0) {
            return reply.status(400).send({ error: 'Cannot delete: Service is still mapped to staff or resources. Unassign them first.' });
        }
        
        await client.query('DELETE FROM services WHERE id = $1', [id]);
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete service' });
    } finally {
        client.release();
    }
});

app.post('/services/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string; duration_minutes: number; required_skills?: string[]; required_resources?: string[] };
    const client = await pool.connect();
    try {
        const res = await client.query(
            'INSERT INTO services (tenant_id, name, description, duration_minutes, required_skills, required_resources) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [body.tenant_id, body.name, body.description, body.duration_minutes, body.required_skills || [], body.required_resources || []]
        );
        return reply.send({ success: true, service: res.rows[0] });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to create service' });
    } finally {
        client.release();
    }
});

// --- Mappings ---
// --- Mappings Management ---
app.get('/mappings/service-resource', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM service_resource WHERE tenant_id = $1', [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to fetch resource mappings' });
    } finally {
        client.release();
    }
});

app.get('/mappings/service-employee', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM service_employee WHERE tenant_id = $1', [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to fetch employee mappings' });
    } finally {
        client.release();
    }
});

app.post('/services/:serviceId/employees/:employeeId/unassign', async (req, reply) => {
    const { serviceId, employeeId } = req.params as any;
    const { tenant_id } = req.body as any;
    const client = await pool.connect();
    try {
        await client.query(
            'DELETE FROM service_employee WHERE service_id = $1 AND employee_id = $2 AND tenant_id = $3',
            [serviceId, employeeId, tenant_id]
        );
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to unassign employee' });
    } finally {
        client.release();
    }
});

app.post('/services/:serviceId/employees/:employeeId/assign', async (req, reply) => {
    const { serviceId, employeeId } = req.params as any;
    const { tenant_id } = req.body as any;
    const client = await pool.connect();
    try {
        await client.query(
            'INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [serviceId, employeeId, tenant_id]
        );
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to assign employee to service' });
    } finally {
        client.release();
    }
});

app.post('/services/:serviceId/resources/:resourceId/unassign', async (req, reply) => {
    const { serviceId, resourceId } = req.params as any;
    const { tenant_id } = req.body as any;
    const client = await pool.connect();
    try {
        await client.query(
            'DELETE FROM service_resource WHERE service_id = $1 AND resource_id = $2 AND tenant_id = $3',
            [serviceId, resourceId, tenant_id]
        );
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to unassign resource' });
    } finally {
        client.release();
    }
});

app.post('/services/:serviceId/resources/:resourceId/assign', async (req, reply) => {
    const { serviceId, resourceId } = req.params as any;
    const { tenant_id } = req.body as any;
    const client = await pool.connect();
    try {
        await client.query(
            'INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [serviceId, resourceId, tenant_id]
        );
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to assign resource to service' });
    } finally {
        client.release();
    }
});

app.post('/services/:serviceId/resources/:resourceId/unassign', async (req, reply) => {
    const { serviceId, resourceId } = req.params as any;
    const { tenant_id } = req.body as any;
    const client = await pool.connect();
    try {
        await client.query(
            'DELETE FROM service_resource WHERE service_id = $1 AND resource_id = $2 AND tenant_id = $3',
            [serviceId, resourceId, tenant_id]
        );
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to unassign resource' });
    } finally {
        client.release();
    }
});

app.post('/services/:serviceId/employees/:employeeId/unassign', async (req, reply) => {
    const { serviceId, employeeId } = req.params as any;
    const { tenant_id } = req.body as any;
    const client = await pool.connect();
    try {
        await client.query(
            'DELETE FROM service_employee WHERE service_id = $1 AND employee_id = $2 AND tenant_id = $3',
            [serviceId, employeeId, tenant_id]
        );
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to unassign employee' });
    } finally {
        client.release();
    }
});

app.get('/mappings/service-resource', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM service_resource WHERE tenant_id = $1', [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to fetch resource mappings' });
    } finally {
        client.release();
    }
});

app.get('/mappings/service-employee', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM service_employee WHERE tenant_id = $1', [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to fetch employee mappings' });
    } finally {
        client.release();
    }
});

// NEW: Create a new Tenant and Owner
app.post('/tenants/create', async (req, reply) => {
  const body = req.body as {
    tenant_name: string;
    business_type: string;
    owner_first_name: string;
    owner_last_name: string;
    owner_email: string;
    owner_pass: string;
  };

  const client = await pool.connect();
  try {
    const firstName = (body.owner_first_name || '').trim();
    const lastName = (body.owner_last_name || '').trim();

    if (!firstName || !lastName) {
      client.release();
      return reply.status(400).send({ error: 'owner_first_name and owner_last_name are required' });
    }

    await client.query('BEGIN');

    // 1. Create Tenant (Trigger will apply business template defaults)
    const tenantRes = await client.query(
      'INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id',
      [body.tenant_name, body.business_type]
    );
    const tenantId = tenantRes.rows[0].id;

    // 2. Create Owner User with explicit first/last name
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const bcrypt = await import('bcrypt');
    const hashedPass = await bcrypt.hash(body.owner_pass, 10);

    await client.query(
      'INSERT INTO users (tenant_id, email, password_hash, full_name, first_name, last_name) VALUES ($1, $2, $3, $4, $5, $6)',
      [tenantId, body.owner_email, hashedPass, fullName, firstName || null, lastName || null]
    );

    await client.query('COMMIT');
    return reply.send({ success: true, tenant_id: tenantId });
  } catch (err) {
    await client.query('ROLLBACK');
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to create tenant' });
  } finally {
    client.release();
  }
});

// NEW: Get all templates for creation flow
app.get('/templates', async (req, reply) => {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT business_type, display_name FROM business_templates');
        return reply.send(res.rows);
    } catch (err) {
        return reply.status(500).send({ error: 'Failed to fetch templates' });
    } finally {
        client.release();
    }
});

// NEW: List all templates with full details
app.get('/templates/full', async (req, reply) => {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM business_templates');
        return reply.send(res.rows);
    } catch (err) {
        return reply.status(500).send({ error: 'Failed to fetch full templates' });
    } finally {
        client.release();
    }
});

// NEW: Get Tenant Config
app.get('/tenants/:id/config', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
        const res = await client.query(
            'SELECT id, name, business_type, system_prompt, voice_id, first_message FROM tenants WHERE id = $1',
            [id]
        );
        if (res.rows.length === 0) return reply.status(404).send({ error: 'Tenant not found' });
        return reply.send(res.rows[0]);
    } catch (err) {
        return reply.status(500).send({ error: 'Failed to fetch tenant config' });
    } finally {
        client.release();
    }
});

// NEW: Update Tenant Config
app.post('/tenants/:id/update-config', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const client = await pool.connect();
    try {
        await client.query(
            'UPDATE tenants SET system_prompt = $1, voice_id = $2, business_type = $3, first_message = $4 WHERE id = $5',
            [body.system_prompt, body.voice_id, body.business_type, body.first_message, id]
        );
        return reply.send({ success: true });
    } catch (err) {
        return reply.status(500).send({ error: 'Failed to update tenant config' });
    } finally {
        client.release();
    }
});

app.post('/appointments/:id/update', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as {
    tenant_id: string;
    start_time: string;
    end_time: string;
    description: string;
    location: string;
    resource_id: string;
    employee_id: string | number | null;
    customer_name: string;
    customer_phone: string;
    customer_notes: string;
  };

  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT * FROM update_appointment_customer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [
        id, 
        body.tenant_id, 
        body.start_time, 
        body.end_time, 
        body.description, 
        body.location, 
        body.resource_id,
        body.employee_id ? body.employee_id.toString() : null,
        body.customer_name, 
        body.customer_phone,
        body.customer_notes
      ]
    );

    const result = res.rows[0];
    if (result.success) {
      return reply.send({ success: true });
    } else {
      return reply.status(400).send({ success: false, error: result.error_message });
    }
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// --- Knowledge Base (RAG) ---
app.get('/knowledge', async (req, reply) => {
  const tenantId = (req.query as any).tenant_id;
  if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT id, title, content, source, created_at FROM tenant_docs WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    return reply.send(res.rows);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch knowledge base' });
  } finally {
    client.release();
  }
});

app.delete('/knowledge/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const tenantId = (req.query as any).tenant_id;
  if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

  const client = await pool.connect();
  try {
    await client.query('DELETE FROM tenant_docs WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return reply.send({ success: true });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete entry' });
  } finally {
    client.release();
  }
});

app.post('/knowledge/ingest', async (req, reply) => {
  const data = await req.file();
  if (!data) return reply.status(400).send({ error: 'No file uploaded' });

  // Fields are stored in data.fields
  const tenantId = (data.fields.tenant_id as any)?.value;
  if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

  const buffer = await data.toBuffer();
  const filename = data.filename;
  let text = '';

  try {
    if (filename.toLowerCase().endsWith('.pdf')) {
      let pdfData;
      pdfData = await (pdfParse as any)(buffer);
      text = pdfData.text;
    } else {
      text = buffer.toString('utf8');
    }

    if (!text || text.trim().length < 10) {
      return reply.status(400).send({ error: 'No readable text found in file' });
    }

    // Chunking logic (simple split by double newlines)
    const chunks = text.split('\n\n').filter(c => c.trim().length > 20);
    
    const client = await pool.connect();
    try {
      for (const chunk of chunks) {
        const trimmedChunk = chunk.trim();
        const embedding = await getEmbedding(trimmedChunk);
        
        await client.query(
          'INSERT INTO tenant_docs (tenant_id, content, source, embedding) VALUES ($1, $2, $3, $4::vector)',
          [tenantId, trimmedChunk, filename, JSON.stringify(embedding)]
        );
      }
      return reply.send({ success: true, chunksIngested: chunks.length });
    } finally {
      client.release();
    }
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: `Ingestion failed: ${err.message}` });
  }
});

// Existing chat endpoint
app.post('/chat', async (req, reply) => {
  const body = req.body as {
    phone: string;
    name?: string;
    address: string;
    message: string;
    tenant_id?: string;
  };

  const tenantId = body.tenant_id || 'f234e471-0e60-4163-86c9-93cfd9338e3a'; // Fallback to DynaTire PoC

  const now = new Date();
  const window: TimeWindow = {
    from: now,
    to: new Date(now.getTime() + 2 * 60 * 60 * 1000), // next 2 hours
  };

  const appointment = await bookingService.bookSimpleAppointment({
    tenantId: tenantId,
    resourceId: 'dynatire-resource', // In a real app, this would be looked up
    customerPhone: body.phone,
    customerName: body.name,
    address: body.address,
    description: body.message,
    window,
  });

  const aiReply = await llm.runSecretaryTurn({
    tenantId: tenantId,
    customerPhone: body.phone,
    message: body.message,
  });

  return reply.send({
    reply: aiReply.reply,
    appointment,
  });
});

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
