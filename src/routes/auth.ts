
import type { Pool } from 'pg';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  business_name: z.string().min(1).max(200),
  business_type: z.string().min(1).max(50),
  owner_name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

export function registerAuthRoutes(
  app: any,
  pool: Pool,
  generateToken: (payload: { tenant_id: string; user_id: string; email: string }) => string
) {
  app.post('/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid email or password format' });
    }
    const { email, password } = parsed.data;
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = res.rows[0];
      if (!user) {
        return reply.status(401).send({ success: false, error: 'Invalid email or password' });
      }
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
        return reply.status(401).send({ success: false, error: 'Invalid email or password' });
      }
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  // POST /register - Public self-service tenant + user creation
  app.post('/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const { business_name, business_type, owner_name, email, password } = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if email already exists globally (for helpful error message)
      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ success: false, error: 'An account with this email already exists' });
      }

      // Create tenant (triggers apply template defaults + create default resource)
      const tenantRes = await client.query(
        "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id",
        [business_name, business_type]
      );
      const tenantId = tenantRes.rows[0].id;

      // Hash password and create user
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash(password, 10);

      const userRes = await client.query(
        "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4) RETURNING id, full_name",
        [tenantId, email, hash, owner_name]
      );

      await client.query('COMMIT');

      const token = generateToken({
        tenant_id: tenantId,
        user_id: userRes.rows[0].id,
        email,
      });

      return reply.status(201).send({
        success: true,
        tenant_id: tenantId,
        user_id: userRes.rows[0].id,
        user_name: owner_name,
        token,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      app.log.error(err);
      return reply.status(500).send({ error: 'Registration failed' });
    } finally {
      client.release();
    }
  });
}
