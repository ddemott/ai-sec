import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { InMemoryBookingStorage } from './storage/inMemoryBookingStorage';
import { LoggingTelephonyProvider } from './providers/loggingTelephonyProvider';
import { ConsoleNotificationProvider } from './providers/consoleNotificationProvider';
import { BookingService } from './services/bookingService';
import { MockLlmProvider } from './services/mockLlmProvider';
import type { TimeWindow } from './core/models';

const useHttps = process.env.NODE_ENV !== 'production';

const app = Fastify(
  useHttps
    ? {
        logger: true,
        https: {
          key: fs.readFileSync(path.join(__dirname, '..', 'certs', 'localhost-key.pem')),
          cert: fs.readFileSync(path.join(__dirname, '..', 'certs', 'localhost-cert.pem')),
        },
      }
    : { logger: true }
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

// Core wiring
const storage = new InMemoryBookingStorage();
const telephony = new LoggingTelephonyProvider();
const notifications = new ConsoleNotificationProvider(telephony, '+10000000000');
const bookingService = new BookingService(storage, notifications);
const llm = new MockLlmProvider();

app.get('/health', async () => ({ status: 'ok' }));

// Login endpoint for multi-tenancy
app.post('/login', async (req, reply) => {
  const { email, password } = req.body as any;

  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT * FROM authenticate_user($1, $2)',
      [email, password]
    );

    const auth = res.rows[0];

    if (auth && auth.success) {
      return reply.send({
        success: true,
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        user_name: auth.user_name
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

// NEW: Delete an Appointment
app.delete('/appointments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
        await client.query('DELETE FROM appointments WHERE id = $1', [id]);
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete appointment' });
    } finally {
        client.release();
    }
});

// NEW: Delete a Customer
app.delete('/customers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
        await client.query('DELETE FROM customers WHERE id = $1', [id]);
        return reply.send({ success: true });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete customer' });
    } finally {
        client.release();
    }
});

// NEW: Manual Appointment Creation
app.post('/appointments/create', async (req, reply) => {
    const body = req.body as any;
    const client = await pool.connect();
    try {
        const res = await client.query(
            'SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)',
            [
                body.tenant_id,
                body.resource_id,
                body.customer_id,
                body.start_time,
                body.end_time,
                body.description,
                'manual-entry',
                body.location
            ]
        );
        const result = res.rows[0];
        if (result.success) {
            return reply.send({ success: true, appointment_id: result.appointment_id });
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

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// NEW: List Appointments for a tenant (including basic customer/resource info)
app.get('/appointments', async (req, reply) => {
  const tenantId = (req.query as any)['tenant_id'];

  if (!tenantId) {
    return reply.status(400).send({ error: 'tenant_id is required' });
  }

  const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

  const client = await pool.connect();
  try {
    const query = `
      SELECT
         a.*,
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
    
    const res = isSuperAdmin 
      ? await client.query(query)
      : await client.query(query, [tenantId]);
      
    return reply.send(res.rows);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch appointments' });
  } finally {
    client.release();
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

// NEW: Get Customers for a tenant
app.get('/customers', async (req, reply) => {
  const tenantId = (req.query as any)['tenant_id'];

  if (!tenantId) {
    return reply.status(400).send({ error: 'tenant_id is required' });
  }

  const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

  const client = await pool.connect();
  try {
    const query = isSuperAdmin
      ? 'SELECT * FROM customers ORDER BY name'
      : 'SELECT * FROM customers WHERE tenant_id = $1 ORDER BY name';
    
    const res = isSuperAdmin
      ? await client.query(query)
      : await client.query(query, [tenantId]);
      
    return reply.send(res.rows);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch customers' });
  } finally {
    client.release();
  }
});

// NEW: Manual Customer Creation
app.post('/customers/create', async (req, reply) => {
    const body = req.body as any;
    const client = await pool.connect();
    try {
        const res = await client.query(
            `INSERT INTO customers (
               tenant_id,
               name,
               phone,
               email,
               address,
               address_line2,
               city,
               state,
               postal_code,
               metadata,
               first_name,
               last_name,
               timezone
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [
              body.tenant_id,
              body.name,
              body.phone,
              body.email,
              body.address,
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
        return reply.send({ success: true, customer: res.rows[0] });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to create customer' });
    } finally {
        client.release();
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
                owner_phone = $7
             WHERE id = $8`,
            [
                body.name, 
                body.business_type, 
                body.timezone, 
                body.voice_id, 
                body.system_prompt, 
                body.first_message,
                body.owner_phone,
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

    await client.query(
      'INSERT INTO users (tenant_id, email, password_hash, full_name, first_name, last_name) VALUES ($1, $2, $3, $4, $5, $6)',
      [tenantId, body.owner_email, body.owner_pass, fullName, firstName || null, lastName || null]
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

app.post('/appointments/:id/update', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as {
    tenant_id: string;
    start_time: string;
    end_time: string;
    description: string;
    location: string;
    customer_name: string;
    customer_phone: string;
    customer_notes: string;
  };

  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT * FROM update_appointment_customer($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        id, 
        body.tenant_id, 
        body.start_time, 
        body.end_time, 
        body.description, 
        body.location, 
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
