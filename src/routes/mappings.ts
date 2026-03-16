
import type { Pool } from 'pg';

export function registerMappingRoutes(app: any, pool: Pool) {
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
}
