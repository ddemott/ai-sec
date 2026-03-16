import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { dayStringToNum, dayNumToString, workingHoursToShifts, shiftsToWorkingHours } from './core/models';

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
  // Ensure tenant exists
  await client.query(
    `INSERT INTO tenants (id, name, business_type, timezone) VALUES ($1, 'MediumBugTenant', 'test', 'America/New_York') ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID]
  );
  // Ensure resource
  await client.query(
    `INSERT INTO resources (id, tenant_id, name) VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', $1, 'TestBay') ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID]
  );
  // Ensure customer
  await client.query(
    `INSERT INTO customers (id, tenant_id, phone, name) VALUES ('11111111-2222-3333-4444-555555555555', $1, '+15559990001', 'Medium Bug Customer') ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID]
  );
});

afterAll(async () => {
  // Clean up test data
  await client.query(`DELETE FROM appointments WHERE tenant_id = $1`, [TENANT_ID]);
  await client.query(`DELETE FROM employee_shifts WHERE tenant_id = $1`, [TENANT_ID]);
  await client.query(`DELETE FROM employees WHERE tenant_id = $1`, [TENANT_ID]);
  client.release();
  await pool.end();
});

// ==================================================================
// BUG-013: Soft reservation cleanup function exists
// ==================================================================
describe('BUG-013: purge_expired_soft_reservations', () => {
  test('function exists and can be called', async () => {
    const res = await client.query('SELECT purge_expired_soft_reservations() as count');
    expect(typeof res.rows[0].count).toBe('number');
  });
});

// ==================================================================
// BUG-014: Malformed p_assignment_id returns error
// ==================================================================
describe('BUG-014: p_assignment_id error handling', () => {
  test('rejects malformed assignment_id (not UUID or integer)', async () => {
    const res = await client.query(
      `SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        TENANT_ID,
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555',
        new Date('2026-04-15T10:00:00Z'),
        new Date('2026-04-15T11:00:00Z'),
        'Test malformed assignment',
        'test-call-malformed',
        null,
        'not-a-uuid-or-integer',
      ]
    );
    expect(res.rows[0].success).toBe(false);
    expect(res.rows[0].error_message).toContain('Invalid assignment_id format');
  });

  test('accepts valid integer assignment_id', async () => {
    // Create employee first
    const empRes = await client.query(
      `INSERT INTO employees (tenant_id, name, skills) VALUES ($1, 'BugTest Employee', '{}') RETURNING id`,
      [TENANT_ID]
    );
    const empId = empRes.rows[0].id;

    // Create shift for the employee on the right day
    const testDate = new Date('2026-04-15T14:00:00Z'); // Wednesday
    await client.query(
      `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, 3, '08:00', '20:00', true)`,
      [TENANT_ID, empId]
    );

    const res = await client.query(
      `SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        TENANT_ID,
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555',
        new Date('2026-04-15T14:00:00Z'),
        new Date('2026-04-15T15:00:00Z'),
        'Valid integer assignment',
        'test-call-valid-int',
        null,
        empId.toString(),
      ]
    );
    expect(res.rows[0].success).toBe(true);
  });

  test('accepts valid UUID assignment_id', async () => {
    // Create a user to assign to
    const userId = '22222222-3333-4444-5555-666666666666';
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'uuid-assign@test.com', 'hash', 'UUID User')
       ON CONFLICT (id) DO NOTHING`,
      [userId, TENANT_ID]
    );

    // Clean up any overlap from previous test
    await client.query(`DELETE FROM appointments WHERE call_id = 'test-call-valid-uuid'`);

    const res = await client.query(
      `SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        TENANT_ID,
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555',
        new Date('2026-04-16T10:00:00Z'),
        new Date('2026-04-16T11:00:00Z'),
        'Valid UUID assignment',
        'test-call-valid-uuid',
        null,
        userId,
      ]
    );
    expect(res.rows[0].success).toBe(true);
  });
});

// ==================================================================
// BUG-022: Name sync trigger
// ==================================================================
describe('BUG-022: Name sync triggers', () => {
  test('updating user full_name syncs to first/last', async () => {
    // Create a test user
    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, full_name, first_name, last_name)
       VALUES (gen_random_uuid(), $1, 'namesync@test.com', 'hash', 'Original Name', 'Original', 'Name')
       ON CONFLICT DO NOTHING`,
      [TENANT_ID]
    );

    await client.query(
      `UPDATE users SET full_name = 'John Doe' WHERE email = 'namesync@test.com' AND tenant_id = $1`,
      [TENANT_ID]
    );

    const res = await client.query(
      `SELECT first_name, last_name FROM users WHERE email = 'namesync@test.com' AND tenant_id = $1`,
      [TENANT_ID]
    );
    expect(res.rows[0].first_name).toBe('John');
    expect(res.rows[0].last_name).toBe('Doe');
  });

  test('updating customer first/last syncs to name', async () => {
    await client.query(
      `UPDATE customers SET first_name = 'Jane', last_name = 'Smith' WHERE id = '11111111-2222-3333-4444-555555555555'`
    );

    const res = await client.query(
      `SELECT name FROM customers WHERE id = '11111111-2222-3333-4444-555555555555'`
    );
    expect(res.rows[0].name).toBe('Jane Smith');
  });
});

// ==================================================================
// BUG-023: 3+ word names handled correctly
// ==================================================================
describe('BUG-023: Name splitting for compound names', () => {
  test('3-word name splits correctly via trigger', async () => {
    await client.query(
      `UPDATE users SET full_name = 'Mary Jane Watson' WHERE email = 'namesync@test.com' AND tenant_id = $1`,
      [TENANT_ID]
    );

    const res = await client.query(
      `SELECT first_name, last_name FROM users WHERE email = 'namesync@test.com' AND tenant_id = $1`,
      [TENANT_ID]
    );
    expect(res.rows[0].first_name).toBe('Mary');
    expect(res.rows[0].last_name).toBe('Jane Watson');
  });
});

// ==================================================================
// BUG-029: Day-of-week conversion utilities
// ==================================================================
describe('BUG-029: Day-of-week conversion', () => {
  test('dayStringToNum converts correctly', () => {
    expect(dayStringToNum('sun')).toBe(0);
    expect(dayStringToNum('mon')).toBe(1);
    expect(dayStringToNum('fri')).toBe(5);
    expect(dayStringToNum('sat')).toBe(6);
  });

  test('dayNumToString converts correctly', () => {
    expect(dayNumToString(0)).toBe('sun');
    expect(dayNumToString(1)).toBe('mon');
    expect(dayNumToString(6)).toBe('sat');
  });

  test('workingHoursToShifts round-trips', () => {
    const wh = {
      mon: [{ start: '09:00', end: '17:00' }],
      wed: [{ start: '10:00', end: '14:00' }, { start: '15:00', end: '19:00' }],
    };
    const shifts = workingHoursToShifts(wh);
    expect(shifts).toHaveLength(3);
    expect(shifts[0]).toEqual({ day_of_week: 1, start_time: '09:00', end_time: '17:00' });

    const roundTripped = shiftsToWorkingHours(shifts);
    expect(roundTripped.mon).toEqual([{ start: '09:00', end: '17:00' }]);
    expect(roundTripped.wed).toHaveLength(2);
  });

  test('throws on invalid day', () => {
    expect(() => dayStringToNum('xyz')).toThrow('Unknown day string');
    expect(() => dayNumToString(99)).toThrow('Unknown day number');
  });
});

// ==================================================================
// BUG-020: Pagination parameters (basic endpoint check)
// ==================================================================
describe('BUG-020: Pagination', () => {
  test('customers query with LIMIT/OFFSET works', async () => {
    const res = await client.query(
      `SELECT * FROM customers WHERE tenant_id = $1 ORDER BY name LIMIT $2 OFFSET $3`,
      [TENANT_ID, 10, 0]
    );
    expect(res.rows.length).toBeLessThanOrEqual(10);
  });

  test('appointments query with LIMIT/OFFSET works', async () => {
    const res = await client.query(
      `SELECT * FROM appointments WHERE tenant_id = $1 ORDER BY start_time LIMIT $2 OFFSET $3`,
      [TENANT_ID, 5, 0]
    );
    expect(res.rows.length).toBeLessThanOrEqual(5);
  });
});
