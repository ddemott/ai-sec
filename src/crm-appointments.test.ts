import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, createEmployee, createCustomerFull, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from "./test-utils";
import { type Client } from "pg";

describe("CRM Unified: Customer Appointments Endpoint", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let customerId: string;
    let dbAvailable = true;
    beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

    beforeAll(async () => {
        try {
            client = await getRootClient();
            await clearDB(client);
            const setup = await setupBasicTenant(client);
            tenantId = setup.tenantId;
            resourceId = setup.resourceId;
            customerId = setup.customerId;
        } catch (err) {
            dbAvailable = false;
            console.warn("[crm-appointments.test] Skipping DB tests - connection failed", err);
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

    it("should return appointments for a specific customer with resource and employee names", async () => {
        if (!dbAvailable) return;

        // Create an employee
        const employeeId = await createEmployee(client, tenantId, "Mike Tech");

        // Create two appointments for this customer. date_trunc('hour') so
        // start/end land on :00 — the 15-min CHECK constraint added 2026-
        // 05-08 (appointments_start_time_15min, appointments_end_time_15min)
        // rejects NOW()-based times that aren't grid-aligned.
        await client.query(
            `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status, employee_id)
             VALUES ($1, $2, $3,
                     date_trunc('hour', NOW() + interval '1 day'),
                     date_trunc('hour', NOW() + interval '1 day') + interval '1 hour',
                     'Oil Change', 'scheduled', $4)`,
            [tenantId, resourceId, customerId, employeeId]
        );
        await client.query(
            `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
             VALUES ($1, $2, $3,
                     date_trunc('hour', NOW() - interval '3 days'),
                     date_trunc('hour', NOW() - interval '3 days') + interval '1 hour',
                     'Tire Rotation', 'completed')`,
            [tenantId, resourceId, customerId]
        );

        // Query that the new endpoint should use
        const res = await client.query(
            `SELECT a.appointment_id, a.start_time, a.end_time, a.status, a.description, a.location,
                    r.name as resource_name,
                    e.name as employee_name
             FROM appointments a
             LEFT JOIN resources r ON r.resource_id = a.resource_id
             LEFT JOIN employees e ON e.employee_id = a.employee_id
             WHERE a.customer_id = $1 AND a.tenant_id = $2
             ORDER BY a.start_time DESC`,
            [customerId, tenantId]
        );

        expect(res.rows).toHaveLength(2);
        // Most recent first (future appointment)
        expect(res.rows[0].description).toBe('Oil Change');
        expect(res.rows[0].resource_name).toBe('Truck 1');
        expect(res.rows[0].employee_name).toBe('Mike Tech');
        expect(res.rows[0].status).toBe('scheduled');
        // Older appointment
        expect(res.rows[1].description).toBe('Tire Rotation');
        expect(res.rows[1].status).toBe('completed');
        expect(res.rows[1].employee_name).toBeNull(); // no employee assigned
    });

    it("should return empty array when customer has no appointments", async () => {
        if (!dbAvailable) return;

        const res = await client.query(
            `SELECT a.appointment_id, a.start_time, a.end_time, a.status, a.description, a.location,
                    r.name as resource_name,
                    e.name as employee_name
             FROM appointments a
             LEFT JOIN resources r ON r.resource_id = a.resource_id
             LEFT JOIN employees e ON e.employee_id = a.employee_id
             WHERE a.customer_id = $1 AND a.tenant_id = $2
             ORDER BY a.start_time DESC`,
            [customerId, tenantId]
        );

        expect(res.rows).toHaveLength(0);
    });

    it("should not return appointments belonging to other customers", async () => {
        if (!dbAvailable) return;

        // Create a second customer
        const otherCustomerId = await createCustomerFull(client, tenantId, "+15559990000", "Other Customer");

        // Create appointment for the other customer (15-min grid required —
        // see comment above on `date_trunc('hour', ...)` for context).
        await client.query(
            `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
             VALUES ($1, $2, $3,
                     date_trunc('hour', NOW() + interval '2 days'),
                     date_trunc('hour', NOW() + interval '2 days') + interval '1 hour',
                     'Brake Check', 'scheduled')`,
            [tenantId, resourceId, otherCustomerId]
        );

        // Query for original customer should return nothing
        const res = await client.query(
            `SELECT a.appointment_id FROM appointments a
             WHERE a.customer_id = $1 AND a.tenant_id = $2`,
            [customerId, tenantId]
        );

        expect(res.rows).toHaveLength(0);
    });

    it("should support canceling an appointment by updating status", async () => {
        if (!dbAvailable) return;

        // Create a scheduled appointment (15-min grid required — see above).
        const apptRes = await client.query(
            `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
             VALUES ($1, $2, $3,
                     date_trunc('hour', NOW() + interval '1 day'),
                     date_trunc('hour', NOW() + interval '1 day') + interval '1 hour',
                     'Alignment', 'scheduled')
             RETURNING appointment_id`,
            [tenantId, resourceId, customerId]
        );
        const appointmentId = apptRes.rows[0].appointment_id;

        // Cancel it (status update, not delete)
        await client.query(
            "UPDATE appointments SET status = 'canceled' WHERE appointment_id = $1 AND tenant_id = $2",
            [appointmentId, tenantId]
        );

        const checkRes = await client.query(
            "SELECT status FROM appointments WHERE appointment_id = $1",
            [appointmentId]
        );
        expect(checkRes.rows[0].status).toBe('canceled');
    });

    it("should return call summaries joined with call_transcripts for enhanced history", async () => {
        if (!dbAvailable) return;

        const callId = 'call-abc-123';

        // Insert a call summary
        await client.query(
            `INSERT INTO call_summaries (tenant_id, customer_id, call_id, summary)
             VALUES ($1, $2, $3, 'Customer asked about tire pricing')`,
            [tenantId, customerId, callId]
        );

        // Insert a call transcript for the same call
        await client.query(
            `INSERT INTO call_transcripts (tenant_id, call_id, raw_text)
             VALUES ($1, $2, 'Hello, I wanted to ask about tire prices...')`,
            [tenantId, callId]
        );

        // Enhanced query joining summaries with transcripts
        const res = await client.query(
            `SELECT cs.*, ct.created_at as call_timestamp, ct.raw_text IS NOT NULL as has_transcript
             FROM call_summaries cs
             LEFT JOIN call_transcripts ct ON ct.call_id = cs.call_id
             WHERE cs.tenant_id = $1 AND cs.customer_id = $2
             ORDER BY cs.created_at DESC`,
            [tenantId, customerId]
        );

        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].summary).toBe('Customer asked about tire pricing');
        expect(res.rows[0].has_transcript).toBe(true);
        expect(res.rows[0].call_timestamp).toBeDefined();
    });
});
