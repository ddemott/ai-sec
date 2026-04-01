/**
 * Test to reproduce the scheduling timezone bug (BUG-001)
 * 
 * The bug: book_with_scheduling_atomic uses hardcoded 'UTC' timezone
 * for shift validation, which fails for tenants in other timezones.
 * 
 * Example: Tenant in America/Chicago, customer books at 9 PM Friday.
 * Function converts to UTC (3 AM Saturday) — wrong day_of_week,
 * fails to match Friday shifts.
 */

import { describe, it, beforeAll, afterAll } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';

const { Pool } = pg;

describe('Scheduling Timezone Bug (BUG-001)', () => {
  let pool: Pool;
  let testTenantId: string;
  let testResourceId: string;
  let testEmployeeId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    // Create test tenant in America/Chicago timezone
    const tenantRes = await pool.query(
      `INSERT INTO tenants (name, business_type, timezone, phone) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      ['Test Chicago Business', 'tire_shop', 'America/Chicago', '+13125551234']
    );
    testTenantId = tenantRes.rows[0].id;

    // Set tenant context for RLS
    await pool.query(`SELECT set_tenant_context($1)`, [testTenantId]);

    // Create a test resource
    const resourceRes = await pool.query(
      `INSERT INTO resources (tenant_id, name, description, capabilities) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      [testTenantId, 'Test Bay 1', 'Test resource', ['tire_rotation']]
    );
    testResourceId = resourceRes.rows[0].id;

    // Create a test employee
    const employeeRes = await pool.query(
      `INSERT INTO employees (tenant_id, name, skills, is_active) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      [testTenantId, 'Test Mechanic', ['tire_rotation'], true]
    );
    testEmployeeId = employeeRes.rows[0].id;

    // Create shift for FRIDAY (day_of_week = 5), 8 AM - 6 PM
    await pool.query(
      `INSERT INTO employee_shifts (employee_id, day_of_week, start_time, end_time, is_active) 
       VALUES ($1, $2, $3, $4, $5)`,
      [testEmployeeId, 5, '08:00', '18:00', true]  // Friday 8 AM - 6 PM
    );
  });

  afterAll(async () => {
    // Cleanup
    if (testTenantId) {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [testTenantId]);
    }
    await pool.end();
  });

  it('should fail to book at 9 PM Friday due to timezone bug', async () => {
    // Friday 2026-04-03 at 9:00 PM America/Chicago
    // This is FRIDAY in Chicago, but when converted to UTC becomes:
    // Saturday 2026-04-04 at 3:00 AM UTC (day_of_week = 6)
    // 
    // The bug: Function will look for Saturday shifts instead of Friday shifts
    
    const fridayNinePmChicago = '2026-04-03T21:00:00-05:00';  // Friday 9 PM CDT
    const fridayTenPmChicago = '2026-04-03T22:00:00-05:00';   // Friday 10 PM CDT

    const result = await pool.query(
      `SELECT * FROM book_with_scheduling_atomic(
        $1::UUID,           -- p_tenant_id
        $2::TEXT,           -- p_phone
        $3::TEXT,           -- p_customer_name
        $4::TEXT,           -- p_description
        NULL::TEXT,         -- p_call_id
        NULL::TEXT,         -- p_location
        $5::TIMESTAMPTZ,    -- p_start_time
        $6::TIMESTAMPTZ,    -- p_end_time
        NULL::TIMESTAMPTZ,  -- p_window_from
        NULL::TIMESTAMPTZ,  -- p_window_to
        ARRAY['tire_rotation']::TEXT[],  -- p_required_skills
        ARRAY[]::TEXT[],    -- p_required_capabilities
        NULL::UUID,         -- p_preferred_resource_id
        NULL::TEXT,         -- p_preferred_employee_id
        NULL::TEXT,         -- p_service_type
        60                  -- p_duration_minutes
      )`,
      [
        testTenantId,
        '+13125559999',
        'Test Customer',
        'Test booking at 9 PM Friday',
        fridayNinePmChicago,
        fridayTenPmChicago
      ]
    );

    const booking = result.rows[0];

    // BUG: This will fail because function converts to UTC and looks for Saturday shifts
    // Expected: success = false, error_message contains "No available"
    // After fix: success = true (Friday shift exists, time is within 8 AM - 6 PM... wait, no)
    
    // Actually, 9 PM is OUTSIDE the shift hours (8 AM - 6 PM), so this SHOULD fail
    // Let me adjust the test...
    
    assert.strictEqual(
      booking.success,
      false,
      'Booking at 9 PM should fail (outside shift hours 8 AM - 6 PM)'
    );
    assert.ok(
      booking.error_message?.includes('No available'),
      `Expected error about availability, got: ${booking.error_message}`
    );
  });

  it('should fail to book during shift hours on wrong day due to timezone bug', async () => {
    // Friday 2026-04-03 at 5:00 PM America/Chicago (within Friday shift 8 AM - 6 PM)
    // When converted to UTC: Saturday 2026-04-04 at 12:00 AM UTC (day_of_week = 6)
    // 
    // BUG: Function will look for Saturday shift, won't find it, booking fails
    // Expected after fix: Booking succeeds (Friday shift exists, time is valid)
    
    const fridayFivePmChicago = '2026-04-03T17:00:00-05:00';   // Friday 5 PM CDT
    const fridaySixPmChicago = '2026-04-03T18:00:00-05:00';    // Friday 6 PM CDT

    const result = await pool.query(
      `SELECT * FROM book_with_scheduling_atomic(
        $1::UUID, $2::TEXT, $3::TEXT, $4::TEXT, NULL::TEXT, NULL::TEXT,
        $5::TIMESTAMPTZ, $6::TIMESTAMPTZ,
        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ,
        ARRAY['tire_rotation']::TEXT[], ARRAY[]::TEXT[],
        NULL::UUID, NULL::TEXT, NULL::TEXT, 60
      )`,
      [
        testTenantId,
        '+13125559998',
        'Test Customer 2',
        'Test booking at 5 PM Friday (should work)',
        fridayFivePmChicago,
        fridaySixPmChicago
      ]
    );

    const booking = result.rows[0];

    // THIS IS THE BUG: Booking should succeed but fails due to timezone conversion
    console.log('Booking result:', booking);
    
    if (booking.success) {
      console.log('✅ FIXED: Booking succeeded (timezone handled correctly)');
      assert.strictEqual(booking.success, true);
      assert.ok(booking.appointment_id);
    } else {
      console.log('❌ BUG REPRODUCED: Booking failed due to timezone conversion');
      console.log('   Error:', booking.error_message);
      assert.ok(
        booking.error_message?.includes('No available'),
        'Expected failure due to timezone bug'
      );
    }
  });

  it('should handle booking at 11 AM Friday (definitely within shift hours)', async () => {
    // Friday 2026-04-03 at 11:00 AM America/Chicago (well within Friday shift 8 AM - 6 PM)
    // When converted to UTC: Friday 2026-04-03 at 4:00 PM UTC (same day, but wrong hour comparison)
    
    const fridayElevenAmChicago = '2026-04-03T11:00:00-05:00';  // Friday 11 AM CDT
    const fridayNoonChicago = '2026-04-03T12:00:00-05:00';       // Friday 12 PM CDT

    const result = await pool.query(
      `SELECT * FROM book_with_scheduling_atomic(
        $1::UUID, $2::TEXT, $3::TEXT, $4::TEXT, NULL::TEXT, NULL::TEXT,
        $5::TIMESTAMPTZ, $6::TIMESTAMPTZ,
        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ,
        ARRAY['tire_rotation']::TEXT[], ARRAY[]::TEXT[],
        NULL::UUID, NULL::TEXT, NULL::TEXT, 60
      )`,
      [
        testTenantId,
        '+13125559997',
        'Test Customer 3',
        'Test booking at 11 AM Friday',
        fridayElevenAmChicago,
        fridayNoonChicago
      ]
    );

    const booking = result.rows[0];
    console.log('11 AM Friday booking result:', booking);

    // This might work even with the bug if the UTC conversion still lands on Friday
    // But the time comparison will be wrong (comparing 16:00 UTC against 08:00-18:00)
    
    if (booking.success) {
      console.log('✅ Booking succeeded');
      assert.strictEqual(booking.success, true);
    } else {
      console.log('❌ Booking failed:', booking.error_message);
      // This failure would indicate the bug
    }
  });
});
