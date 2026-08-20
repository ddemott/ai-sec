/**
 * Real-DB guard: the n8n appointment webhook is gone and stays gone.
 *
 * 5W:
 *   WHO  — every caller who books, on every tenant
 *   WHAT — no trigger, no function, no column for the n8n webhook
 *   WHEN — every appointment INSERT
 *   WHERE— migration 20260821000000_drop_n8n_webhook.sql
 *   WHY  — `notify_n8n_on_appointment()` was SECURITY DEFINER, ran on EVERY
 *          appointment INSERT, and began with a SELECT against `tenants` inside
 *          the booking transaction before discovering it had nothing to do. Had
 *          `pg_net` ever been installed alongside a configured URL, the HTTP
 *          POST would have run SYNCHRONOUSLY inside that transaction — blocking
 *          `book_with_scheduling_atomic` on an external host while it held the
 *          GiST exclusion constraints that make booking race-safe. A slow
 *          webhook endpoint would have become a booking outage.
 *
 * WHY REAL POSTGRES: the whole thing is schema. A mocked pool has no triggers,
 * so a mock could only assert that the migration file contains the words I typed
 * into it. Only the catalog can say the objects are actually absent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Client } from 'pg';
import { getRootClient, skipIfDbDown } from '../utils';

let setup: Client;
let dbAvailable = false;

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    dbAvailable = true;
  } catch (err) {
    console.warn('[n8nWebhookRemoved.realdb] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (setup) await setup.end();
});

beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

describe('n8n appointment webhook — removed from the schema', () => {
  it('the AFTER INSERT trigger on appointments is gone', async () => {
    // WHY: this is the one that actually cost something — it fired on every
    //      booking, forever, for an integration nobody could configure.
    const res = await setup.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_trigger WHERE tgname = 'trigger_notify_n8n_appointment'`
    );
    expect(Number(res.rows[0].n)).toBe(0);
  });

  it('the SECURITY DEFINER function is gone', async () => {
    // WHY: a SECURITY DEFINER function that survives its trigger is a loaded
    //      gun with the trigger removed — anything able to CALL it still runs
    //      as the definer.
    const res = await setup.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_proc WHERE proname = 'notify_n8n_on_appointment'`
    );
    expect(Number(res.rows[0].n)).toBe(0);
  });

  it('tenants.n8n_webhook_url is gone', async () => {
    // WHY: a column with no reader and no writer is a claim the product makes
    //      and cannot honour. Verified empty on prod (0 non-null values) before
    //      the drop, so nothing was lost with it.
    const res = await setup.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenants'
          AND column_name = 'n8n_webhook_url'`
    );
    expect(Number(res.rows[0].n)).toBe(0);
  });

  it('appointments can still be inserted (the trigger drop broke nothing)', async () => {
    // WHO: any booking at all.
    // WHY: dropping a trigger from the write path must be proven by WRITING,
    //      not by reading the catalog. A leftover dependency would surface here
    //      as an error on INSERT rather than as a missing-object query.
    const t = await setup.query<{ tenant_id: string }>(
      `INSERT INTO tenants (name, business_type) VALUES ('n8n Drop Guard', 'salon')
       RETURNING tenant_id`
    );
    const tenantId = t.rows[0].tenant_id;
    try {
      // appointments.resource_id is NOT NULL. The tenant INSERT already creates
      // a default resource, so reuse it rather than inventing a second one.
      const r = await setup.query<{ resource_id: string }>(
        `SELECT resource_id FROM resources WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
      expect(r.rows.length).toBe(1);
      // Times must sit on the 15-minute grid (appointments_end_time_15min), so
      // truncate to the hour rather than using a raw now()+1day.
      // customer_id is NOT NULL too — a real booking always has a caller.
      const c = await setup.query<{ customer_id: string }>(
        `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, 'Guard Customer', '+15550009999')
         RETURNING customer_id`,
        [tenantId]
      );
      const appt = await setup.query<{ appointment_id: string }>(
        `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status)
         VALUES ($1, $2, $3,
                 date_trunc('hour', now() + interval '1 day'),
                 date_trunc('hour', now() + interval '1 day') + interval '30 minutes',
                 'scheduled')
         RETURNING appointment_id`,
        [tenantId, r.rows[0].resource_id, c.rows[0].customer_id]
      );
      expect(appt.rows[0].appointment_id).toBeTruthy();
    } finally {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [tenantId]);
    }
  });
});
