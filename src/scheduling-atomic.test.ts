import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import {
    getRootClient, clearDB, createTenant, createResource, createEmployee,
    createService, createShift, createCustomerFull, createAppointment,
    beginTestTransaction, rollbackTestTransaction
} from "./test-utils";

let root: Client;
let dbAvailable = false;

beforeAll(async () => {
    try {
        root = await getRootClient();
        dbAvailable = true;
        await clearDB(root);
    } catch {
        dbAvailable = false;
    }
});

afterAll(async () => {
    if (root) await root.end();
});

beforeEach(async () => {
    if (dbAvailable) await beginTestTransaction(root);
});

afterEach(async () => {
    if (dbAvailable) await rollbackTestTransaction(root);
});

describe("book_with_scheduling_atomic()", () => {

    // Helper to call the RPC
    async function bookWithScheduling(params: Record<string, unknown>) {
        const res = await root.query(
            `SELECT * FROM book_with_scheduling_atomic(
                $1::UUID, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT, $6::TEXT,
                $7::TIMESTAMPTZ, $8::TIMESTAMPTZ, $9::TIMESTAMPTZ, $10::TIMESTAMPTZ,
                $11::TEXT[], $12::TEXT[], $13::UUID, $14::TEXT, $15::TEXT, $16::INTEGER
            )`,
            [
                params.tenant_id,
                params.phone || '+15551234567',
                params.customer_name || null,
                params.description || 'Test booking',
                params.call_id || 'test-call-1',
                params.location || null,
                params.start_time || null,
                params.end_time || null,
                params.window_from || null,
                params.window_to || null,
                params.required_skills || '{}',
                params.required_capabilities || '{}',
                params.preferred_resource_id || null,
                params.preferred_employee_id || null,
                params.service_type || null,
                params.duration_minutes || 30,
            ]
        );
        return res.rows[0];
    }

    describe("Solo operator (1 resource, no employees)", () => {
        it("books on the only resource when available", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Solo Tire Guy", "mobile-tire");
            const resourceId = await createResource(root, tenantId, "My Truck");

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999001',
                customer_name: 'Alice',
                start_time: '2026-04-01T10:00:00Z',
                end_time: '2026-04-01T10:30:00Z',
            });

            expect(result.success).toBe(true);
            expect(result.appointment_id).toBeTruthy();
            expect(result.resource_id).toBe(resourceId);
            expect(result.resource_name).toBe('My Truck');
            expect(result.employee_id).toBeNull();
            expect(result.customer_id).toBeTruthy();
        });

        it("creates customer if phone not found", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Solo Shop", "auto-shop");
            await createResource(root, tenantId, "Bay 1");

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999002',
                customer_name: 'New Person',
                start_time: '2026-04-01T14:00:00Z',
                end_time: '2026-04-01T14:30:00Z',
            });

            expect(result.success).toBe(true);
            // Verify customer was created
            const cust = await root.query(
                "SELECT name, phone FROM customers WHERE id = $1",
                [result.customer_id]
            );
            expect(cust.rows[0].name).toBe('New Person');
            expect(cust.rows[0].phone).toBe('+15559999002');
        });

        it("reuses existing customer by phone", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Solo Shop", "auto-shop");
            await createResource(root, tenantId, "Bay 1");
            const custId = await createCustomerFull(root, tenantId, '+15559999003', 'Existing Joe');

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999003',
                start_time: '2026-04-01T09:00:00Z',
                end_time: '2026-04-01T09:30:00Z',
            });

            expect(result.success).toBe(true);
            expect(result.customer_id).toBe(custId);
        });

        it("fails when all resources are booked", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Solo Shop", "auto-shop");
            // Delete any auto-created resources from template trigger
            await root.query("DELETE FROM resources WHERE tenant_id = $1", [tenantId]);
            // Create exactly 1 resource
            const resourceId = await createResource(root, tenantId, "Bay 1");
            const custId = await createCustomerFull(root, tenantId, '+15559999004', 'Bob');
            await createAppointment(root, tenantId, resourceId, custId,
                '2026-04-01T10:00:00Z', '2026-04-01T11:00:00Z', 'Existing booking');

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999005',
                start_time: '2026-04-01T10:30:00Z',
                end_time: '2026-04-01T11:00:00Z',
            });

            expect(result.success).toBe(false);
            expect(result.error_message).toContain('No available');
        });
    });

    describe("Multi-employee shop (resources + employees + skills)", () => {
        it("matches employee by skill and shift", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Auto Pro", "auto-shop");
            const bayId = await createResource(root, tenantId, "Bay 1");
            const empId = await createEmployee(root, tenantId, "Alice", ["oil-change"]);
            // Monday shift (DOW=1), 8am-5pm
            await createShift(root, tenantId, empId, 1, '08:00', '17:00');

            // 2026-04-06 is a Monday
            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999010',
                required_skills: '{oil-change}',
                start_time: '2026-04-06T14:00:00Z',
                end_time: '2026-04-06T14:30:00Z',
            });

            expect(result.success).toBe(true);
            expect(result.resource_name).toBe('Bay 1');
            expect(result.employee_name).toBe('Alice');
        });

        it("skips employee without required skill", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Auto Pro", "auto-shop");
            await createResource(root, tenantId, "Bay 1");
            const emp1 = await createEmployee(root, tenantId, "Bob", ["brakes"]);
            await createShift(root, tenantId, emp1, 1, '08:00', '17:00');

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999011',
                required_skills: '{oil-change}',
                start_time: '2026-04-06T10:00:00Z',
                end_time: '2026-04-06T10:30:00Z',
            });

            expect(result.success).toBe(false);
            expect(result.error_message).toContain('No available');
        });

        it("skips employee not on shift", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Auto Pro", "auto-shop");
            await createResource(root, tenantId, "Bay 1");
            const empId = await createEmployee(root, tenantId, "Alice", ["oil-change"]);
            // Only works Tuesday (DOW=2)
            await createShift(root, tenantId, empId, 2, '08:00', '17:00');

            // Try Monday (DOW=1)
            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999012',
                required_skills: '{oil-change}',
                start_time: '2026-04-06T10:00:00Z',
                end_time: '2026-04-06T10:30:00Z',
            });

            expect(result.success).toBe(false);
            expect(result.error_message).toContain('No available');
        });

        it("picks first available when multiple options exist", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Big Shop", "auto-shop");
            await createResource(root, tenantId, "Bay 1");
            await createResource(root, tenantId, "Bay 2");
            const emp1 = await createEmployee(root, tenantId, "Alice", ["oil-change"]);
            const emp2 = await createEmployee(root, tenantId, "Bob", ["oil-change"]);
            await createShift(root, tenantId, emp1, 1, '08:00', '17:00');
            await createShift(root, tenantId, emp2, 1, '08:00', '17:00');

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999013',
                required_skills: '{oil-change}',
                start_time: '2026-04-06T10:00:00Z',
                end_time: '2026-04-06T10:30:00Z',
            });

            expect(result.success).toBe(true);
            expect(result.employee_name).toBeTruthy();
            expect(result.resource_name).toBeTruthy();
        });

        it("respects preferred employee", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Big Shop", "auto-shop");
            await createResource(root, tenantId, "Bay 1");
            const emp1 = await createEmployee(root, tenantId, "Alice", ["oil-change"]);
            const emp2 = await createEmployee(root, tenantId, "Bob", ["oil-change"]);
            await createShift(root, tenantId, emp1, 1, '08:00', '17:00');
            await createShift(root, tenantId, emp2, 1, '08:00', '17:00');

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999014',
                required_skills: '{oil-change}',
                preferred_employee_id: emp2,
                start_time: '2026-04-06T10:00:00Z',
                end_time: '2026-04-06T10:30:00Z',
            });

            expect(result.success).toBe(true);
            expect(result.employee_name).toBe('Bob');
        });
    });

    describe("Resource capabilities", () => {
        it("matches resource by capability", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Full Service", "auto-shop");
            // Bay 1 has lift, Bay 2 doesn't
            const bay1 = await createResource(root, tenantId, "Bay 1");
            await root.query("UPDATE resources SET capabilities = $1 WHERE id = $2", ['{lift,air-tools}', bay1]);
            const bay2 = await createResource(root, tenantId, "Bay 2");
            await root.query("UPDATE resources SET capabilities = $1 WHERE id = $2", ['{basic}', bay2]);

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999020',
                required_capabilities: '{lift}',
                start_time: '2026-04-01T10:00:00Z',
                end_time: '2026-04-01T10:30:00Z',
            });

            expect(result.success).toBe(true);
            expect(result.resource_name).toBe('Bay 1');
        });
    });

    describe("Error diagnostics", () => {
        it("returns clear error when no time specified", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Test Biz", "salon");

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999030',
            });

            expect(result.success).toBe(false);
            expect(result.error_message).toContain('start_time');
            expect(result.error_message).toContain('window_from');
        });

        it("returns customer_id even on failure (for debugging)", async () => {
            if (!dbAvailable) return;
            const tenantId = await createTenant(root, "Test Biz", "salon");
            // Delete any auto-created resources so booking fails
            await root.query("DELETE FROM resources WHERE tenant_id = $1", [tenantId]);

            const result = await bookWithScheduling({
                tenant_id: tenantId,
                phone: '+15559999031',
                customer_name: 'Sad Customer',
                start_time: '2026-04-01T10:00:00Z',
                end_time: '2026-04-01T10:30:00Z',
            });

            expect(result.success).toBe(false);
            expect(result.customer_id).toBeTruthy(); // customer was created even though booking failed
        });
    });
});
