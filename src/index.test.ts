/**
 * Route-level smoke tests for the API surface.
 *
 * These exercise a minimal Fastify replica (no JWT auth hook, no tenant
 * middleware) so we can hit the endpoint contracts directly without
 * spinning up the full server. The DB-backed routes degrade to no-op
 * when the local Postgres on :5433 isn't reachable (CI runs them; some
 * dev environments don't), so failures here mean the contract changed,
 * not that the harness is busted.
 *
 * Per the project convention, every test below carries a 5W
 * (WHO/WHAT/WHEN/WHERE/WHY) header so a sad-path failure tells the
 * debugger what behavior was expected and why.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { Pool } from 'pg'
import { skipIfDbDown } from './test-utils'

// Minimal replica of the app wiring for route-level tests without starting the real server
function buildTestApp() {
  const app = Fastify({ logger: false })

  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })

  // Point at the same test_db the migrations + seeds populate
  // (matches src/test-utils.ts ROOT_DB_URL). Hardcoding `database: 'postgres'`
  // here used to silently pass locally because the developer's `postgres`
  // database happened to have leftover tables from past runs — but CI's
  // fresh Postgres instance has the schema only in `test_db`, so the
  // hardcoded value produced "relation does not exist" → 500 on every
  // `/tenants` and `/templates` request. Found 2026-05-11.
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/test_db',
  })

  app.get('/health', async () => ({ status: 'ok' }))

  app.get('/tenants', async (req, reply) => {
    const client = await pool.connect()
    try {
      const res = await client.query('SELECT * FROM tenants ORDER BY created_at DESC')
      return reply.send(res.rows)
    } finally {
      client.release()
    }
  })

  app.get('/templates', async (req, reply) => {
    const client = await pool.connect()
    try {
      const res = await client.query('SELECT business_type, display_name FROM business_templates')
      return reply.send(res.rows)
    } finally {
      client.release()
    }
  })

  // Minimal /appointments/create endpoint for validation and wiring tests
  app.post('/appointments/create', async (req, reply) => {
    const body = req.body as Record<string, unknown>

    const required = [
      'tenant_id',
      'resource_id',
      'customer_id',
      'start_time',
      'end_time',
      'description',
    ]

    const missing = required.filter((key) => !body?.[key])
    if (missing.length > 0) {
      return reply.status(400).send({ success: false, error: 'Missing required fields', missing })
    }

    const client = await pool.connect()
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
          body.location || null,
        ]
      )
      const result = res.rows[0]
      if (result.success) {
        return reply.send({ success: true, appointment_id: result.appointment_id })
      }
      return reply.status(400).send({ success: false, error: result.error_message })
    } finally {
      client.release()
    }
  })

  // Calendar sync stub endpoint
  app.post('/calendar/sync', async (req, reply) => {
    const payload = req.body as { provider?: string } | undefined
    // For now we just acknowledge receipt; real provider-specific logic will come later
    return reply.status(202).send({ status: 'accepted', source: payload?.provider || 'unknown' })
  })

  return { app, pool }
}

let app: ReturnType<typeof Fastify>
let pool: Pool
let dbAvailable = true
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable))

beforeAll(async () => {
  const built = buildTestApp()
  app = built.app
  pool = built.pool
  await app.ready()

  try {
    // Probe DB availability once for DB-backed routes.
    const client = await pool.connect()
    await client.query('SELECT 1')

    // Own our data lifecycle. The seeded platform admin tenant gets
    // wiped by any earlier-running test file that calls clearDB() (≈25
    // files truncate `tenants CASCADE`), so GET /tenants would
    // intermittently return an empty array and the next assertion
    // would fail. Insert idempotently so this test no longer depends
    // on global seed state.
    await client.query(
      `INSERT INTO tenants (tenant_id, name, business_type, timezone)
       VALUES ('00000000-0000-0000-0000-000000000000', 'index.test seed', 'platform-admin', 'America/Chicago')
       ON CONFLICT (tenant_id) DO NOTHING`,
    )

    client.release()
  } catch (err) {
    dbAvailable = false
    // eslint-disable-next-line no-console
    console.warn('[index.test] DB not available, skipping DB-backed route assertions', err)
  }
})

afterAll(async () => {
  await app.close()
  await pool.end()
})

describe('API Routes: health and admin', () => {
  it('GET /health should return ok', async () => {
    // WHO: Railway's healthcheck (and any uptime monitor)
    // WHAT: Plain 200 + `{ status: 'ok' }` so the platform considers the
    //        instance ready to receive traffic
    // WHEN: Every Railway deploy + every minute the platform polls
    // WHERE: Top-of-app `/health` route (no DB, no auth, must never fail)
    // WHY: If this regresses, Railway pulls the deploy and the service
    //       silently disappears for users — the public liveness contract
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
  })

  it('GET /tenants should return seeded tenants', async () => {
    // WHO: Super-admin dashboard listing every tenant in the system
    // WHAT: Returns an array of seeded tenants ordered by created_at desc
    // WHEN: Initial load of the SuperAdmin tenant switcher dropdown
    // WHERE: `/tenants` admin route — bypasses RLS via the postgres pool
    //         (this is one of the few cross-tenant admin reads)
    // WHY: A regression here means the platform admin can't see or pick
    //       a tenant — all admin operations stop working
    if (!dbAvailable) return
    const res = await app.inject({ method: 'GET', url: '/tenants' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string; name: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })

  it('GET /templates should return at least one template', async () => {
    // WHO: New-tenant onboarding wizard reading the industry catalog
    // WHAT: Returns the seeded `business_templates` rows so the wizard
    //        can show "Tire shop / Salon / Mobile tire / Auto bay /
    //        AI platform" picker
    // WHEN: Step 1 of the SetupWizard, before the tenant picks a vertical
    // WHERE: `/templates` route — reads `business_templates` table
    // WHY: An empty result here strands new users on a blank picker;
    //       the wizard can't proceed without at least one template
    if (!dbAvailable) return
    const res = await app.inject({ method: 'GET', url: '/templates' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ business_type: string; display_name: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })
})

describe('API Routes: appointments and calendar sync', () => {
  it('POST /appointments/create returns 400 when required fields are missing', async () => {
    // WHO: Front-desk operator (or voice agent) submitting a booking
    //       payload with only the tenant_id filled in
    // WHAT: 400 with `{ success: false, error: 'Missing required fields',
    //        missing: [...field names...] }` so the caller knows exactly
    //        which fields were absent
    // WHEN: Any booking attempt that omits resource_id, customer_id,
    //        start_time, end_time, or description
    // WHERE: `/appointments/create` validation — fields checked BEFORE
    //         the atomic-booking RPC is invoked
    // WHY: We never want to call the RPC with a partial payload (it would
    //       fail with a less helpful Postgres error). The dashboard relies
    //       on the `missing` array to highlight specific form fields red.
    const res = await app.inject({
      method: 'POST',
      url: '/appointments/create',
      payload: {
        tenant_id: 'some-tenant',
        // missing resource_id, customer_id, times, description
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json() as { success: boolean; error: string; missing: string[] }
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/Missing required fields/i)
    expect(body.missing).toContain('resource_id')
  })

  it('POST /calendar/sync returns 202 accepted', async () => {
    // WHO: Google/Outlook calendar webhook (or a manual sync trigger)
    //       posting an event payload to the backend
    // WHAT: 202 Accepted with `{ status: 'accepted', source: <provider> }`
    //        so the caller knows the request was received and queued
    // WHEN: Any push-sync from a connected calendar
    // WHERE: `/calendar/sync` ack route — provider-specific routing happens
    //         downstream; this just acknowledges receipt
    // WHY: Webhooks expect a fast 2xx ack to avoid retries. Returning 200
    //       (instead of 202) would mislead Google/Outlook into thinking
    //       the sync completed synchronously when it actually queues.
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/sync',
      payload: { provider: 'outlook', data: { ping: true } },
    })

    expect(res.statusCode).toBe(202)
    const body = res.json() as { status: string; source: string }
    expect(body.status).toBe('accepted')
    expect(body.source).toBe('outlook')
  })
})
