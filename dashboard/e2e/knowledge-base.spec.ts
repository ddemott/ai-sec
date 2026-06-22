/**
 * E2E coverage for the Knowledge Base (KB) feature.
 *
 * WHO: business owner managing the AI receptionist's knowledge
 * WHAT: CRUD for KB entries, unanswered-question queue + resolve,
 *       website-import endpoint validation, isolation between tenants
 * WHEN: every route in src/routes/knowledge.ts (GET/POST/PUT/DELETE /knowledge,
 *       GET/PATCH /knowledge/unanswered, POST /knowledge/import-website)
 * WHERE: SecretaryHQ backend (https://localhost:4001)
 * WHY: The KB drives the AI's policy-answer tool; gaps here = callers getting
 *      "I don't know" when the answer is in the owner's config. Only
 *      full-functional-audit test 8 previously touched this surface (just
 *      checks the heading loads). This spec pins the full API contract.
 *
 * Tests:
 *   1. add + list — POST /knowledge/add persists entry; GET /knowledge returns it
 *   2. update — PUT /knowledge/:id updates question + answer + re-embeds
 *   3. delete — DELETE /knowledge/:id removes the row; GET no longer returns it
 *   4. add sad — missing answer (<10 chars) is rejected 400
 *   5. delete sad — wrong tenant cannot delete another tenant's entry (404)
 *   6. unanswered queue — direct-INSERT + GET /knowledge/unanswered lists it
 *   7. resolve unanswered — PATCH /knowledge/unanswered/:id/resolve marks resolved;
 *      subsequent GET excludes it
 *   8. resolve sad — wrong tenant cannot resolve another tenant's entry (404)
 *   9. website-import validation — invalid URL returns 400 (no OpenAI call)
 *  10. cross-tenant isolation — tenant A cannot read tenant B's KB entries
 *  11. suggestion approve — seed knowledge_suggestion + PATCH confirmed ingests
 *      it into the live KB (source='website-scan') and flips status
 *  12. suggestion reject — PATCH rejected discards without touching the KB
 *  13. suggestion isolation — tenant B cannot approve tenant A's suggestion (404)
 *  14. website-import (stubbed) — real resolver (bank + custom questions) →
 *      staging INSERT; custom question reaches the DB (KNOWLEDGE_IMPORT_E2E_STUB)
 */

import { test, expect } from './helpers/test';
import { Pool } from 'pg';
import {
  BACKEND_URL,
  PG_URL,
  registerFreshTenant,
  cleanTenantData,
  type RegisteredTenant,
} from './helpers/fixtures';

let pool: Pool;

test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL });
});
test.afterAll(async () => {
  await pool.end();
});

// ────────────────────────────────────────────────────────────────────────────
// 1. Add + list
// ────────────────────────────────────────────────────────────────────────────
test('kb-add-list: POST /knowledge/add persists entry visible in GET /knowledge', async ({
  request,
}) => {
  // WHO: owner adding a new FAQ entry via the Phone Assistant > Knowledge Base tab
  // WHAT: POST /knowledge/add with question + answer inserts a tenant_docs row;
  //       GET /knowledge returns it with tenant_doc_id and source fields
  // WHEN: first-time KB setup or adding a new policy
  // WHERE: src/routes/knowledge.ts /knowledge/add → /knowledge
  // WHY: this is the core KB write path. Regression = agents give stale or
  //      empty answers to callers asking about policies.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    const addRes = await request.post(`${BACKEND_URL}/knowledge/add`, {
      headers: hdr,
      data: {
        tenant_id: tenant.tenantId,
        question: 'What are your hours?',
        answer: 'We are open Monday through Friday 8am to 6pm and Saturday 9am to 3pm.',
        category: 'hours',
      },
    });
    expect(addRes.status()).toBe(200);
    const addBody = await addRes.json();
    expect(addBody.success).toBe(true);
    expect(addBody.tenant_doc_id).toBeTruthy();

    const listRes = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenant.tenantId}`, {
      headers: hdr,
    });
    expect(listRes.status()).toBe(200);
    const entries = await listRes.json();
    expect(Array.isArray(entries)).toBe(true);
    const found = entries.find(
      (e: { tenant_doc_id: string }) => e.tenant_doc_id === addBody.tenant_doc_id
    );
    expect(found, 'newly added entry must appear in list').toBeTruthy();
    expect(found.title).toBe('What are your hours?');
    expect(found.source).toBeTruthy();
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Update
// ────────────────────────────────────────────────────────────────────────────
test('kb-update: PUT /knowledge/:id updates question and answer', async ({ request }) => {
  // WHO: owner editing an existing entry after a policy change
  // WHAT: PUT /knowledge/:id replaces question/answer/embedding in tenant_docs
  // WHEN: hours changed, pricing updated, new policy wording
  // WHERE: src/routes/knowledge.ts PUT /knowledge/:id
  // WHY: stale KB entries cause agents to relay outdated info; update path
  //      must overwrite all fields including the embedding vector
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    // Create entry
    const addRes = await request.post(`${BACKEND_URL}/knowledge/add`, {
      headers: hdr,
      data: {
        tenant_id: tenant.tenantId,
        question: 'Do you accept walk-ins?',
        answer: 'Yes, we accept walk-ins during business hours when space is available.',
      },
    });
    const { tenant_doc_id } = await addRes.json();

    // Update it
    const updRes = await request.put(`${BACKEND_URL}/knowledge/${tenant_doc_id}`, {
      headers: hdr,
      data: {
        tenant_id: tenant.tenantId,
        question: 'Do you accept walk-ins?',
        answer:
          'Walk-ins are welcome Monday to Thursday only. Fridays are by appointment only now.',
      },
    });
    expect(updRes.status()).toBe(200);
    const updBody = await updRes.json();
    expect(updBody.success).toBe(true);

    // Verify updated content persisted
    const listRes = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenant.tenantId}`, {
      headers: hdr,
    });
    const entries = await listRes.json();
    const found = entries.find((e: { tenant_doc_id: string }) => e.tenant_doc_id === tenant_doc_id);
    expect(found, 'updated entry must still exist').toBeTruthy();
    expect(found.content).toContain('Fridays are by appointment only');
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Delete
// ────────────────────────────────────────────────────────────────────────────
test('kb-delete: DELETE /knowledge/:id removes entry from the list', async ({ request }) => {
  // WHO: owner removing an outdated or incorrect KB entry
  // WHAT: DELETE /knowledge/:id soft or hard deletes the tenant_docs row;
  //       subsequent GET /knowledge does not return it
  // WHEN: policy removed (service discontinued, location closed)
  // WHERE: src/routes/knowledge.ts DELETE /knowledge/:id
  // WHY: stale/incorrect KB entries cause the AI to give wrong answers.
  //      Deletion must be permanent and reflected immediately.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    const addRes = await request.post(`${BACKEND_URL}/knowledge/add`, {
      headers: hdr,
      data: {
        tenant_id: tenant.tenantId,
        question: 'Do you offer military discounts?',
        answer:
          'Yes, we offer a ten percent discount for all active and veteran military personnel.',
      },
    });
    const { tenant_doc_id } = await addRes.json();

    const delRes = await request.delete(`${BACKEND_URL}/knowledge/${tenant_doc_id}`, {
      headers: { Authorization: `Bearer ${tenant.token}`, 'Content-Type': 'application/json' },
      data: { tenant_id: tenant.tenantId },
    });
    expect(delRes.status()).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.success).toBe(true);

    const listRes = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenant.tenantId}`, {
      headers: hdr,
    });
    const entries = await listRes.json();
    const stillThere = entries.find(
      (e: { tenant_doc_id: string }) => e.tenant_doc_id === tenant_doc_id
    );
    expect(stillThere, 'deleted entry must not appear in list').toBeUndefined();
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Add sad — validation
// ────────────────────────────────────────────────────────────────────────────
test('kb-add-sad-validation: answer shorter than 10 chars is rejected 400', async ({ request }) => {
  // WHO: operator submitting an incomplete KB entry
  // WHAT: POST /knowledge/add with answer.length < 10 is rejected with 400
  //       and validation error details; no row inserted
  // WHEN: accidental form submission with empty or very short answer
  // WHERE: knowledgeEntrySchema z.string().min(10, ...) in knowledge.ts
  // WHY: embedding a content-free entry would pollute the vector space and
  //      cause irrelevant documents to rank high in RAG queries
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    const res = await request.post(`${BACKEND_URL}/knowledge/add`, {
      headers: hdr,
      data: {
        tenant_id: tenant.tenantId,
        question: 'What is your return policy?',
        answer: 'No.', // 3 chars — below the 10-char minimum
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);

    // Verify nothing was inserted
    const listRes = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenant.tenantId}`, {
      headers: hdr,
    });
    const entries = await listRes.json();
    expect(entries.length).toBe(0);
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Delete sad — wrong tenant
// ────────────────────────────────────────────────────────────────────────────
test('kb-delete-sad-wrong-tenant: cannot delete another tenant entry (404)', async ({
  request,
}) => {
  // WHO: malicious or misconfigured client attempting cross-tenant data access
  // WHAT: tenant B uses DELETE /knowledge/:id with tenant B's JWT to try to
  //       delete an entry belonging to tenant A — should 404 (row not found
  //       under tenant B's RLS context)
  // WHEN: any attempt to delete by ID without matching tenant ownership
  // WHERE: assertRowAffected() in DELETE /knowledge/:id → 404 on 0-row delete
  //        + RLS WHERE tenant_id = current_tenant_id prevents the row matching
  // WHY: KB isolation is critical — a business's policies must never be
  //      readable or deletable by another tenant
  let tenantA: RegisteredTenant | null = null;
  let tenantB: RegisteredTenant | null = null;
  try {
    [tenantA, tenantB] = await Promise.all([
      registerFreshTenant(request),
      registerFreshTenant(request),
    ]);

    // Tenant A adds an entry
    const hdrA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantA.token}` };
    const addRes = await request.post(`${BACKEND_URL}/knowledge/add`, {
      headers: hdrA,
      data: {
        tenant_id: tenantA.tenantId,
        question: 'What is the cancellation policy?',
        answer: 'Cancellations must be made at least 24 hours in advance to avoid a fee.',
      },
    });
    const { tenant_doc_id } = await addRes.json();

    // Tenant B tries to delete it using their own token + tenant_id
    const hdrB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantB.token}` };
    const delRes = await request.delete(`${BACKEND_URL}/knowledge/${tenant_doc_id}`, {
      headers: hdrB,
      data: { tenant_id: tenantB.tenantId },
    });
    expect(delRes.status()).toBe(404);

    // Original entry still exists under tenant A
    const listRes = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenantA.tenantId}`, {
      headers: hdrA,
    });
    const entries = await listRes.json();
    const stillThere = entries.find(
      (e: { tenant_doc_id: string }) => e.tenant_doc_id === tenant_doc_id
    );
    expect(stillThere, 'tenant A entry must survive tenant B delete attempt').toBeTruthy();
  } finally {
    await Promise.all([
      tenantA ? cleanTenantData(pool, tenantA.tenantId) : Promise.resolve(),
      tenantB ? cleanTenantData(pool, tenantB.tenantId) : Promise.resolve(),
    ]);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Unanswered queue — list
// ────────────────────────────────────────────────────────────────────────────
test('kb-unanswered-list: GET /knowledge/unanswered returns unresolved questions', async ({
  request,
}) => {
  // WHO: owner checking the KB gap report after seeing the AI say "I don't know"
  // WHAT: direct INSERT of an unanswered_question row (simulates agent logging
  //       a question it couldn't answer); GET /knowledge/unanswered returns it
  // WHEN: periodic KB review to identify coverage gaps
  // WHERE: src/routes/knowledge.ts GET /knowledge/unanswered
  // WHY: the unanswered-question queue is how owners discover what to add to
  //      their KB next; if the route breaks, gaps are invisible
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { Authorization: `Bearer ${tenant.token}` };

    // Simulate agent inserting an unanswered question (normally done by
    // policy-answer tool when similarity score < threshold)
    await pool.query(
      `INSERT INTO unanswered_questions (tenant_id, question, caller_phone)
       VALUES ($1, $2, $3)`,
      [tenant.tenantId, 'Do you offer financing?', '+15550000001']
    );

    const res = await request.get(
      `${BACKEND_URL}/knowledge/unanswered?tenant_id=${tenant.tenantId}`,
      { headers: hdr }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.questions)).toBe(true);
    const q = body.questions.find(
      (q: { question: string }) => q.question === 'Do you offer financing?'
    );
    expect(q, 'inserted unanswered question must appear in list').toBeTruthy();
    expect(q.resolved).toBe(false);
    expect(q.unanswered_question_id).toBeTruthy();
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Unanswered queue — resolve
// ────────────────────────────────────────────────────────────────────────────
test('kb-unanswered-resolve: PATCH /knowledge/unanswered/:id/resolve marks resolved and hides it', async ({
  request,
}) => {
  // WHO: owner who addressed a gap question by adding a KB entry
  // WHAT: PATCH .../resolve sets resolved=true; subsequent GET /knowledge/unanswered
  //       no longer returns the row (WHERE resolved = false)
  // WHEN: owner clicks "Mark resolved" after updating the KB
  // WHERE: src/routes/knowledge.ts PATCH /knowledge/unanswered/:id/resolve
  // WHY: resolved questions cluttering the queue makes it hard to see real gaps
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    // Insert two questions; only resolve one; verify the other remains
    const ins = await pool.query(
      `INSERT INTO unanswered_questions (tenant_id, question)
       VALUES ($1, $2), ($1, $3)
       RETURNING unanswered_question_id`,
      [tenant.tenantId, 'Do you sell tires online?', 'What brands do you carry?']
    );
    const [toResolveId, toKeepId] = ins.rows.map(
      (r: { unanswered_question_id: string }) => r.unanswered_question_id
    );

    const patchRes = await request.patch(
      `${BACKEND_URL}/knowledge/unanswered/${toResolveId}/resolve`,
      { headers: hdr, data: { tenant_id: tenant.tenantId } }
    );
    expect(patchRes.status()).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.success).toBe(true);

    // GET must no longer include the resolved one; must still have the other
    const listRes = await request.get(
      `${BACKEND_URL}/knowledge/unanswered?tenant_id=${tenant.tenantId}`,
      { headers: { Authorization: `Bearer ${tenant.token}` } }
    );
    const body = await listRes.json();
    const ids = body.questions.map(
      (q: { unanswered_question_id: string }) => q.unanswered_question_id
    );
    expect(ids, 'resolved question must not appear in unresolved list').not.toContain(toResolveId);
    expect(ids, 'unresolved question must still appear').toContain(toKeepId);
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Resolve sad — wrong tenant
// ────────────────────────────────────────────────────────────────────────────
test('kb-resolve-sad-wrong-tenant: cannot resolve another tenant unanswered question (404)', async ({
  request,
}) => {
  // WHO: malicious client with a valid JWT for their own tenant trying to
  //      resolve another tenant's unanswered question by guessing its ID
  // WHAT: PATCH /knowledge/unanswered/:id/resolve with wrong-tenant JWT → 404
  //       (RLS blocks the UPDATE; assertRowAffected returns 404 on 0 rows)
  // WHEN: any cross-tenant resolve attempt
  // WHERE: PATCH route assertRowAffected + RLS tenant_id filter
  // WHY: unanswered questions may reveal sensitive call context (caller_phone,
  //      caller_message); isolation is non-negotiable
  let tenantA: RegisteredTenant | null = null;
  let tenantB: RegisteredTenant | null = null;
  try {
    [tenantA, tenantB] = await Promise.all([
      registerFreshTenant(request),
      registerFreshTenant(request),
    ]);

    const ins = await pool.query(
      `INSERT INTO unanswered_questions (tenant_id, question)
       VALUES ($1, $2) RETURNING unanswered_question_id`,
      [tenantA.tenantId, 'Do you offer fleet pricing?']
    );
    const questionId = ins.rows[0].unanswered_question_id;

    const hdrB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantB.token}` };
    const patchRes = await request.patch(
      `${BACKEND_URL}/knowledge/unanswered/${questionId}/resolve`,
      { headers: hdrB, data: { tenant_id: tenantB.tenantId } }
    );
    expect(patchRes.status()).toBe(404);

    // Verify it's still unresolved in tenant A's queue
    const row = await pool.query(
      `SELECT resolved FROM unanswered_questions WHERE unanswered_question_id = $1`,
      [questionId]
    );
    expect(
      row.rows[0]?.resolved,
      'question must remain unresolved after failed cross-tenant patch'
    ).toBe(false);
  } finally {
    await Promise.all([
      tenantA ? cleanTenantData(pool, tenantA.tenantId) : Promise.resolve(),
      tenantB ? cleanTenantData(pool, tenantB.tenantId) : Promise.resolve(),
    ]);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 9. Website-import validation — invalid URL
// ────────────────────────────────────────────────────────────────────────────
test('kb-website-import-sad-invalid-url: POST /knowledge/import-website rejects non-URL', async ({
  request,
}) => {
  // WHO: owner mistyping their website address in the onboarding scan field
  // WHAT: POST /knowledge/import-website with a non-URL string returns 400
  //       before any network or OpenAI call
  // WHEN: any malformed URL input in the website-scan form
  // WHERE: websiteImportSchema z.string().url() in knowledge.ts
  // WHY: invalid URLs must fail fast at the schema layer, not hang waiting for
  //      a fetch() timeout or burn an OpenAI API call
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    const res = await request.post(`${BACKEND_URL}/knowledge/import-website`, {
      headers: hdr,
      data: { tenant_id: tenant.tenantId, url: 'not-a-url' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/url|URL/i);
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 10. Cross-tenant isolation — GET /knowledge
// ────────────────────────────────────────────────────────────────────────────
test('kb-isolation: tenant B cannot read tenant A KB entries', async ({ request }) => {
  // WHO: two unrelated business owners each with their own KB
  // WHAT: tenant A adds KB entries; tenant B's GET /knowledge returns only
  //       their own entries (empty), never tenant A's
  // WHEN: any multi-tenant deployment where two businesses share the platform
  // WHERE: RLS on tenant_docs table + requireTenantId middleware
  // WHY: business policies are confidential; leaking one business's hours or
  //      pricing to a competitor would be a trust-breaking data breach
  let tenantA: RegisteredTenant | null = null;
  let tenantB: RegisteredTenant | null = null;
  try {
    [tenantA, tenantB] = await Promise.all([
      registerFreshTenant(request),
      registerFreshTenant(request),
    ]);

    const hdrA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantA.token}` };
    const hdrB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantB.token}` };

    // Tenant A seeds two entries
    await Promise.all([
      request.post(`${BACKEND_URL}/knowledge/add`, {
        headers: hdrA,
        data: {
          tenant_id: tenantA.tenantId,
          question: 'What is your secret pricing structure?',
          answer: 'Our confidential pricing starts at $99 per service unit for premium clients.',
        },
      }),
      request.post(`${BACKEND_URL}/knowledge/add`, {
        headers: hdrA,
        data: {
          tenant_id: tenantA.tenantId,
          question: 'Do you have a VIP program?',
          answer:
            'Yes, our VIP program is available to clients spending over $500 per month with us.',
        },
      }),
    ]);

    // Tenant B's GET must return empty (their own KB has no entries)
    const bList = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenantB.tenantId}`, {
      headers: hdrB,
    });
    expect(bList.status()).toBe(200);
    const bEntries = await bList.json();
    expect(Array.isArray(bEntries)).toBe(true);
    expect(bEntries.length, 'tenant B must see 0 KB entries (only tenant A has any)').toBe(0);

    // Tenant A's GET returns exactly their 2 entries
    const aList = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenantA.tenantId}`, {
      headers: hdrA,
    });
    const aEntries = await aList.json();
    expect(aEntries.length).toBe(2);
  } finally {
    await Promise.all([
      tenantA ? cleanTenantData(pool, tenantA.tenantId) : Promise.resolve(),
      tenantB ? cleanTenantData(pool, tenantB.tenantId) : Promise.resolve(),
    ]);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 11. Suggestion lifecycle — approve a website-scan suggestion → ingests to KB
//
// The OpenAI website-scan itself (POST /knowledge/import-website happy path) is
// not CI-safe — it needs a real OpenAI call + a real external site fetch. So we
// seed a knowledge_suggestion row directly (the same shape the scan produces)
// and exercise the CI-safe half of the onboarding flow: the owner reviewing and
// approving a staged suggestion, which must ingest it into the live RAG KB.
// ────────────────────────────────────────────────────────────────────────────
test('kb-suggestion-approve: PATCH confirmed ingests a staged suggestion into the live KB', async ({
  request,
}) => {
  // WHO: owner reviewing AI-extracted Q&A after a website scan during onboarding
  // WHAT: a 'suggested' knowledge_suggestion row, once PATCHed status=confirmed,
  //       is written into tenant_docs (source='website-scan') AND its status flips
  // WHEN: setup wizard "Import from website" step → review suggestions → approve
  // WHERE: PATCH /knowledge/suggestions/:id (confirm branch) in knowledge.ts
  // WHY: approval is the only path a scanned answer reaches the AI. Regression =
  //      owner approves but the caller still gets "I don't know".
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    const question = 'Do you offer mobile service?';
    const answer =
      'Yes, we come to your home or office anywhere in the metro area for a small travel fee.';
    const ins = await pool.query(
      `INSERT INTO knowledge_suggestion
         (tenant_id, question_id, question, answer, source_url, confidence, status)
       VALUES ($1, NULL, $2, $3, $4, $5, 'suggested')
       RETURNING id`,
      [tenant.tenantId, question, answer, 'https://example-shop.com/services', 0.92]
    );
    const suggestionId = ins.rows[0].id as string;

    // Owner sees it in the review queue
    const listRes = await request.get(
      `${BACKEND_URL}/knowledge/suggestions?tenant_id=${tenant.tenantId}`,
      { headers: hdr }
    );
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    expect(
      listBody.suggestions.some((s: { id: string }) => s.id === suggestionId),
      'seeded suggestion must appear in the review queue'
    ).toBe(true);

    // Approve → ingest
    const patchRes = await request.patch(`${BACKEND_URL}/knowledge/suggestions/${suggestionId}`, {
      headers: hdr,
      data: { tenant_id: tenant.tenantId, status: 'confirmed' },
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).success).toBe(true);

    // It now lives in the KB with source='website-scan'
    const kbRes = await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenant.tenantId}`, {
      headers: hdr,
    });
    const entries = await kbRes.json();
    const ingested = entries.find((e: { title: string }) => e.title === question);
    expect(ingested, 'approved suggestion must appear in the live KB').toBeTruthy();
    expect(ingested.source).toBe('website-scan');

    // And it is no longer in the 'suggested' queue
    const queueAfter = await (
      await request.get(`${BACKEND_URL}/knowledge/suggestions?tenant_id=${tenant.tenantId}`, {
        headers: hdr,
      })
    ).json();
    expect(queueAfter.suggestions.some((s: { id: string }) => s.id === suggestionId)).toBe(false);

    // DB confirms the status flip
    const statusRow = await pool.query(`SELECT status FROM knowledge_suggestion WHERE id = $1`, [
      suggestionId,
    ]);
    expect(statusRow.rows[0].status).toBe('confirmed');
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 11b. Website-scan HAPPY path (deterministic via KNOWLEDGE_IMPORT_E2E_STUB)
//
// Closes the gap the test above documents: with the stub enabled (CI sets
// KNOWLEDGE_IMPORT_E2E_STUB=1) the scan needs no real OpenAI call or external
// fetch, so the full onboarding scan → staged-suggestions path IS CI-safe. This
// exercises the wizard's "Import from website" step end-to-end at the API layer:
// owner submits a URL → the resolver (bank + custom questions) runs → answers are
// staged as knowledge_suggestion rows for review. Skipped when the stub is off so
// it never makes a live network/OpenAI call on a local run.
// ────────────────────────────────────────────────────────────────────────────
test('kb-website-import-happy: scanning a URL stages reviewable suggestions (stub)', async ({
  request,
}) => {
  // WHO: owner pasting their website URL on the wizard's "Import from website" step
  // WHAT: POST /knowledge/import-website returns success with a confirmed count
  //       and the extracted answers land in the suggestions review queue
  // WHEN: onboarding scan, with the deterministic E2E stub active
  // WHERE: POST /knowledge/import-website (stub branch) + the staging INSERTs
  // WHY: the scan is the entry point of the whole KB-onboarding flow; a regression
  //      here means owners scan their site and get nothing to review.
  test.skip(
    process.env.KNOWLEDGE_IMPORT_E2E_STUB !== '1',
    'website-scan happy path requires KNOWLEDGE_IMPORT_E2E_STUB=1 (no live OpenAI/network)'
  );

  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    const res = await request.post(`${BACKEND_URL}/knowledge/import-website`, {
      headers: hdr,
      data: { tenant_id: tenant.tenantId, url: 'https://example-shop.com' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // The stub confirms at least the first bank questions and surfaces a
    // discovered topic, so something is always staged for the owner to review.
    expect(body.confirmed, 'scan should confirm at least one answer').toBeGreaterThan(0);

    // Those answers are now in the review queue.
    const queue = await (
      await request.get(`${BACKEND_URL}/knowledge/suggestions?tenant_id=${tenant.tenantId}`, {
        headers: hdr,
      })
    ).json();
    expect(queue.success).toBe(true);
    expect(
      queue.suggestions.length,
      'scan must stage suggestions for the owner to review'
    ).toBeGreaterThan(0);
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 12. Suggestion lifecycle — reject discards without ingesting
// ────────────────────────────────────────────────────────────────────────────
test('kb-suggestion-reject: PATCH rejected discards a suggestion without touching the KB', async ({
  request,
}) => {
  // WHO: owner declining an off-base AI-extracted suggestion
  // WHAT: a rejected suggestion flips to status='rejected', leaves the queue, and
  //       is NOT written into the live KB
  // WHEN: review step — owner sees a wrong/irrelevant scanned answer
  // WHERE: PATCH /knowledge/suggestions/:id (reject branch) in knowledge.ts
  // WHY: rejection must never pollute the KB; a rejected answer reaching the AI
  //      would have the owner's voice say something they explicitly declined
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    const question = 'Do you sell extended warranties?';
    const ins = await pool.query(
      `INSERT INTO knowledge_suggestion
         (tenant_id, question_id, question, answer, source_url, confidence, status)
       VALUES ($1, NULL, $2, $3, $4, $5, 'suggested')
       RETURNING id`,
      [tenant.tenantId, question, 'Some hallucinated answer.', 'https://example-shop.com', 0.4]
    );
    const suggestionId = ins.rows[0].id as string;

    const patchRes = await request.patch(`${BACKEND_URL}/knowledge/suggestions/${suggestionId}`, {
      headers: hdr,
      data: { tenant_id: tenant.tenantId, status: 'rejected' },
    });
    expect(patchRes.status()).toBe(200);

    // Not in the KB
    const entries = await (
      await request.get(`${BACKEND_URL}/knowledge?tenant_id=${tenant.tenantId}`, { headers: hdr })
    ).json();
    expect(entries.some((e: { title: string }) => e.title === question)).toBe(false);

    // Status flipped to rejected
    const statusRow = await pool.query(`SELECT status FROM knowledge_suggestion WHERE id = $1`, [
      suggestionId,
    ]);
    expect(statusRow.rows[0].status).toBe('rejected');
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 13. Suggestion isolation — cannot approve another tenant's suggestion
// ────────────────────────────────────────────────────────────────────────────
test('kb-suggestion-sad-wrong-tenant: cannot approve another tenant suggestion (404, no ingest)', async ({
  request,
}) => {
  // WHO: tenant B attempting to act on tenant A's staged suggestion
  // WHAT: PATCH with B's auth on A's suggestion id returns 404 and ingests nothing
  // WHEN: any multi-tenant deployment
  // WHERE: RLS-scoped SELECT in PATCH /knowledge/suggestions/:id
  // WHY: one business approving/ingesting into another's KB would be a breach
  let tenantA: RegisteredTenant | null = null;
  let tenantB: RegisteredTenant | null = null;
  try {
    [tenantA, tenantB] = await Promise.all([
      registerFreshTenant(request),
      registerFreshTenant(request),
    ]);
    const hdrB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantB.token}` };

    const ins = await pool.query(
      `INSERT INTO knowledge_suggestion
         (tenant_id, question_id, question, answer, source_url, confidence, status)
       VALUES ($1, NULL, $2, $3, $4, $5, 'suggested')
       RETURNING id`,
      [tenantA.tenantId, 'Tenant A private question?', 'Tenant A private answer.', '', 0.9]
    );
    const suggestionId = ins.rows[0].id as string;

    // Tenant B tries to approve A's suggestion (B's tenant_id matches B's JWT, so
    // middleware passes; the RLS-scoped fetch finds 0 rows → 404)
    const patchRes = await request.patch(`${BACKEND_URL}/knowledge/suggestions/${suggestionId}`, {
      headers: hdrB,
      data: { tenant_id: tenantB.tenantId, status: 'confirmed' },
    });
    expect(patchRes.status()).toBe(404);

    // A's suggestion remains untouched (still 'suggested', not ingested)
    const statusRow = await pool.query(`SELECT status FROM knowledge_suggestion WHERE id = $1`, [
      suggestionId,
    ]);
    expect(statusRow.rows[0].status).toBe('suggested');
  } finally {
    await Promise.all([
      tenantA ? cleanTenantData(pool, tenantA.tenantId) : Promise.resolve(),
      tenantB ? cleanTenantData(pool, tenantB.tenantId) : Promise.resolve(),
    ]);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 14. Website-import happy path (stubbed extraction) — real resolver → staging
//
// The real OpenAI scan is not CI-safe (CI runs OPENAI_API_KEY=sk-dummy + no
// external network). KNOWLEDGE_IMPORT_E2E_STUB=1 (set on the e2e backend in
// ci.yml; export it for a local run) swaps the fetch + LLM for deterministic
// canned output, leaving the REAL handler path under test: resolveQuestions()
// (static bank + this tenant's custom questions) → the staging INSERT loop →
// real knowledge_suggestion rows. The live OpenAI integration itself is proven
// by an on-demand manual smoke (see docs/TODO.md), not here.
// ────────────────────────────────────────────────────────────────────────────
test('kb-import-website-stub: scan resolves bank + custom questions into staged suggestions', async ({
  request,
}) => {
  // WHO: owner who added a custom question, then runs a website scan in onboarding
  // WHAT: POST /knowledge/import-website (stubbed) stages confirmed suggestions
  //       for the resolved questions — INCLUDING the owner's custom question —
  //       plus a discovered topic, all as real knowledge_suggestion rows
  // WHEN: setup wizard "Import from website" step
  // WHERE: import-website handler → resolveQuestions → staging INSERT (knowledge.ts)
  // WHY: guards the exact wiring shipped in feat/question-bank-shared — that the
  //      shared resolver's custom-question merge actually reaches the DB via the
  //      live endpoint. Skips cleanly if the stub env isn't enabled.
  if (process.env.KNOWLEDGE_IMPORT_E2E_STUB !== '1') {
    test.skip(true, 'requires KNOWLEDGE_IMPORT_E2E_STUB=1 on the backend');
  }
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    // Owner first adds a custom question (stored in tenant_docs source=custom-question)
    const customQuestion = 'Do you offer loaner cars while my car is serviced?';
    const addRes = await request.post(`${BACKEND_URL}/knowledge/add`, {
      headers: hdr,
      data: {
        tenant_id: tenant.tenantId,
        question: customQuestion,
        answer: 'Yes, we provide a complimentary loaner car for any service over two hours.',
        source: 'custom-question',
      },
    });
    expect(addRes.status()).toBe(200);

    // Run the (stubbed) scan
    const scanRes = await request.post(`${BACKEND_URL}/knowledge/import-website`, {
      headers: hdr,
      data: { tenant_id: tenant.tenantId, url: 'https://example-shop.com' },
    });
    expect(scanRes.status()).toBe(200);
    const scan = await scanRes.json();
    expect(scan.success).toBe(true);
    // 2 bank questions + 1 custom = 3 confirmed; 1 discovered = 1 suggestion
    expect(scan.confirmed).toBeGreaterThanOrEqual(3);
    expect(scan.suggestions).toBeGreaterThanOrEqual(1);
    // The owner's custom question made it into the extracted set via the resolver
    expect(
      scan.extracted.some((a: { question: string }) => a.question === customQuestion),
      'custom question must flow through resolveQuestions into the scan'
    ).toBe(true);

    // Real DB: confirmed rows staged, including the custom question; discovered staged 'suggested'
    const rows = await pool.query(
      `SELECT question, status FROM knowledge_suggestion WHERE tenant_id = $1`,
      [tenant.tenantId]
    );
    const confirmed = rows.rows.filter((r) => r.status === 'confirmed');
    const suggested = rows.rows.filter((r) => r.status === 'suggested');
    expect(confirmed.length).toBeGreaterThanOrEqual(3);
    expect(suggested.length).toBeGreaterThanOrEqual(1);
    expect(
      confirmed.some((r) => r.question === customQuestion),
      'custom question must be staged as a confirmed suggestion in the DB'
    ).toBe(true);
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});
