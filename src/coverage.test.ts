import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from "./test-utils";
import { Client } from "pg";

type CoverageRow = {
    service_name: string;
    status: 'full' | 'partial' | 'gap' | 'closed';
    coverage_pct: string;
    check_date: string;
    gap_hours: unknown[];
    covered_hours: unknown[];
};

describe("Coverage Gap Detection", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let dbAvailable = true;
    beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

    beforeAll(async () => {
        try {
            client = await getRootClient();
            await clearDB(client);
            const setup = await setupBasicTenant(client);
            tenantId = setup.tenantId;
            resourceId = setup.resourceId;
        } catch (err) {
            dbAvailable = false;
            console.warn("[coverage.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable && client) {
            await client.end();
        }
    });

    beforeEach(async () => {
        if (!dbAvailable) return;
        await beginTestTransaction(client);
    });

    afterEach(async () => {
        if (!dbAvailable) return;
        await rollbackTestTransaction(client);
    });

    // Helper: seed an employee with date-specific schedule rows and a
    // service assignment. The check_coverage_gaps RPC reads
    // employee_schedule directly, so for each day-of-week passed in we
    // emit one employee_schedule row at the matching date in the
    // 2026-03-16..2026-03-22 test window (Mon..Sun).
    const TEST_WEEK_BY_DOW: Record<number, string> = {
        0: '2026-03-22', 1: '2026-03-16', 2: '2026-03-17', 3: '2026-03-18',
        4: '2026-03-19', 5: '2026-03-20', 6: '2026-03-21',
    };
    async function seedEmployee(
        name: string,
        skills: string[],
        shiftDays: number[],
        shiftStart: string,
        shiftEnd: string,
        serviceIds: string[]
    ) {
        const res = await client.query(
            "INSERT INTO employees (tenant_id, name, first_name, last_name, skills) VALUES ($1, $2, $3, $4, $5) RETURNING employee_id",
            [tenantId, name, name.split(' ')[0], name.split(' ')[1] || '', skills]
        );
        const empId = res.rows[0].employee_id;

        for (const dow of shiftDays) {
            const shiftDate = TEST_WEEK_BY_DOW[dow];
            await client.query(
                "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off) VALUES ($1, $2, $3::DATE, $4::TIME, $5::TIME, false)",
                [tenantId, empId, shiftDate, shiftStart, shiftEnd]
            );
        }

        for (const svcId of serviceIds) {
            await client.query(
                "INSERT INTO service_employee (tenant_id, service_id, employee_id) VALUES ($1, $2, $3)",
                [tenantId, svcId, empId]
            );
        }

        return empId;
    }

    async function seedService(name: string, duration: number, assignResource = true) {
        const res = await client.query(
            "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, $2, $3) RETURNING service_id",
            [tenantId, name, duration]
        );
        const svcId = res.rows[0].service_id;

        if (assignResource) {
            await client.query(
                "INSERT INTO service_resource (tenant_id, service_id, resource_id) VALUES ($1, $2, $3)",
                [tenantId, svcId, resourceId]
            );
        }

        return svcId;
    }

    // The updated check_coverage_gaps() returns per-service-per-date rows with:
    // service_id, service_name, check_date, gap_hours[], covered_hours[], total_open_hours, coverage_pct, status, details

    it("should return columns matching the backend route SELECT contract", async () => {
        // WHO: Backend GET /coverage route selects specific columns from check_coverage_gaps()
        // WHAT: RPC must return all 9 expected columns so the route query doesn't fail
        // WHY: A column mismatch caused 'Failed to check coverage gaps' errors in production
        if (!dbAvailable) return;

        const svcId = await seedService("Contract Test", 30);
        await seedEmployee("Contract Worker", [], [1], '08:00', '17:00', [svcId]);

        // Run the exact same SELECT the backend route uses
        const res = await client.query(
            `SELECT service_id, service_name, check_date, gap_hours, covered_hours,
                    total_open_hours, coverage_pct, status, details
             FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)`,
            [tenantId]
        );

        expect(res.rows.length).toBeGreaterThan(0);

        // Verify every expected column is present and has the right type
        const row = res.rows[0];
        expect(row).toHaveProperty('service_id');
        expect(row).toHaveProperty('service_name');
        expect(row).toHaveProperty('check_date');
        expect(row).toHaveProperty('gap_hours');
        expect(row).toHaveProperty('covered_hours');
        expect(row).toHaveProperty('total_open_hours');
        expect(row).toHaveProperty('coverage_pct');
        expect(row).toHaveProperty('status');
        expect(row).toHaveProperty('details');

        // Type checks
        expect(typeof row.service_name).toBe('string');
        expect(Array.isArray(row.gap_hours)).toBe(true);
        expect(Array.isArray(row.covered_hours)).toBe(true);
        expect(typeof row.total_open_hours).toBe('number');
        expect(['full', 'partial', 'gap', 'closed']).toContain(row.status);
    });

    it("should return 'closed' for dates when service has no employees on shift", async () => {
        // WHO: A service with no employees assigned
        // WHAT: check_coverage_gaps should show closed (no open hours)
        // WHY: No employees = no shifts = business not open for this service
        if (!dbAvailable) return;

        await seedService("Oil Change", 30);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        // Should return 7 rows (one per date) all with status 'closed'
        expect(res.rows.length).toBe(7);
        for (const row of res.rows) {
            expect(row.service_name).toBe("Oil Change");
            expect(row.status).toBe("closed");
            expect(row.total_open_hours).toBe(0);
        }
    });

    it("should return 'full' when service is covered all open hours", async () => {
        // WHO: A service with an employee covering all working hours
        // WHAT: check_coverage_gaps should show full coverage on weekdays
        // WHY: Employee shift matches open hours exactly
        if (!dbAvailable) return;

        const svcId = await seedService("Tire Rotation", 45);
        await seedEmployee("Mike Smith", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        // Mon-Fri should be 'full', Sat-Sun should be 'closed'
        const weekday = res.rows.find((r: CoverageRow) => r.status === 'full');
        expect(weekday).toBeDefined();
        expect(weekday.coverage_pct).toBe('100.0');

        const weekend = res.rows.filter((r: CoverageRow) => r.status === 'closed');
        expect(weekend.length).toBe(2); // Sat + Sun
    });

    it("should return 'partial' or 'gap' when service has limited coverage", async () => {
        // WHO: An employee only working Mon-Wed 9-3, but open hours defined by another employee Mon-Fri 8-5
        // WHAT: Coverage should be partial — some hours uncovered
        // WHY: Thu+Fri have zero coverage for this service
        if (!dbAvailable) return;

        const svcId = await seedService("Brakes", 60);
        const mikeSvcId = await seedService("Other Service", 30);
        await seedEmployee("Mike Smith", [], [1, 2, 3, 4, 5], '08:00', '17:00', [mikeSvcId]);
        await seedEmployee("Steve Jones", [], [1, 2, 3], '09:00', '15:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        const brakes = res.rows.filter((r: CoverageRow) => r.service_name === "Brakes");
        expect(brakes.length).toBeGreaterThan(0);

        // Some days should have coverage, some should be gaps
        const covered = brakes.filter((r: CoverageRow) => r.status !== 'closed' && Number(r.coverage_pct) > 0);
        const gaps = brakes.filter((r: CoverageRow) => r.status === 'gap' || r.status === 'closed');
        expect(covered.length).toBeGreaterThan(0);
        expect(gaps.length).toBeGreaterThan(0);
    });

    it("should include gap_hours array with uncovered hours", async () => {
        // WHO: An employee with limited hours vs full business hours
        // WHAT: gap_hours should list the uncovered hour slots
        // WHY: Detailed gap information for coverage visibility
        if (!dbAvailable) return;

        const svcId = await seedService("Alignment", 60);
        const otherSvcId = await seedService("Other", 30);
        await seedEmployee("Full Timer", [], [1, 2, 3, 4, 5], '08:00', '17:00', [otherSvcId]);
        await seedEmployee("Part Timer", [], [1], '10:00', '12:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        // Monday should have partial coverage for Alignment (10-12 covered, 8-10 + 12-17 gap)
        const alignmentMon = res.rows.find((r: CoverageRow) =>
            r.service_name === "Alignment" && new Date(r.check_date).getDay() === 1
        );
        if (alignmentMon) {
            expect(alignmentMon.gap_hours.length).toBeGreaterThan(0);
            expect(alignmentMon.covered_hours.length).toBeGreaterThan(0);
        }
    });

    it("should return empty gap_hours for fully covered days", async () => {
        // WHO: Employee covers all open hours for a service
        // WHAT: gap_hours should be empty array on covered days
        // WHY: Full coverage = no gaps
        if (!dbAvailable) return;

        const svcId = await seedService("Quick Fix", 15);
        await seedEmployee("Always Here", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        const fullDays = res.rows.filter((r: CoverageRow) => r.status === 'full');
        for (const day of fullDays) {
            expect(day.gap_hours).toEqual([]);
        }
    });

    it("should return no rows when tenant has no services", async () => {
        // WHO: Tenant with no services
        // WHAT: check_coverage_gaps returns empty result
        // WHY: Nothing to check coverage for
        if (!dbAvailable) return;

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1)",
            [tenantId]
        );

        expect(res.rows.length).toBe(0);
    });

    it("should respect is_off=true on employee_schedule rows", async () => {
        // WHO: Employee with deactivated shifts
        // WHAT: Coverage should show closed (no active shifts = no open hours)
        // WHY: Inactive shifts should not count as coverage
        if (!dbAvailable) return;

        const svcId = await seedService("Paint", 90);
        const empId = await seedEmployee("Painter", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        // Mark every schedule row as is_off — the equivalent of the old
        // employee_shifts.is_active=false toggle now that the platform
        // only stores date-specific entries.
        await client.query("UPDATE employee_schedule SET is_off = true, start_time = NULL, end_time = NULL WHERE employee_id = $1", [empId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        // All days should be closed since no active shifts
        for (const row of res.rows) {
            expect(row.status).toBe("closed");
        }
    });

    it("should exclude soft-deleted employees", async () => {
        // WHO: Soft-deleted employee
        // WHAT: Coverage should show closed (deleted employee doesn't count)
        // WHY: is_deleted employees are excluded from all queries
        if (!dbAvailable) return;

        const svcId = await seedService("Welding", 45);
        const empId = await seedEmployee("Deleted Worker", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        await client.query("UPDATE employees SET is_deleted = true, deleted_at = now() WHERE employee_id = $1", [empId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        // All days should be closed since employee is deleted
        for (const row of res.rows) {
            expect(row.status).toBe("closed");
        }
    });
});
