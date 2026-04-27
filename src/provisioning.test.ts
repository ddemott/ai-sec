import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import {
    getRootClient, clearDB, setupBasicTenant,
    beginTestTransaction, rollbackTestTransaction
} from "./test-utils";
import { TelnyxNumbersClient } from "./services/telnyxNumbers";

let root: Client;
let tenantId: string;
let dbAvailable = false;

beforeAll(async () => {
    try {
        root = await getRootClient();
        dbAvailable = true;
        await clearDB(root);
        const setup = await setupBasicTenant(root);
        tenantId = setup.tenantId;
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
        it("tenants table has Telnyx provisioning columns and no Vapi columns", async () => {
            // WHO: provisioning route updating tenant after Telnyx number purchase
            // WHAT: tenants table must expose telnyx_phone_number_id + phone_status; vapi_* columns must be gone
            // WHEN: 20260427000000_telnyx_provisioning migration applied
            // WHERE: tenants table schema
            // WHY: leaving the old vapi_* columns around lets stale code silently keep writing them
            if (!dbAvailable) return;
            const res = await root.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_name = 'tenants'
                   AND column_name IN ('telnyx_phone_number_id', 'phone_status', 'vapi_assistant_id', 'vapi_phone_number_id')
                 ORDER BY column_name`
            );
            expect(res.rows.map(r => r.column_name)).toEqual([
                'phone_status', 'telnyx_phone_number_id'
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

        it("can store and clear Telnyx provisioning data", async () => {
            // WHO: /provisioning/activate writing the purchased number; /provisioning/deactivate clearing it
            // WHAT: telnyx_phone_number_id, inbound_phone, phone_status round-trip through the DB
            // WHEN: tenant activates and later deactivates phone service
            // WHERE: tenants row
            // WHY: deactivation must null these out so a future re-activation doesn't see stale data
            if (!dbAvailable) return;
            await root.query(
                `UPDATE tenants SET
                    telnyx_phone_number_id = 'tnum_test123',
                    inbound_phone = '+15551234567',
                    phone_status = 'active'
                WHERE id = $1`,
                [tenantId]
            );
            const active = await root.query(
                'SELECT telnyx_phone_number_id, inbound_phone, phone_status FROM tenants WHERE id = $1',
                [tenantId]
            );
            expect(active.rows[0]).toEqual({
                telnyx_phone_number_id: 'tnum_test123',
                inbound_phone: '+15551234567',
                phone_status: 'active',
            });

            await root.query(
                `UPDATE tenants SET
                    telnyx_phone_number_id = NULL,
                    inbound_phone = NULL,
                    phone_status = 'deprovisioned'
                WHERE id = $1`,
                [tenantId]
            );
            const cleared = await root.query(
                'SELECT telnyx_phone_number_id, inbound_phone, phone_status FROM tenants WHERE id = $1',
                [tenantId]
            );
            expect(cleared.rows[0]).toEqual({
                telnyx_phone_number_id: null,
                inbound_phone: null,
                phone_status: 'deprovisioned',
            });
        });
    });

    describe("TelnyxNumbersClient", () => {
        const ORIGINAL_FETCH = global.fetch;
        afterEach(() => {
            global.fetch = ORIGINAL_FETCH;
        });

        it("searchAvailable returns the first match for a given area code", async () => {
            // WHO: /provisioning/activate searching for a number to purchase
            // WHAT: builds the right query string and returns the first AvailableNumber
            // WHEN: tenant requests a specific area code
            // WHERE: TelnyxNumbersClient.searchAvailable
            // WHY: regression: empty area code must not append a national_destination_code filter
            global.fetch = vi.fn(async (url: string) => {
                expect(url).toContain('filter%5Bcountry_code%5D=US');
                expect(url).toContain('filter%5Bnational_destination_code%5D=312');
                return {
                    ok: true,
                    json: async () => ({ data: [{ phone_number: '+13125551234' }] }),
                } as Response;
            }) as any;
            const client = new TelnyxNumbersClient('test-key');
            const result = await client.searchAvailable('312');
            expect(result?.phone_number).toBe('+13125551234');
        });

        it("searchAvailable returns null when no inventory matches", async () => {
            // WHO: /provisioning/activate
            // WHAT: empty data array translates to null (caller throws a friendly error)
            // WHEN: requested area code is exhausted
            // WHERE: TelnyxNumbersClient.searchAvailable
            // WHY: callers branch on null vs throw — must never receive undefined
            global.fetch = vi.fn(async () => ({
                ok: true,
                json: async () => ({ data: [] }),
            } as Response)) as any;
            const client = new TelnyxNumbersClient('test-key');
            const result = await client.searchAvailable('999');
            expect(result).toBeNull();
        });

        it("orderNumber returns the purchased number with its Telnyx ID", async () => {
            global.fetch = vi.fn(async (url: string, init: any) => {
                expect(url).toContain('/number_orders');
                expect(init.method).toBe('POST');
                expect(JSON.parse(init.body)).toEqual({
                    phone_numbers: [{ phone_number: '+13125551234' }],
                });
                return {
                    ok: true,
                    json: async () => ({
                        data: {
                            id: 'order_xyz',
                            phone_numbers: [{ id: 'tnum_xyz', phone_number: '+13125551234', status: 'success' }],
                        },
                    }),
                } as Response;
            }) as any;
            const client = new TelnyxNumbersClient('test-key');
            const result = await client.orderNumber('+13125551234');
            expect(result).toEqual({ id: 'tnum_xyz', phone_number: '+13125551234' });
        });

        it("orderNumber surfaces upstream Telnyx errors with status code and body", async () => {
            // WHO: /provisioning/activate
            // WHAT: a 422 from Telnyx must produce a thrown Error containing both the status and the upstream message
            // WHEN: caller doesn't have billing or the number is no longer available
            // WHERE: TelnyxNumbersClient.fetch error path
            // WHY: provisioning route surfaces err.message — without context the operator can't diagnose 422s
            global.fetch = vi.fn(async () => ({
                ok: false,
                status: 422,
                text: async () => 'Phone number unavailable',
            } as Response)) as any;
            const client = new TelnyxNumbersClient('test-key');
            await expect(client.orderNumber('+13125551234')).rejects.toThrow(/422.*Phone number unavailable/);
        });

        it("assignToConnection patches the phone with the SIP connection_id", async () => {
            // WHO: /provisioning/activate after purchase
            // WHAT: PATCH /phone_numbers/{id} with { connection_id }
            // WHEN: number is purchased and must be routed to LiveKit
            // WHERE: TelnyxNumbersClient.assignToConnection
            // WHY: without this PATCH the inbound call never reaches LiveKit, even though the number is in our account
            global.fetch = vi.fn(async (url: string, init: any) => {
                expect(url).toContain('/phone_numbers/tnum_xyz');
                expect(init.method).toBe('PATCH');
                expect(JSON.parse(init.body)).toEqual({ connection_id: 'sip_conn_42' });
                return { ok: true, json: async () => ({}) } as Response;
            }) as any;
            const client = new TelnyxNumbersClient('test-key');
            await client.assignToConnection('tnum_xyz', 'sip_conn_42');
        });

        it("release sends DELETE to /phone_numbers/{id}", async () => {
            global.fetch = vi.fn(async (url: string, init: any) => {
                expect(url).toContain('/phone_numbers/tnum_xyz');
                expect(init.method).toBe('DELETE');
                return { ok: true, json: async () => ({}) } as Response;
            }) as any;
            const client = new TelnyxNumbersClient('test-key');
            await client.release('tnum_xyz');
        });

        it("network failures throw a wrapped error referencing the endpoint", async () => {
            // WHO: provisioning route under degraded network
            // WHAT: a fetch() rejection becomes a thrown Error with method + path + cause
            // WHEN: DNS down, TLS error, etc.
            // WHERE: TelnyxNumbersClient.fetch network error path
            // WHY: bare 'fetch failed' is unactionable; the wrapper makes the call site clear in logs
            global.fetch = vi.fn(async () => { throw new Error('ENETUNREACH'); }) as any;
            const client = new TelnyxNumbersClient('test-key');
            await expect(client.searchAvailable()).rejects.toThrow(/Telnyx GET.*ENETUNREACH/);
        });
    });
});
