import type { AppFastifyInstance } from '../types/fastify';
import type { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { withHandler } from '../middleware';
import { registry as metricsRegistry } from '../services/metrics';
import { runReadinessCheck } from '../readinessHandler';

// Captured once at module load — the same point the server process first imports
// this module. Exposed via /health so E2E can detect a stale backend binary.
const PROCESS_STARTED_AT = new Date().toISOString();

// Static pages read once at module load, not per-request (avoid event-loop
// blocking on hot paths). {{DASHBOARD_URL}} substituted per-request (cheap).
const publicDir = path.resolve(__dirname, '..', '..', '..', 'public');
const LANDING_HTML = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
const DEMO_HTML = fs.readFileSync(path.join(publicDir, 'secretaryhq-demo.html'), 'utf-8');

export function registerHealthRoutes(app: AppFastifyInstance, pool: Pool): void {
  // Public marketing landing page
  app.get('/', async (_req, reply) => {
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://localhost:4000';
    const html = LANDING_HTML.replace(/\{\{DASHBOARD_URL\}\}/g, dashboardUrl);
    return reply.type('text/html').send(html);
  });

  // Demo page (static, no substitution needed)
  app.get('/demo', async (_req, reply) => {
    return reply.type('text/html').send(DEMO_HTML);
  });

  // Liveness: process is up. Intentionally shallow + synchronous — does NOT
  // touch the DB so a transient DB blip can't restart-loop the container.
  // Shape {status, started_at} is pinned by the E2E stale-binary check.
  app.get('/health', () => ({ status: 'ok', started_at: PROCESS_STARTED_AT }));

  // Readiness: pings the DB + reports pool saturation. A monitoring/alerting
  // signal — page on 503 or sustained waiting>0. Not a traffic gate unless
  // Railway's healthcheck path is repointed here.
  app.get('/ready', (_req, reply) => runReadinessCheck(pool, app.log, reply));

  // Prometheus-format metrics scrape. Strict opt-in: 404 when METRICS_TOKEN
  // is unset so a fresh deploy can't expose tenant-keyed counters publicly.
  app.get('/metrics', async (req, reply) => {
    const token = process.env.METRICS_TOKEN;
    if (!token) {
      return reply.status(404).send({ success: false, error: 'Metrics endpoint disabled' });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const auth = req.headers.authorization;
    const provided =
      typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    if (provided !== token) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(metricsRegistry.expose());
  });

  // Admin: manually trigger the soft-reservation cleanup RPC. Not tenant-scoped
  // (runs as superuser against the whole DB). Wrapped in withHandler for
  // consistent error logging and errorsTotal ticking.
  app.post(
    '/admin/purge-soft-reservations',
    withHandler(async (_req, reply) => {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT purge_expired_soft_reservations() as deleted_count');
        const row = res.rows[0] as { deleted_count: number };
        return reply.send({ success: true, deleted_count: row.deleted_count });
      } finally {
        client.release();
      }
    }, 'Failed to purge soft reservations')
  );
}
