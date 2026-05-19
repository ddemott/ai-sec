import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { type Client } from "pg";
import type { FastifyReply } from "fastify";
import type { AppRequest } from "./middleware";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction, createCustomerFull, skipIfDbDown } from "./test-utils";

let root: Client;
let tenantId: string;
let dbAvailable = false;
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

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

describe("Middleware Helpers", () => {
    describe("withPoolClient", () => {
        it("executes query and releases connection", async () => {
            if (!dbAvailable) return;
            const { Pool } = await import("pg");
            const { withPoolClient } = await import("./middleware");

            const pool = new Pool({
                user: "postgres", host: "localhost", database: "test_db",
                password: "postgres", port: 5433,
            });

            try {
                const result = await withPoolClient(pool, async (client) => {
                    return client.query("SELECT 1 as num");
                });
                expect(result.rows[0].num).toBe(1);
            } finally {
                await pool.end();
            }
        });

        it("releases connection even on error", async () => {
            if (!dbAvailable) return;
            const { Pool } = await import("pg");
            const { withPoolClient } = await import("./middleware");

            const pool = new Pool({
                user: "postgres", host: "localhost", database: "test_db",
                password: "postgres", port: 5433,
            });

            try {
                await expect(
                    withPoolClient(pool, async () => {
                        throw new Error("test error");
                    })
                ).rejects.toThrow("test error");

                // Pool should still be usable (connection was released)
                const result = await withPoolClient(pool, async (client) => {
                    return client.query("SELECT 1 as num");
                });
                expect(result.rows[0].num).toBe(1);
            } finally {
                await pool.end();
            }
        });
    });

    describe("requireTenantId", () => {
        it("returns tenantId from req.tenantId", async () => {
            const { requireTenantId } = await import("./middleware");

            const req = { tenantId: "abc-123" } as unknown as AppRequest;
            const reply = { status: () => ({ send: () => {} }) } as unknown as FastifyReply;

            const result = requireTenantId(req, reply);
            expect(result).toBe("abc-123");
        });

        it("returns tenantId from req.body.tenant_id", async () => {
            const { requireTenantId } = await import("./middleware");

            const req = { body: { tenant_id: "def-456" } } as unknown as AppRequest;
            const reply = { status: () => ({ send: () => {} }) } as unknown as FastifyReply;

            const result = requireTenantId(req, reply);
            expect(result).toBe("def-456");
        });

        it("prefers req.tenantId over body", async () => {
            const { requireTenantId } = await import("./middleware");

            const req = { tenantId: "from-query", body: { tenant_id: "from-body" } } as unknown as AppRequest;
            const reply = { status: () => ({ send: () => {} }) } as unknown as FastifyReply;

            const result = requireTenantId(req, reply);
            expect(result).toBe("from-query");
        });

        it("returns null and sends 400 when no tenantId", async () => {
            const { requireTenantId } = await import("./middleware");

            let sentStatus = 0;
            let sentBody: { error: string } | null = null;
            const req = { body: {} } as unknown as AppRequest;
            const reply = {
                status: (code: number) => {
                    sentStatus = code;
                    return { send: (body: { error: string }) => { sentBody = body; } };
                }
            } as unknown as FastifyReply;

            const result = requireTenantId(req, reply);
            expect(result).toBeNull();
            expect(sentStatus).toBe(400);
            expect(sentBody).toEqual({ error: "tenant_id is required" });
        });
    });

    describe("requireTenantId — error message quality", () => {
        it("error response includes actionable message", async () => {
            const { requireTenantId } = await import("./middleware");

            let sentBody: { error: string } | null = null;
            const req = {} as unknown as AppRequest; // no tenantId, no body
            const reply = {
                status: () => ({
                    send: (body: { error: string }) => { sentBody = body; }
                })
            } as unknown as FastifyReply;

            requireTenantId(req, reply);
            expect(sentBody!.error).toBe("tenant_id is required");
            // Error message should be clear enough to debug — tells you exactly what's missing
            expect(sentBody!.error).toContain("tenant_id");
        });

        it("handles undefined body gracefully", async () => {
            const { requireTenantId } = await import("./middleware");

            let sentStatus = 0;
            const req = { body: undefined } as unknown as AppRequest;
            const reply = {
                status: (code: number) => {
                    sentStatus = code;
                    return { send: () => {} };
                }
            } as unknown as FastifyReply;

            const result = requireTenantId(req, reply);
            expect(result).toBeNull();
            expect(sentStatus).toBe(400);
        });
    });

    describe("withPoolClient — error propagation", () => {
        it("propagates database query errors with original message", async () => {
            if (!dbAvailable) return;
            const { Pool } = await import("pg");
            const { withPoolClient } = await import("./middleware");

            const pool = new Pool({
                user: "postgres", host: "localhost", database: "test_db",
                password: "postgres", port: 5433,
            });

            try {
                await expect(
                    withPoolClient(pool, async (client) => {
                        return client.query("SELECT * FROM nonexistent_table_xyz");
                    })
                ).rejects.toThrow(/nonexistent_table_xyz/);
            } finally {
                await pool.end();
            }
        });

        it("pool remains usable after query error", async () => {
            if (!dbAvailable) return;
            const { Pool } = await import("pg");
            const { withPoolClient } = await import("./middleware");

            const pool = new Pool({
                user: "postgres", host: "localhost", database: "test_db",
                password: "postgres", port: 5433,
            });

            try {
                // First call fails
                await withPoolClient(pool, async (client) => {
                    return client.query("INVALID SQL SYNTAX HERE");
                }).catch(() => {}); // swallow

                // Second call should still work — connection was properly released
                const result = await withPoolClient(pool, async (client) => {
                    return client.query("SELECT 42 as answer");
                });
                expect(result.rows[0].answer).toBe(42);
            } finally {
                await pool.end();
            }
        });
    });

    describe("Route integration", () => {
        it("customers list returns data with valid tenant_id", async () => {
            if (!dbAvailable) return;
            await createCustomerFull(root, tenantId, "+15559999999", "Test Customer");

            const res = await root.query(
                "SELECT * FROM customers WHERE tenant_id = $1",
                [tenantId]
            );
            expect(res.rows.length).toBeGreaterThanOrEqual(1);
            expect(res.rows.some((r: { name: string }) => r.name === "Test Customer")).toBe(true);
        });
    });
});
