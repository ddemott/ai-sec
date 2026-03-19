import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";

describe("Coverage Gap Detection", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
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
        await clearDB(client);
        const setup = await setupBasicTenant(client);
        tenantId = setup.tenantId;
        resourceId = setup.resourceId;
    });

    // Helper: seed an employee with shifts and service assignment
    async function seedEmployee(
        name: string,
        skills: string[],
        shiftDays: number[],       // 0=Sun..6=Sat
        shiftStart: string,         // e.g. '08:00'
        shiftEnd: string,
        serviceIds: string[]
    ) {
        const res = await client.query(
            "INSERT INTO employees (tenant_id, name, first_name, last_name, skills) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [tenantId, name, name.split(' ')[0], name.split(' ')[1] || '', skills]
        );
        const empId = res.rows[0].id;

        for (const dow of shiftDays) {
            await client.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5)",
                [tenantId, empId, dow, shiftStart, shiftEnd]
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
            "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, $2, $3) RETURNING id",
            [tenantId, name, duration]
        );
        const svcId = res.rows[0].id;

        if (assignResource) {
            await client.query(
                "INSERT INTO service_resource (tenant_id, service_id, resource_id) VALUES ($1, $2, $3)",
                [tenantId, svcId, resourceId]
            );
        }

        return svcId;
    }

    it("should return 'no_staff' when service has no employees assigned", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Oil Change", 30);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        expect(res.rows.length).toBe(1);
        expect(res.rows[0].service_name).toBe("Oil Change");
        expect(res.rows[0].coverage_status).toBe("no_staff");
        expect(res.rows[0].has_qualified_staff).toBe(false);
        expect(res.rows[0].qualified_employee_count).toBe(0);
    });

    it("should return 'no_resource' when service has staff but no resource", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Detailing", 60, false); // no resource
        await seedEmployee("Mike Smith", ['{detailing}'], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        expect(res.rows.length).toBe(1);
        expect(res.rows[0].coverage_status).toBe("no_resource");
        expect(res.rows[0].has_qualified_staff).toBe(true);
        expect(res.rows[0].has_capable_resource).toBe(false);
    });

    it("should return 'full' when service is covered all open hours", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Tire Rotation", 45);
        // Mike works Mon-Fri 8-5 — covers all open hours
        await seedEmployee("Mike Smith", ['{tire-rotation}'], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        expect(res.rows.length).toBe(1);
        expect(res.rows[0].coverage_status).toBe("full");
        expect(res.rows[0].gap_hours).toBe("0");
        expect(res.rows[0].has_qualified_staff).toBe(true);
        expect(res.rows[0].has_capable_resource).toBe(true);
    });

    it("should return 'partial' when service has gaps on some days", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Brakes", 60);
        // Steve only works Mon-Wed 9-3, but Mike works Mon-Fri 8-5 (defining the open hours)
        const mikeSvcId = await seedService("Other Service", 30);
        await seedEmployee("Mike Smith", [], [1, 2, 3, 4, 5], '08:00', '17:00', [mikeSvcId]);
        await seedEmployee("Steve Jones", [], [1, 2, 3], '09:00', '15:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        const brakes = res.rows.find((r: any) => r.service_name === "Brakes");
        expect(brakes).toBeDefined();
        expect(brakes.coverage_status).toBe("partial");
        expect(Number(brakes.covered_hours)).toBeGreaterThan(0);
        expect(Number(brakes.gap_hours)).toBeGreaterThan(0);
    });

    it("should return gap_details with date, day_name, gap_start, gap_end", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Alignment", 60);
        // Only works Monday 10-12 — small coverage window against a bigger open hours set
        const otherSvcId = await seedService("Other", 30);
        await seedEmployee("Full Timer", [], [1, 2, 3, 4, 5], '08:00', '17:00', [otherSvcId]);
        await seedEmployee("Part Timer", [], [1], '10:00', '12:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        const alignment = res.rows.find((r: any) => r.service_name === "Alignment");
        expect(alignment).toBeDefined();
        expect(alignment.coverage_status).toBe("partial");

        const gaps = alignment.gap_details;
        expect(Array.isArray(gaps)).toBe(true);
        expect(gaps.length).toBeGreaterThan(0);

        // Each gap should have the expected shape
        const gap = gaps[0];
        expect(gap).toHaveProperty("date");
        expect(gap).toHaveProperty("day_name");
        expect(gap).toHaveProperty("gap_start");
        expect(gap).toHaveProperty("gap_end");
    });

    it("should return empty gap_details for fully covered services", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Quick Fix", 15);
        await seedEmployee("Always Here", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        expect(res.rows[0].coverage_status).toBe("full");
        expect(res.rows[0].gap_details).toEqual([]);
    });

    it("should handle multiple services with different coverage states", async () => {
        if (!dbAvailable) return;

        const svc1 = await seedService("Service A", 30);       // will be full
        const svc2 = await seedService("Service B", 30);       // will be no_staff
        const svc3 = await seedService("Service C", 30, false); // will be no_resource

        await seedEmployee("Worker One", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svc1]);
        await seedEmployee("Worker Two", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svc3]);

        const res = await client.query(
            "SELECT service_name, coverage_status FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE) ORDER BY service_name",
            [tenantId]
        );

        expect(res.rows.length).toBe(3);

        const statuses = Object.fromEntries(res.rows.map((r: any) => [r.service_name, r.coverage_status]));
        expect(statuses["Service A"]).toBe("full");
        expect(statuses["Service B"]).toBe("no_staff");
        expect(statuses["Service C"]).toBe("no_resource");
    });

    it("should return no rows when tenant has no services", async () => {
        if (!dbAvailable) return;

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1)",
            [tenantId]
        );

        expect(res.rows.length).toBe(0);
    });

    it("should respect is_active=false on employee shifts", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Paint", 90);
        const empId = await seedEmployee("Painter", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        // Deactivate all shifts
        await client.query("UPDATE employee_shifts SET is_active = false WHERE employee_id = $1", [empId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        // Employee exists but has no active shifts — should show uncovered (0 open hours since no one is on shift)
        expect(res.rows[0].coverage_status).toBe("uncovered");
    });

    it("should exclude soft-deleted employees", async () => {
        if (!dbAvailable) return;

        const svcId = await seedService("Welding", 45);
        const empId = await seedEmployee("Deleted Worker", [], [1, 2, 3, 4, 5], '08:00', '17:00', [svcId]);

        // Soft-delete the employee
        await client.query("UPDATE employees SET is_deleted = true, deleted_at = now() WHERE id = $1", [empId]);

        const res = await client.query(
            "SELECT * FROM check_coverage_gaps($1, '2026-03-16'::DATE, '2026-03-22'::DATE)",
            [tenantId]
        );

        expect(res.rows[0].coverage_status).toBe("no_staff");
        expect(res.rows[0].qualified_employee_count).toBe(0);
    });
});
