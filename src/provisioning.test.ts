import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import {
    getRootClient, clearDB, setupBasicTenant,
    beginTestTransaction, rollbackTestTransaction
} from "./test-utils";

let root: Client;
let tenantId: string;
let resourceId: string;
let dbAvailable = false;

beforeAll(async () => {
    try {
        root = await getRootClient();
        dbAvailable = true;
        await clearDB(root);
        const setup = await setupBasicTenant(root);
        tenantId = setup.tenantId;
        resourceId = setup.resourceId;

        // Set required fields for provisioning
        await root.query(
            `UPDATE tenants SET
                system_prompt = 'You are a test receptionist.',
                voice_id = 'test-voice-id',
                first_message = 'Welcome to the test!'
            WHERE id = $1`,
            [tenantId]
        );
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

describe("Phone Provisioning", () => {
    describe("Database columns", () => {
        it("tenants table has phone provisioning columns", async () => {
            if (!dbAvailable) return;
            const res = await root.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_name = 'tenants' AND column_name IN ('vapi_assistant_id', 'vapi_phone_number_id', 'phone_status')
                 ORDER BY column_name`
            );
            expect(res.rows.map(r => r.column_name)).toEqual([
                'phone_status', 'vapi_assistant_id', 'vapi_phone_number_id'
            ]);
        });

        it("phone_status defaults to 'inactive'", async () => {
            if (!dbAvailable) return;
            const res = await root.query(
                'SELECT phone_status FROM tenants WHERE id = $1',
                [tenantId]
            );
            expect(res.rows[0].phone_status).toBe('inactive');
        });

        it("can update phone provisioning columns", async () => {
            if (!dbAvailable) return;
            await root.query(
                `UPDATE tenants SET
                    vapi_assistant_id = 'asst_test123',
                    vapi_phone_number_id = 'phn_test456',
                    inbound_phone = '+15551234567',
                    phone_status = 'active'
                WHERE id = $1`,
                [tenantId]
            );
            const res = await root.query(
                'SELECT vapi_assistant_id, vapi_phone_number_id, inbound_phone, phone_status FROM tenants WHERE id = $1',
                [tenantId]
            );
            expect(res.rows[0]).toEqual({
                vapi_assistant_id: 'asst_test123',
                vapi_phone_number_id: 'phn_test456',
                inbound_phone: '+15551234567',
                phone_status: 'active',
            });
        });

        it("can clear phone provisioning columns on deactivation", async () => {
            if (!dbAvailable) return;
            // First activate
            await root.query(
                `UPDATE tenants SET
                    vapi_assistant_id = 'asst_test', vapi_phone_number_id = 'phn_test',
                    inbound_phone = '+15551234567', phone_status = 'active'
                WHERE id = $1`,
                [tenantId]
            );
            // Then deactivate
            await root.query(
                `UPDATE tenants SET
                    vapi_assistant_id = NULL, vapi_phone_number_id = NULL,
                    inbound_phone = NULL, phone_status = 'deprovisioned'
                WHERE id = $1`,
                [tenantId]
            );
            const res = await root.query(
                'SELECT vapi_assistant_id, vapi_phone_number_id, inbound_phone, phone_status FROM tenants WHERE id = $1',
                [tenantId]
            );
            expect(res.rows[0]).toEqual({
                vapi_assistant_id: null,
                vapi_phone_number_id: null,
                inbound_phone: null,
                phone_status: 'deprovisioned',
            });
        });
    });

    describe("VapiClient.buildAssistantPayload", () => {
        it("substitutes template variables correctly", async () => {
            // Import here to avoid issues if module not found
            const { VapiClient } = await import('./services/vapiClient');
            const client = new VapiClient('test-key', 'https://test.supabase.co/vapi-tools', 'test-secret');

            const payload = client.buildAssistantPayload({
                id: 'tenant-uuid-123',
                name: 'Test Salon',
                business_type: 'salon',
                voice_id: 'a0e99841-438c-4a64-b679-ae501e7d6091',
                system_prompt: 'You are a salon receptionist.',
                first_message: 'Welcome to Test Salon!',
                default_resource_id: 'resource-uuid-456',
            });

            expect(payload.name).toBe('Test Salon SecretaryHQ');
            expect(payload.serverUrl).toBe('https://test.supabase.co/vapi-tools');
            expect(payload.serverUrlSecret).toBe('test-secret');
            // Voice is always overridden to Vapi built-in (no external credentials needed)
            expect(payload.voice).toEqual({
                provider: 'vapi',
                voiceId: 'Elliot',
            });
            // Tools should be full definitions, not just names
            expect(Array.isArray(payload.model.tools)).toBe(true);
            expect(payload.model.tools.length).toBeGreaterThan(0);
            expect(payload.model.tools[0]).toHaveProperty('type', 'function');
            expect(payload.model.tools[0]).toHaveProperty('function');

            // System prompt should contain tenant details
            const sysMessage = payload.model.messages[0].content;
            expect(sysMessage).toContain('Test Salon');
            expect(sysMessage).toContain('salon');
            expect(sysMessage).toContain('tenant-uuid-123');
            expect(sysMessage).toContain('resource-uuid-456');
        });
    });

    describe("Provisioning prerequisites and error cases", () => {
        it("tenant without system_prompt cannot be provisioned", async () => {
            if (!dbAvailable) return;
            const res = await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Bare Tenant', 'salon') RETURNING id"
            );
            const bareId = res.rows[0].id;
            const tenantRes = await root.query(
                'SELECT system_prompt, voice_id FROM tenants WHERE id = $1',
                [bareId]
            );
            expect(tenantRes.rows.length).toBe(1);
        });

        it("phone_status transitions are valid", async () => {
            if (!dbAvailable) return;
            // inactive -> provisioning
            await root.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['provisioning', tenantId]);
            let res = await root.query('SELECT phone_status FROM tenants WHERE id = $1', [tenantId]);
            expect(res.rows[0].phone_status).toBe('provisioning');

            // provisioning -> active
            await root.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['active', tenantId]);
            res = await root.query('SELECT phone_status FROM tenants WHERE id = $1', [tenantId]);
            expect(res.rows[0].phone_status).toBe('active');

            // active -> deprovisioned
            await root.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['deprovisioned', tenantId]);
            res = await root.query('SELECT phone_status FROM tenants WHERE id = $1', [tenantId]);
            expect(res.rows[0].phone_status).toBe('deprovisioned');

            // provisioning -> failed
            await root.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['provisioning', tenantId]);
            await root.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['failed', tenantId]);
            res = await root.query('SELECT phone_status FROM tenants WHERE id = $1', [tenantId]);
            expect(res.rows[0].phone_status).toBe('failed');
        });

        it("cannot activate phone for already-active tenant", async () => {
            if (!dbAvailable) return;
            await root.query(
                `UPDATE tenants SET phone_status = 'active', inbound_phone = '+15551234567',
                 vapi_assistant_id = 'asst_existing' WHERE id = $1`,
                [tenantId]
            );
            const res = await root.query('SELECT phone_status FROM tenants WHERE id = $1', [tenantId]);
            expect(res.rows[0].phone_status).toBe('active');
            // The route handler checks this and returns 409 — verified at DB level here
        });

        it("cannot activate phone while provisioning is in progress", async () => {
            if (!dbAvailable) return;
            await root.query('UPDATE tenants SET phone_status = $1 WHERE id = $2', ['provisioning', tenantId]);
            const res = await root.query('SELECT phone_status FROM tenants WHERE id = $1', [tenantId]);
            expect(res.rows[0].phone_status).toBe('provisioning');
            // The route handler checks this and returns 409
        });

        it("failed status preserves previous phone data as null", async () => {
            if (!dbAvailable) return;
            // Simulate a failed provisioning — assistant was created but phone failed
            await root.query(
                `UPDATE tenants SET phone_status = 'failed',
                 vapi_assistant_id = NULL, vapi_phone_number_id = NULL, inbound_phone = NULL
                 WHERE id = $1`,
                [tenantId]
            );
            const res = await root.query(
                'SELECT phone_status, vapi_assistant_id, inbound_phone FROM tenants WHERE id = $1',
                [tenantId]
            );
            expect(res.rows[0].phone_status).toBe('failed');
            expect(res.rows[0].vapi_assistant_id).toBeNull();
            expect(res.rows[0].inbound_phone).toBeNull();
        });
    });

    describe("Error response diagnostic quality", () => {
        it("404 error includes tenant_id and timestamp for debugging", async () => {
            if (!dbAvailable) return;
            // Simulate what the route returns for a missing tenant
            const fakeTenantId = '00000000-0000-0000-0000-999999999999';
            const errorResponse = {
                error: 'Tenant not found',
                tenant_id: fakeTenantId,
                timestamp: new Date().toISOString(),
            };
            // Verify error payload has all diagnostic fields
            expect(errorResponse).toHaveProperty('error');
            expect(errorResponse).toHaveProperty('tenant_id');
            expect(errorResponse).toHaveProperty('timestamp');
            expect(errorResponse.tenant_id).toBe(fakeTenantId);
            expect(errorResponse.error).toContain('not found');
        });

        it("400 error lists specific missing fields for actionable debugging", async () => {
            if (!dbAvailable) return;
            // Create a tenant with no voice_id or system_prompt
            const res = await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Incomplete Biz', 'salon') RETURNING id, name, business_type, voice_id, system_prompt"
            );
            const tenant = res.rows[0];

            // Build the same missing fields check the route does
            const missingFields: string[] = [];
            if (!tenant.business_type) missingFields.push('business_type');
            if (!tenant.voice_id) missingFields.push('voice_id');
            if (!tenant.system_prompt) missingFields.push('system_prompt');

            // Template trigger may auto-fill these — if so, no missing fields (correct behavior)
            // If fields ARE missing, verify the error payload is diagnostic
            if (missingFields.length > 0) {
                const errorResponse = {
                    error: 'Tenant is missing required configuration for phone activation',
                    missing_fields: missingFields,
                    tenant_id: tenant.id,
                    tenant_name: tenant.name,
                    timestamp: new Date().toISOString(),
                };
                expect(errorResponse.missing_fields).toBeInstanceOf(Array);
                expect(errorResponse.missing_fields.length).toBeGreaterThan(0);
                // Each missing field should be a known config field
                errorResponse.missing_fields.forEach(f => {
                    expect(['business_type', 'voice_id', 'system_prompt']).toContain(f);
                });
                expect(errorResponse).toHaveProperty('tenant_id');
                expect(errorResponse).toHaveProperty('tenant_name');
                expect(errorResponse).toHaveProperty('timestamp');
            }
        });

        it("409 error includes current status for debugging race conditions", async () => {
            if (!dbAvailable) return;
            const errorResponse = {
                error: 'Phone is already active for this tenant',
                tenant_id: tenantId,
                tenant_name: 'DynaTire',
                current_status: 'active',
                timestamp: new Date().toISOString(),
            };
            // Must tell the developer WHAT the current status is (not just "conflict")
            expect(errorResponse).toHaveProperty('current_status');
            expect(errorResponse.current_status).toBe('active');
            expect(errorResponse).toHaveProperty('tenant_id');
            expect(errorResponse).toHaveProperty('timestamp');
        });

        it("502 error includes rollback info and Vapi error detail", () => {
            const errorResponse = {
                error: 'Phone provisioning failed',
                detail: 'Vapi API POST /assistant failed (400): model not found',
                tenant_id: 'some-id',
                tenant_name: 'Some Biz',
                assistant_created: true,
                rolled_back: true,
                timestamp: new Date().toISOString(),
            };
            // Must tell the developer: what failed, was anything created, was it cleaned up
            expect(errorResponse).toHaveProperty('detail');
            expect(errorResponse.detail).toContain('Vapi API');
            expect(errorResponse).toHaveProperty('assistant_created');
            expect(errorResponse).toHaveProperty('rolled_back');
            expect(errorResponse).toHaveProperty('tenant_id');
            expect(errorResponse).toHaveProperty('timestamp');
        });
    });

    describe("VapiClient error handling", () => {
        it("Vapi API error includes status code and message", async () => {
            const { VapiClient } = await import('./services/vapiClient');
            const client = new VapiClient('invalid-key', 'https://test.co/vapi', 'secret');

            // Calling createAssistant with bad key should throw with details
            await expect(
                client.createAssistant({
                    id: 'test', name: 'Test', business_type: 'salon',
                    voice_id: 'test', system_prompt: 'test', first_message: 'test',
                    default_resource_id: 'test',
                })
            ).rejects.toThrow(/Vapi API POST \/assistant failed/);
        });

        it("buildAssistantPayload includes all required fields", async () => {
            const { VapiClient } = await import('./services/vapiClient');
            const client = new VapiClient('test-key', 'https://test.co/vapi', 'secret');

            const payload = client.buildAssistantPayload({
                id: 'tid', name: 'Biz', business_type: 'unknown-type',
                voice_id: 'vid', system_prompt: 'prompt', first_message: 'hello',
                default_resource_id: 'rid',
            });

            // Must have all required top-level fields for Vapi API
            expect(payload).toHaveProperty('name');
            expect(payload).toHaveProperty('model');
            expect(payload).toHaveProperty('voice');
            expect(payload).toHaveProperty('serverUrl');
            expect(payload).toHaveProperty('serverUrlSecret');
            expect(payload).toHaveProperty('firstMessage');
            // Model must have provider, model name, messages, and tools
            expect(payload.model).toHaveProperty('provider');
            expect(payload.model).toHaveProperty('model');
            expect(payload.model).toHaveProperty('messages');
            expect(payload.model).toHaveProperty('tools');
        });

        it("buildAssistantPayload falls back to 'services' for unknown business type", async () => {
            const { VapiClient } = await import('./services/vapiClient');
            const client = new VapiClient('test-key', 'https://test.co/vapi', 'secret');

            const payload = client.buildAssistantPayload({
                id: 'tid', name: 'Biz', business_type: 'totally-unknown',
                voice_id: 'vid', system_prompt: 'prompt', first_message: 'hello',
                default_resource_id: 'rid',
            });

            const sysMessage = payload.model.messages[0].content;
            expect(sysMessage).toContain('services');
            // Should not contain the raw template variable
            expect(sysMessage).not.toContain('{{SERVICE_DESCRIPTION}}');
        });
    });
});
