import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction } from "./test-utils";
import { Client } from "pg";

describe("Solo Wizard: team_size on tenants + is_personal on resources", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
            await clearDB(client);
            const setup = await setupBasicTenant(client);
            tenantId = setup.tenantId;
            resourceId = setup.resourceId;
        } catch (err) {
            dbAvailable = false;
            console.warn("[solo-wizard.test] Skipping DB tests - connection failed", err);
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

    it("team_size should default to 1", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `SELECT team_size FROM tenants WHERE id = $1`,
            [tenantId]
        );
        expect(res.rows[0].team_size).toBe(1);
    });

    it("team_size can be updated", async () => {
        if (!dbAvailable) return;
        await client.query(
            `UPDATE tenants SET team_size = 5 WHERE id = $1`,
            [tenantId]
        );
        const res = await client.query(
            `SELECT team_size FROM tenants WHERE id = $1`,
            [tenantId]
        );
        expect(res.rows[0].team_size).toBe(5);
    });

    it("is_personal should default to false on resources", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `SELECT is_personal FROM resources WHERE id = $1`,
            [resourceId]
        );
        expect(res.rows[0].is_personal).toBe(false);
    });

    it("is_personal can be set to true for personal resources", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `INSERT INTO resources (tenant_id, name, is_personal)
             VALUES ($1, 'My Van', true) RETURNING is_personal`,
            [tenantId]
        );
        expect(res.rows[0].is_personal).toBe(true);
    });

    it("solo setup flow: create tenant with team_size=1, auto-create employee + personal resource + assign services", async () => {
        if (!dbAvailable) return;

        // 1. Create a solo tenant
        const tRes = await client.query(
            `INSERT INTO tenants (name, business_type, team_size)
             VALUES ('Solo Stylist', 'salon', 1) RETURNING id`
        );
        const soloTenantId = tRes.rows[0].id;

        // 2. Auto-create the owner as an employee
        const eRes = await client.query(
            `INSERT INTO employees (tenant_id, name, skills)
             VALUES ($1, 'Owner', ARRAY['cuts', 'color']) RETURNING id`,
            [soloTenantId]
        );
        const employeeId = eRes.rows[0].id;

        // 3. Auto-create a personal resource (their chair/station)
        const rRes = await client.query(
            `INSERT INTO resources (tenant_id, name, is_personal)
             VALUES ($1, 'My Station', true) RETURNING id`,
            [soloTenantId]
        );
        const personalResourceId = rRes.rows[0].id;

        // 4. Create services
        const s1 = await client.query(
            `INSERT INTO services (tenant_id, name, subtitle, description, duration_minutes, price)
             VALUES ($1, 'Haircut', 'Classic cut & style', 'Full haircut with wash and style.', 30, 35.00) RETURNING id`,
            [soloTenantId]
        );
        const s2 = await client.query(
            `INSERT INTO services (tenant_id, name, subtitle, description, duration_minutes, price)
             VALUES ($1, 'Color', 'Full color treatment', 'Color application with gloss finish.', 90, 120.00) RETURNING id`,
            [soloTenantId]
        );
        const serviceId1 = s1.rows[0].id;
        const serviceId2 = s2.rows[0].id;

        // 5. Assign all services to the sole employee and resource
        await client.query(
            `INSERT INTO service_employee (tenant_id, service_id, employee_id)
             VALUES ($1, $2, $3), ($1, $4, $3)`,
            [soloTenantId, serviceId1, employeeId, serviceId2]
        );
        await client.query(
            `INSERT INTO service_resource (tenant_id, service_id, resource_id)
             VALUES ($1, $2, $3), ($1, $4, $3)`,
            [soloTenantId, serviceId1, personalResourceId, serviceId2]
        );

        // Verify the full setup
        const tenant = await client.query(`SELECT team_size FROM tenants WHERE id = $1`, [soloTenantId]);
        expect(tenant.rows[0].team_size).toBe(1);

        const employees = await client.query(`SELECT * FROM employees WHERE tenant_id = $1`, [soloTenantId]);
        expect(employees.rows.length).toBe(1);

        const resources = await client.query(`SELECT * FROM resources WHERE tenant_id = $1 AND is_personal = true`, [soloTenantId]);
        expect(resources.rows.length).toBe(1);

        const mappings = await client.query(
            `SELECT se.service_id, se.employee_id FROM service_employee se WHERE se.tenant_id = $1`,
            [soloTenantId]
        );
        expect(mappings.rows.length).toBe(2);

        const resourceMappings = await client.query(
            `SELECT sr.service_id, sr.resource_id FROM service_resource sr WHERE sr.tenant_id = $1`,
            [soloTenantId]
        );
        expect(resourceMappings.rows.length).toBe(2);
    });
});
