import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import { InMemoryBookingStorage } from './storage/inMemoryBookingStorage';
import { LoggingTelephonyProvider } from './providers/loggingTelephonyProvider';
import { ConsoleNotificationProvider } from './providers/consoleNotificationProvider';
import { BookingService } from './services/bookingService';
import { MockLlmProvider } from './services/mockLlmProvider';
import type { TimeWindow } from './core/models';

const app = Fastify({ logger: true });

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

// Calendar sync stub endpoint for future Outlook/Google integrations
app.post('/calendar/sync', async (req, reply) => {
  const body = req.body as any;
  // For now we just acknowledge receipt; provider-specific handling will be added later
  return reply.status(202).send({ status: 'accepted', source: body?.provider || 'unknown' });
});

// NEW: Get Resources for a tenant
app.get('/resources', async (req, reply) => {
  const tenantId = (req.query as any)['tenant_id'];
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM resources WHERE tenant_id = $1', [tenantId]);
        return reply.send(res.rows);
    } catch (err) {
        return reply.status(500).send({ error: 'Failed to fetch resources' });
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
            'INSERT INTO customers (tenant_id, name, phone, email, address, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [body.tenant_id, body.name, body.phone, body.email, body.address, body.metadata || {}]
        );
        return reply.send({ success: true, customer: res.rows[0] });
    } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: 'Failed to create customer' });
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
    owner_name: string;
    owner_email: string;
    owner_pass: string;
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create Tenant (Trigger will apply business template defaults)
    const tenantRes = await client.query(
      'INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id',
      [body.tenant_name, body.business_type]
    );
    const tenantId = tenantRes.rows[0].id;

    // 2. Create Owner User
    await client.query(
      'INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)',
      [tenantId, body.owner_email, body.owner_pass, body.owner_name]
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
