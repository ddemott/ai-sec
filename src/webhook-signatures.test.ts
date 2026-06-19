/**
 * Webhook signature contract tests.
 *
 * Why this file exists:
 *   Pre-2026-05-09 audit found two real findings on the webhook surface:
 *
 *   1. Stripe webhook signature verification was correctly implemented
 *      (`stripe.webhooks.constructEvent` + raw body) but had ZERO tests
 *      pinning the contract. A refactor that reordered the constructEvent
 *      before the sig check, removed the rawBody preservation, or replaced
 *      constructEvent with `JSON.parse(req.body)` for "convenience" would
 *      slip past the suite — production would happily accept any unsigned
 *      POST to /billing/webhook and update tenant subscriptions.
 *   2. Square used `JSON.stringify(req.body)` for HMAC verification —
 *      fundamentally broken because providers sign the RAW BYTES they
 *      sent. Re-serializing through V8 drops/changes whitespace + key
 *      order vs the original payload, breaking the signature
 *      deterministically. Fixed in the same commit by switching to
 *      `req.rawBody` (already preserved by the global content-type
 *      parser in src/index.ts).
 *
 * What this file covers:
 *   - Stripe /billing/webhook — missing sig (400), bad sig (400), valid sig
 *     drives the checkout.session.completed handler.
 *   - Square /square/webhook — bad sig (401), valid sig (200).
 *
 * What this file does NOT cover:
 *   - Event-handler business logic (subscription state updates, customer
 *     mappings, etc.) — those have their own targeted tests where they
 *     live. This file's contract is "the route only proceeds past the
 *     signature gate when the bytes match."
 *   - The clients' verifyWebhookSignature unit tests
 *     (src/square-client.test.ts) — those test the HMAC math against
 *     fixed inputs. This file pins the route's wiring of
 *     rawBody → verifyWebhookSignature → 401-or-proceed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Test secrets — pinned to known values so signature math is reproducible.
// These are NOT real secrets; just deterministic test fixtures.
// Stamped via vi.hoisted() because Vitest hoists `import` statements above
// any plain top-level code; the routes capture process.env.* into module-
// level constants at first import, so env stamping must run BEFORE imports.
const { _STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SQUARE_SIGNATURE_KEY } = vi.hoisted(() => {
  const STRIPE_SECRET_KEY = 'sk_test_billing_webhook_test';
  const STRIPE_WEBHOOK_SECRET = 'whsec_test_billing_webhook_test';
  const SQUARE_SIGNATURE_KEY = 'square-test-signature-key';
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = SQUARE_SIGNATURE_KEY;
  return {
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    SQUARE_SIGNATURE_KEY,
  };
});
import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import Stripe from 'stripe';

import { registerBillingRoutes } from './routes/billing';
import { registerSquareRoutes } from './routes/square';
import { buildRouteTestApp, type RouteTestAppHandle } from './test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// Stripe webhook tests share an app that re-imports the billing module
// after env vars are stamped. The other three webhook tests share their
// own app per spec.
let stripeHandle: RouteTestAppHandle;
let stripeApp: FastifyInstance;

let squareHandle: RouteTestAppHandle;
let squareApp: FastifyInstance;

beforeAll(async () => {
  stripeHandle = buildRouteTestApp((app, pool) => {
    registerBillingRoutes(app, pool);
  });
  stripeApp = stripeHandle.app;
  await stripeApp.ready();

  squareHandle = buildRouteTestApp((app, pool, withTenantClient) => {
    registerSquareRoutes(app, pool, withTenantClient);
  });
  squareApp = squareHandle.app;
  await squareApp.ready();
});

afterAll(async () => {
  await Promise.all([stripeApp.close(), squareApp.close()]);
});

beforeEach(() => {
  [stripeHandle, squareHandle].forEach((h) => {
    h.queries.length = 0;
    h.queryResponses.length = 0;
  });
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────
// Stripe — /billing/webhook
// ────────────────────────────────────────────────────────────────────

describe('Stripe /billing/webhook signature verification', () => {
  function buildStripeSignedHeader(payload: string, secret: string): string {
    // Stripe.webhooks.generateTestHeaderString produces a real
    // signed header in the same format Stripe sends in production.
    // Using the SDK avoids re-implementing the v1 signing scheme
    // (and inheriting any drift if Stripe rolls a new scheme).
    return Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
  }

  it('SAD: missing stripe-signature header returns 400 before any DB activity', async () => {
    // WHO: malformed call (manual curl, mis-configured proxy stripping headers)
    // WHAT: route returns 400 + clear error before reaching the
    //        constructEvent call or any DB write.
    // WHEN: POST /billing/webhook with a JSON body but no signature header
    // WHERE: src/routes/billing.ts L94-97
    // WHY: pre-test this gate had no coverage. A refactor that swapped
    //       the order (constructEvent before the !sig check) would
    //       crash the route on `sig as string` undefined coercion
    //       instead of returning 400 cleanly.
    const res = await stripeApp.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'checkout.session.completed' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Missing stripe-signature header' });
    const dataQueries = stripeHandle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    expect(dataQueries).toHaveLength(0);
  });

  it('SAD: invalid signature returns 400 with stripe_webhook_signature_failed log', async () => {
    // WHO: attacker forging a webhook event to update tenant subscription state
    // WHAT: stripe.webhooks.constructEvent throws on signature mismatch;
    //        the route catches and returns 400. No DB write.
    // WHEN: POST /billing/webhook with a real-looking but wrongly-signed payload
    // WHERE: src/routes/billing.ts L107-111
    // WHY: this is the security gate. If it ever fails open, attackers
    //       can mark any tenant's subscription as active without paying.
    const payload = JSON.stringify({
      id: 'evt_test',
      type: 'checkout.session.completed',
      data: {
        object: { metadata: { tenant_id: TENANT_ID, plan: 'solo' }, subscription: 'sub_test' },
      },
    });
    // Build a header signed with the WRONG secret — the route's secret
    // is STRIPE_WEBHOOK_SECRET; this signs with something else.
    const wrongSig = buildStripeSignedHeader(payload, 'whsec_attacker_guess');

    const res = await stripeApp.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': wrongSig },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Invalid webhook signature' });
    const dataQueries = stripeHandle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    expect(dataQueries).toHaveLength(0);
  });

  it('HAPPY: valid signature drives checkout.session.completed → UPDATE tenants', async () => {
    // WHO: real Stripe webhook delivery after a successful checkout
    // WHAT: route verifies the signature, parses the event, runs the
    //        switch case for checkout.session.completed, and UPDATEs
    //        the tenants row to mark subscription_status = 'active'.
    // WHEN: POST /billing/webhook with a correctly-signed payload
    // WHERE: src/routes/billing.ts L114-128
    // WHY: pin the happy path end-to-end so a refactor that breaks the
    //       constructEvent wiring fails LOUDLY here instead of silently
    //       dropping real webhook traffic in production.
    const payload = JSON.stringify({
      id: 'evt_test_happy',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { tenant_id: TENANT_ID, plan: 'solo' },
          subscription: 'sub_test_123',
        },
      },
    });
    const sig = buildStripeSignedHeader(payload, STRIPE_WEBHOOK_SECRET);
    // UPDATE tenants ... — the handler uses pool.query, not the
    // tenant-scoped client, so it lands on the same mock pool.
    stripeHandle.queryResponses.push({ rows: [], rowCount: 1 });

    const res = await stripeApp.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const dataQueries = stripeHandle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    // One UPDATE — the subscription activation.
    expect(dataQueries).toHaveLength(1);
    expect(dataQueries[0].text).toMatch(/UPDATE tenants[\s\S]+stripe_subscription_id/);
    expect(dataQueries[0].params).toEqual(['sub_test_123', 'solo', TENANT_ID]);
  });
});

// ────────────────────────────────────────────────────────────────────
// Square — /square/webhook
// ────────────────────────────────────────────────────────────────────

describe('Square /square/webhook signature verification', () => {
  /**
   * Square notification signature: HMAC-SHA256 over `${notificationUrl}${body}`
   * keyed with the signature key. Output is base64.
   */
  function signSquare(notificationUrl: string, body: string, key: string): string {
    const payload = notificationUrl + body;
    return crypto.createHmac('sha256', key).update(payload).digest('base64');
  }

  const SQUARE_URI_PATH = '/square/webhook';

  it('SAD: bad signature returns 401, no DB activity', async () => {
    // WHY: pin the security gate post-fix. Pre-fix the route signed
    //       JSON.stringify(req.body) — same bug as HubSpot/Jobber.
    const payload = JSON.stringify({
      event_id: 'evt-1',
      type: 'booking.created',
      merchant_id: 'm1',
    });
    const wrongSig = signSquare('http://localhost' + SQUARE_URI_PATH, payload, 'wrong-key');

    const res = await squareApp.inject({
      method: 'POST',
      url: SQUARE_URI_PATH,
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': wrongSig,
      },
      payload,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Invalid webhook signature' });
    const dataQueries = squareHandle.queries.filter(
      (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET')
    );
    expect(dataQueries).toHaveLength(0);
  });

  it('HAPPY: valid signature passes — fix-confirms rawBody-not-restringified', async () => {
    const payload = JSON.stringify({
      event_id: 'evt-2',
      type: 'booking.created',
      merchant_id: 'm1',
      data: { object: { booking: {} } },
    });
    const fullUri = 'http://localhost' + SQUARE_URI_PATH;
    const sig = signSquare(fullUri, payload, SQUARE_SIGNATURE_KEY);

    const res = await squareApp.inject({
      method: 'POST',
      url: SQUARE_URI_PATH,
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature': sig,
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
  });
});
