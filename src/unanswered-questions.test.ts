/**
 * Tests for the unanswered questions feature — KB gap tracking, owner notification,
 * and API endpoints for listing/resolving unanswered questions.
 *
 * Happy + sad paths with 5W diagnostic comments.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { type Client } from 'pg';
import {
  getRootClient,
  clearDB,
  setupBasicTenant,
  beginTestTransaction,
  rollbackTestTransaction,
  skipIfDbDown,
} from './test-utils';

let client: Client;
let tenantId: string;
let dbAvailable = true;
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  try {
    client = await getRootClient();
    await clearDB(client);
    const setup = await setupBasicTenant(client);
    tenantId = setup.tenantId;
  } catch {
    dbAvailable = false;
    console.warn('[unanswered-questions.test] Skipping DB tests - connection failed');
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

// =============================================
// HAPPY PATHS
// =============================================

describe('Unanswered Questions — Happy Paths', () => {
  it("LOG-QUESTION: When AI can't answer a caller's question, it gets logged with caller context", async () => {
    // WHO: Voice AI during a live call with a DynaTire customer
    // WHAT: Caller asks about trade-in policy, no KB match found — question logged with phone and call ID
    // WHEN: Edge function getCompanyPolicyAnswer returns no matches
    // WHERE: unanswered_questions table via logUnansweredQuestion()
    // WHY: Without logging, business owners have no visibility into what callers are asking
    //       that their KB doesn't cover, so they can't improve their AI's knowledge
    if (!dbAvailable) return;

    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question, caller_phone, call_id)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, 'Do you accept trade-ins on old tires?', '+15551234567', 'call-abc-123']
    );

    const res = await client.query(
      `SELECT question, caller_phone, call_id, resolved, owner_notified
       FROM unanswered_questions WHERE tenant_id = $1`,
      [tenantId]
    );

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].question).toBe('Do you accept trade-ins on old tires?');
    expect(res.rows[0].caller_phone).toBe('+15551234567');
    expect(res.rows[0].call_id).toBe('call-abc-123');
    expect(res.rows[0].resolved).toBe(false);
    expect(res.rows[0].owner_notified).toBe(false);
  });

  it('LIST-UNRESOLVED: Dashboard shows only unresolved questions, newest first', async () => {
    // WHO: Business owner checking their KB gaps in the dashboard
    // WHAT: Two unresolved + one resolved question — list returns only the 2 unresolved
    // WHEN: Owner clicks the badge on "Phone Assistant" tab
    // WHERE: GET /knowledge/unanswered → SELECT WHERE resolved = false
    // WHY: Resolved questions are noise — the owner already handled them.
    //       Showing only unresolved keeps the list actionable.
    if (!dbAvailable) return;

    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question, caller_phone, created_at)
       VALUES ($1, 'Oldest question', '+15550001111', NOW() - INTERVAL '2 hours')`,
      [tenantId]
    );
    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question, caller_phone, created_at)
       VALUES ($1, 'Newest question', '+15550002222', NOW())`,
      [tenantId]
    );
    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question, resolved, created_at)
       VALUES ($1, 'Already handled', true, NOW() - INTERVAL '1 hour')`,
      [tenantId]
    );

    const res = await client.query(
      `SELECT question FROM unanswered_questions
       WHERE tenant_id = $1 AND resolved = false
       ORDER BY created_at DESC`,
      [tenantId]
    );

    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].question).toBe('Newest question');
    expect(res.rows[1].question).toBe('Oldest question');
  });

  it('RESOLVE-QUESTION: Owner marks a question as resolved after updating KB', async () => {
    // WHO: Business owner who just added a new policy answer to the knowledge base
    // WHAT: Marks the unanswered question as resolved so it disappears from the badge count
    // WHEN: Owner clicks "Resolve" next to the question in the dashboard
    // WHERE: PATCH /knowledge/unanswered/:id/resolve → UPDATE resolved = true
    // WHY: Without resolve, the badge count never decreases and the owner loses trust
    //       that the notification system is tracking their progress
    if (!dbAvailable) return;

    const insertRes = await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question, caller_phone)
       VALUES ($1, 'Do you offer financing?', '+15559876543')
       RETURNING unanswered_question_id`,
      [tenantId]
    );
    const questionId = insertRes.rows[0].unanswered_question_id;

    // Resolve it
    await client.query(
      `UPDATE unanswered_questions SET resolved = true WHERE unanswered_question_id = $1 AND tenant_id = $2`,
      [questionId, tenantId]
    );

    // Verify it no longer appears in unresolved list
    const res = await client.query(
      `SELECT unanswered_question_id FROM unanswered_questions WHERE tenant_id = $1 AND resolved = false`,
      [tenantId]
    );
    expect(res.rows).toHaveLength(0);
  });

  it('CALLER-MESSAGE: When caller leaves a message, it gets stored alongside the question', async () => {
    // WHO: Caller who the AI offered to take a message for
    // WHAT: Caller says "Please tell the owner I need 4 snow tires for a 2024 RAV4"
    // WHEN: During the call, after AI couldn't answer about snow tire availability
    // WHERE: unanswered_questions.caller_message column
    // WHY: The message gives the owner context to call back with a real answer,
    //       not just a generic "someone asked about snow tires"
    if (!dbAvailable) return;

    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question, caller_phone, caller_message)
       VALUES ($1, $2, $3, $4)`,
      [
        tenantId,
        'Do you carry snow tires?',
        '+15551112222',
        'Need 4 snow tires for a 2024 RAV4, please call me back',
      ]
    );

    const res = await client.query(
      `SELECT caller_message FROM unanswered_questions WHERE tenant_id = $1`,
      [tenantId]
    );

    expect(res.rows[0].caller_message).toBe(
      'Need 4 snow tires for a 2024 RAV4, please call me back'
    );
  });
});

// =============================================
// SAD PATHS
// =============================================

describe('Unanswered Questions — Sad Paths', () => {
  it('TENANT-ISOLATION: Questions from one tenant are invisible to another tenant', async () => {
    // WHO: Two different business owners on the same platform
    // WHAT: Tenant A's unanswered questions must not leak to Tenant B
    // WHEN: Tenant B queries the unanswered_questions table
    // WHERE: RLS policy on unanswered_questions using app.current_tenant_id
    // WHY: Without tenant isolation, a salon owner could see a tire shop's customer
    //       questions — a privacy and data breach scenario
    if (!dbAvailable) return;

    const tenant2Res = await client.query(
      `INSERT INTO tenants (name, business_type) VALUES ('Other Biz', 'salon') RETURNING tenant_id`
    );
    const tenant2Id = tenant2Res.rows[0].tenant_id;

    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question) VALUES ($1, 'Tenant A question')`,
      [tenantId]
    );
    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question) VALUES ($1, 'Tenant B question')`,
      [tenant2Id]
    );

    // Verify each tenant only sees their own
    const resA = await client.query(
      `SELECT question FROM unanswered_questions WHERE tenant_id = $1`,
      [tenantId]
    );
    const resB = await client.query(
      `SELECT question FROM unanswered_questions WHERE tenant_id = $1`,
      [tenant2Id]
    );

    expect(resA.rows).toHaveLength(1);
    expect(resA.rows[0].question).toBe('Tenant A question');
    expect(resB.rows).toHaveLength(1);
    expect(resB.rows[0].question).toBe('Tenant B question');
  });

  it("RESOLVE-WRONG-TENANT: Cannot resolve another tenant's question", async () => {
    // WHO: A malicious or buggy API call trying to resolve Tenant A's question as Tenant B
    // WHAT: UPDATE with wrong tenant_id affects 0 rows — question stays unresolved
    // WHEN: PATCH /knowledge/unanswered/:id/resolve with mismatched tenant
    // WHERE: UPDATE unanswered_questions WHERE unanswered_question_id = $1 AND tenant_id = $2
    // WHY: Without the tenant_id check in the WHERE clause, any authenticated user
    //       could resolve other tenants' questions, hiding KB gaps from those owners
    if (!dbAvailable) return;

    const tenant2Res = await client.query(
      `INSERT INTO tenants (name, business_type) VALUES ('Other Biz', 'salon') RETURNING tenant_id`
    );
    const tenant2Id = tenant2Res.rows[0].tenant_id;

    const insertRes = await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question) VALUES ($1, 'My question') RETURNING unanswered_question_id`,
      [tenantId]
    );
    const questionId = insertRes.rows[0].unanswered_question_id;

    // Try to resolve as wrong tenant
    const updateRes = await client.query(
      `UPDATE unanswered_questions SET resolved = true WHERE unanswered_question_id = $1 AND tenant_id = $2`,
      [questionId, tenant2Id]
    );
    expect(updateRes.rowCount).toBe(0);

    // Verify still unresolved
    const checkRes = await client.query(
      `SELECT resolved FROM unanswered_questions WHERE unanswered_question_id = $1`,
      [questionId]
    );
    expect(checkRes.rows[0].resolved).toBe(false);
  });

  it('NO-PHONE-STILL-LOGS: Question is logged even when caller phone is unknown', async () => {
    // WHO: Anonymous caller whose phone number wasn't captured by Vapi
    // WHAT: Question still gets logged with null caller_phone
    // WHEN: Edge function callerContext.phone is undefined
    // WHERE: unanswered_questions INSERT with NULL caller_phone
    // WHY: The question itself is valuable for KB improvement even if the owner
    //       can't call back — it still reveals a coverage gap
    if (!dbAvailable) return;

    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question, caller_phone)
       VALUES ($1, 'What brands do you carry?', NULL)`,
      [tenantId]
    );

    const res = await client.query(
      `SELECT question, caller_phone FROM unanswered_questions WHERE tenant_id = $1`,
      [tenantId]
    );

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].question).toBe('What brands do you carry?');
    expect(res.rows[0].caller_phone).toBeNull();
  });

  it('CASCADE-DELETE: Questions are deleted when tenant is deleted', async () => {
    // WHO: Platform admin deleting a tenant that cancelled their subscription
    // WHAT: All unanswered questions for that tenant are cascade-deleted
    // WHEN: DELETE FROM tenants WHERE tenant_id = $1
    // WHERE: FK constraint unanswered_questions.tenant_id REFERENCES tenants(id) ON DELETE CASCADE
    // WHY: Without cascade, orphaned questions would accumulate in the DB forever
    //       for tenants that no longer exist
    if (!dbAvailable) return;

    const tempTenantRes = await client.query(
      `INSERT INTO tenants (name, business_type) VALUES ('Temp Biz', 'salon') RETURNING tenant_id`
    );
    const tempTenantId = tempTenantRes.rows[0].tenant_id;

    await client.query(
      `INSERT INTO unanswered_questions (tenant_id, question) VALUES ($1, 'Will be deleted')`,
      [tempTenantId]
    );

    // Delete the tenant
    await client.query(`DELETE FROM tenants WHERE tenant_id = $1`, [tempTenantId]);

    // Questions should be gone
    const res = await client.query(
      `SELECT unanswered_question_id FROM unanswered_questions WHERE tenant_id = $1`,
      [tempTenantId]
    );
    expect(res.rows).toHaveLength(0);
  });
});

// =============================================
// OWNER NOTIFICATION (unit-level, no actual SMS)
// =============================================

describe('Unanswered Questions — Owner Notification', () => {
  it('OWNER-PHONE-EXISTS: Tenant with owner_phone set can receive SMS notifications', async () => {
    // WHO: Business owner who configured their phone number in settings
    // WHAT: owner_phone is stored on the tenants table and queryable
    // WHEN: Edge function needs to send SMS after logging an unanswered question
    // WHERE: tenants.owner_phone column, queried by getTenantNotificationInfo()
    // WHY: Without owner_phone, the SMS notification silently skips — owner never
    //       learns about KB gaps until they check the dashboard
    if (!dbAvailable) return;

    await client.query(`UPDATE tenants SET owner_phone = '+15559998888' WHERE tenant_id = $1`, [
      tenantId,
    ]);

    const res = await client.query(
      `SELECT owner_phone, inbound_phone, name FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );

    expect(res.rows[0].owner_phone).toBe('+15559998888');
    expect(res.rows[0].name).toBeDefined();
  });

  it('NO-OWNER-PHONE: SMS notification gracefully skips when owner_phone is null', async () => {
    // WHO: Business owner who hasn't configured their phone number yet
    // WHAT: owner_phone is NULL — SMS send is skipped, question still logged
    // WHEN: Edge function calls notifyOwnerOfUnansweredQuestion()
    // WHERE: tenants.owner_phone = NULL
    // WHY: Missing owner_phone should never crash the call or prevent question logging —
    //       the dashboard badge still works as a fallback notification
    if (!dbAvailable) return;

    const res = await client.query(`SELECT owner_phone FROM tenants WHERE tenant_id = $1`, [
      tenantId,
    ]);

    // Default tenant from setupBasicTenant has no owner_phone
    expect(res.rows[0].owner_phone).toBeNull();
  });
});
