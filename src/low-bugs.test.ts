import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { detectTimezone } from '../dashboard/lib/constants';

// ------------------------------------------------------------------
// Database setup
// ------------------------------------------------------------------
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'test_db',
  password: 'postgres',
  port: 5433,
});

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
let client: PoolClient;

beforeAll(async () => {
  client = await pool.connect();
  await client.query(
    `INSERT INTO tenants (id, name, business_type, timezone) VALUES ($1, 'LowBugTenant', 'test', 'America/New_York') ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID]
  );
  await client.query(
    `INSERT INTO resources (id, tenant_id, name) VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', $1, 'TestBay') ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID]
  );
  await client.query(
    `INSERT INTO customers (id, tenant_id, phone, name) VALUES ('11111111-2222-3333-4444-555555555555', $1, '+15559990001', 'Low Bug Customer') ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID]
  );
});

afterAll(async () => {
  await client.query(`DELETE FROM appointments WHERE tenant_id = $1 AND description LIKE 'LowBug%'`, [TENANT_ID]);
  client.release();
  await pool.end();
});

// ==================================================================
// BUG-040: Auto-calculate end_time from service duration
// ==================================================================
describe('BUG-040: Auto-calculate end_time from service duration', () => {
  let serviceId: number;

  beforeAll(async () => {
    // Create a service with known duration
    const res = await client.query(
      `INSERT INTO services (tenant_id, name, duration_minutes, required_skills, required_resources)
       VALUES ($1, 'LowBug Test Service', 45, '{}', '{}')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [TENANT_ID]
    );
    if (res.rows.length > 0) {
      serviceId = res.rows[0].id;
    } else {
      const existing = await client.query(
        `SELECT id FROM services WHERE tenant_id = $1 AND name = 'LowBug Test Service'`,
        [TENANT_ID]
      );
      serviceId = existing.rows[0].id;
    }
  });

  test('auto-calculates end_time when NULL and service_id provided', async () => {
    const startTime = new Date('2026-05-01T10:00:00Z');
    const res = await client.query(
      `SELECT * FROM book_appointment_atomic($1, $2, $3, $4, NULL, $5, $6, NULL, NULL, $7)`,
      [
        TENANT_ID,
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555',
        startTime,
        'LowBug auto-end test',
        'low-bug-040-1',
        serviceId,
      ]
    );
    expect(res.rows[0].success).toBe(true);

    // Verify end_time = start_time + 45 minutes
    const apt = await client.query(
      `SELECT start_time, end_time FROM appointments WHERE id = $1`,
      [res.rows[0].appointment_id]
    );
    const start = new Date(apt.rows[0].start_time);
    const end = new Date(apt.rows[0].end_time);
    const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    expect(diffMinutes).toBe(45);
  });

  test('returns error when end_time is NULL and no service_id', async () => {
    const res = await client.query(
      `SELECT * FROM book_appointment_atomic($1, $2, $3, $4, NULL, $5, $6)`,
      [
        TENANT_ID,
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555',
        new Date('2026-05-02T10:00:00Z'),
        'LowBug no-end no-service',
        'low-bug-040-2',
      ]
    );
    expect(res.rows[0].success).toBe(false);
    expect(res.rows[0].error_message).toContain('end_time is required');
  });

  test('explicit end_time still works when provided', async () => {
    const res = await client.query(
      `SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7)`,
      [
        TENANT_ID,
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555',
        new Date('2026-05-03T10:00:00Z'),
        new Date('2026-05-03T11:30:00Z'),
        'LowBug explicit end',
        'low-bug-040-3',
      ]
    );
    expect(res.rows[0].success).toBe(true);
  });
});

// ==================================================================
// BUG-052: JSONB metadata CHECK constraint
// ==================================================================
describe('BUG-052: JSONB metadata CHECK constraint', () => {
  test('rejects array metadata on customers', async () => {
    await expect(
      client.query(
        `INSERT INTO customers (tenant_id, phone, name, metadata)
         VALUES ($1, '+15550000099', 'ArrayMeta', '[]'::jsonb)`,
        [TENANT_ID]
      )
    ).rejects.toThrow(/customers_metadata_is_object/);
  });

  test('accepts object metadata on customers', async () => {
    const res = await client.query(
      `INSERT INTO customers (tenant_id, phone, name, metadata)
       VALUES ($1, '+15550000098', 'ObjMeta', '{"key": "value"}'::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [TENANT_ID]
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(0); // may conflict on re-run
  });

  test('accepts NULL metadata on customers', async () => {
    const res = await client.query(
      `INSERT INTO customers (tenant_id, phone, name, metadata)
       VALUES ($1, '+15550000097', 'NullMeta', NULL)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [TENANT_ID]
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(0);
  });
});

// ==================================================================
// BUG-057: Extended timezone detection
// ==================================================================
describe('BUG-057: Extended timezone detection', () => {
  test('detects timezone for major cities', () => {
    expect(detectTimezone('San Francisco', '')).toBe('America/Los_Angeles');
    expect(detectTimezone('Nashville', '')).toBe('America/Chicago');
    expect(detectTimezone('Boston', '')).toBe('America/New_York');
    expect(detectTimezone('Albuquerque', '')).toBe('America/Denver');
    expect(detectTimezone('Honolulu', '')).toBe('Pacific/Honolulu');
    expect(detectTimezone('Anchorage', '')).toBe('America/Anchorage');
  });

  test('falls back to state-level detection', () => {
    expect(detectTimezone('Unknown City', 'PA')).toBe('America/New_York');
    expect(detectTimezone('Unknown City', 'WI')).toBe('America/Chicago');
    expect(detectTimezone('Unknown City', 'MT')).toBe('America/Denver');
    expect(detectTimezone('Unknown City', 'OR')).toBe('America/Los_Angeles');
    expect(detectTimezone('Unknown City', 'HI')).toBe('Pacific/Honolulu');
    expect(detectTimezone('Unknown City', 'AK')).toBe('America/Anchorage');
  });

  test('returns null for unknown city and state', () => {
    expect(detectTimezone('Unknown City', 'XX')).toBeNull();
  });
});
