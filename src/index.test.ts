import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { Pool } from 'pg'

// Minimal replica of the app wiring for route-level tests without starting the real server
function buildTestApp() {
  const app = Fastify({ logger: false })

  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })

  const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: 'postgres',
    port: 5433,
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
    const body = req.body as any

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
    const payload = req.body as any
    // For now we just acknowledge receipt; real provider-specific logic will come later
    return reply.status(202).send({ status: 'accepted', source: payload?.provider || 'unknown' })
  })

  return { app, pool }
}

let app: ReturnType<typeof Fastify>
let pool: Pool

beforeAll(async () => {
  const built = buildTestApp()
  app = built.app
  pool = built.pool
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await pool.end()
})

describe('API Routes: health and admin', () => {
  it('GET /health should return ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
  })

  it('GET /tenants should return seeded tenants', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string; name: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })

  it('GET /templates should return at least one template', async () => {
    const res = await app.inject({ method: 'GET', url: '/templates' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ business_type: string; display_name: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })
})

describe('API Routes: appointments and calendar sync', () => {
  it('POST /appointments/create returns 400 when required fields are missing', async () => {
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
