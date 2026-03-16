import { Client } from "pg";

export const ROOT_DB_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5433/test_db";
// Derived API URL: extract host/port/dbname from ROOT_DB_URL but use api_user
const apiHostPortDb = ROOT_DB_URL.split('@')[1] || "localhost:5433/test_db";
export const API_DB_URL = `postgres://api_user:api_password@${apiHostPortDb}`;

export async function getRootClient() {
    const client = new Client({ connectionString: ROOT_DB_URL });
    await client.connect();
    return client;
}

export async function getApiClient() {
    const client = new Client({ connectionString: API_DB_URL });
    await client.connect();
    return client;
}

export async function clearDB(client: Client) {
    await client.query("TRUNCATE tenants, resources, customers, appointments, call_summaries, call_transcripts, soft_reservations, users, services, employees, employee_shifts, service_employee, service_resource, tenant_docs, tenant_skills CASCADE;");
}

export async function setupBasicTenant(client: Client) {
    const tRes = await client.query("INSERT INTO tenants (name, business_type) VALUES ('DynaTire', 'mobile-tire') RETURNING id;");
    const tenantId = tRes.rows[0].id;
    const rRes = await client.query("INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck 1') RETURNING id;", [tenantId]);
    const resourceId = rRes.rows[0].id;
    const cRes = await client.query("INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id;", [tenantId]);
    const customerId = cRes.rows[0].id;
    
    return { tenantId, resourceId, customerId };
}
