
import type { Pool } from 'pg';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
}
