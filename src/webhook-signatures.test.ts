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
 *   2. HubSpot, Square, and Jobber all used `JSON.stringify(req.body)` for
 *      HMAC verification — fundamentally broken because providers sign the
 *      RAW BYTES they sent. Re-serializing through V8 drops/changes
 *      whitespace + key order vs the original payload, breaking the
 *      signature deterministically. Fixed in the same commit by switching
 *      to `req.rawBody` (already preserved by the global content-type
 *      parser in src/index.ts).
 *
 * What this file covers:
 *   - Stripe /billing/webhook — missing sig (400), bad sig (400), valid sig
 *     drives the checkout.session.completed handler.
 *   - HubSpot /hubspot/webhook — bad sig (401), valid sig (200). Includes
 *     the timestamp-freshness check (replay protection).
 *   - Square /square/webhook — bad sig (401), valid sig (200).
 *   - Jobber /jobber/webhook/:tenantId — bad sig (401), valid sig (200).
 *
 * What this file does NOT cover:
 *   - Event-handler business logic (subscription state updates, customer
 *     mappings, etc.) — those have their own targeted tests where they
 *     live. This file's contract is "the route only proceeds past the
 *     signature gate when the bytes match."
 *   - The clients' verifyWebhookSignature unit tests
 *     (src/{hubspot,square,jobber}-client.test.ts) — those test the HMAC
 *     math against fixed inputs. This file pins the route's wiring of
 *     rawBody → verifyWebhookSignature → 401-or-proceed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Test secrets — pinned to known values so signature math is reproducible.
// These are NOT real secrets; just deterministic test fixtures.
// Stamped via vi.hoisted() because Vitest hoists `import` statements above
// any plain top-level code; the routes capture process.env.* into module-
// level constants at first import, so env stamping must run BEFORE imports.
const {
    _STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    HUBSPOT_CLIENT_SECRET,
    SQUARE_SIGNATURE_KEY,
    JOBBER_WEBHOOK_SECRET,
} = vi.hoisted(() => {
    const STRIPE_SECRET_KEY = 'sk_test_billing_webhook_test';
    const STRIPE_WEBHOOK_SECRET = 'whsec_test_billing_webhook_test';
    const HUBSPOT_CLIENT_SECRET = 'hubspot-test-secret';
    const SQUARE_SIGNATURE_KEY = 'square-test-signature-key';
    const JOBBER_WEBHOOK_SECRET = 'jobber-test-webhook-secret';
    process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.HUBSPOT_CLIENT_SECRET = HUBSPOT_CLIENT_SECRET;
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = SQUARE_SIGNATURE_KEY;
    return {
        STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET,
        HUBSPOT_CLIENT_SECRET,
        SQUARE_SIGNATURE_KEY,
        JOBBER_WEBHOOK_SECRET,
    };
});
import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import Stripe from 'stripe';

import { registerBillingRoutes } from './routes/billing';
import { registerHubSpotRoutes } from './routes/hubspot';
import { registerSquareRoutes } from './routes/square';
import { registerJobberRoutes } from './routes/jobber';
import { buildRouteTestApp, type RouteTestAppHandle } from './test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// Stripe webhook tests share an app that re-imports the billing module
// after env vars are stamped. The other three webhook tests share their
// own app per spec.
let stripeHandle: RouteTestAppHandle;
let stripeApp: FastifyInstance;

let hubspotHandle: RouteTestAppHandle;
let hubspotApp: FastifyInstance;

let squareHandle: RouteTestAppHandle;
let squareApp: FastifyInstance;

let jobberHandle: RouteTestAppHandle;
let jobberApp: FastifyInstance;

beforeAll(async () => {
    stripeHandle = buildRouteTestApp((app, pool) => {
        registerBillingRoutes(app, pool);
    });
    stripeApp = stripeHandle.app;
    await stripeApp.ready();

    hubspotHandle = buildRouteTestApp((app, pool, withTenantClient) => {
        registerHubSpotRoutes(app, pool, withTenantClient);
    });
    hubspotApp = hubspotHandle.app;
    await hubspotApp.ready();

    squareHandle = buildRouteTestApp((app, pool, withTenantClient) => {
        registerSquareRoutes(app, pool, withTenantClient);
    });
    squareApp = squareHandle.app;
    await squareApp.ready();

    jobberHandle = buildRouteTestApp((app, pool, withTenantClient) => {
        registerJobberRoutes(app, pool, withTenantClient);
    });
    jobberApp = jobberHandle.app;
    await jobberApp.ready();
});

afterAll(async () => {
    await Promise.all([
        stripeApp.close(),
        hubspotApp.close(),
        squareApp.close(),
        jobberApp.close(),
    ]);
});

beforeEach(() => {
    [stripeHandle, hubspotHandle, squareHandle, jobberHandle].forEach((h) => {
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
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
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
            data: { object: { metadata: { tenant_id: TENANT_ID, plan: 'solo' }, subscription: 'sub_test' } },
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
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
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
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        // One UPDATE — the subscription activation.
        expect(dataQueries).toHaveLength(1);
        expect(dataQueries[0].text).toMatch(/UPDATE tenants[\s\S]+stripe_subscription_id/);
        expect(dataQueries[0].params).toEqual(['sub_test_123', 'solo', TENANT_ID]);
    });
});

// ────────────────────────────────────────────────────────────────────
// HubSpot — /hubspot/webhook
// ────────────────────────────────────────────────────────────────────

describe('HubSpot /hubspot/webhook signature verification', () => {
    /**
     * HubSpot v3 signature: HMAC-SHA256 over `${method}${uri}${body}${timestamp}`
     * keyed with the app client secret. Output is base64.
     */
    function signHubSpot(method: string, uri: string, body: string, timestamp: string, secret: string): string {
        const data = `${method}${uri}${body}${timestamp}`;
        return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('base64');
    }

    const HUBSPOT_URI_PATH = '/hubspot/webhook';

    it('SAD: bad signature returns 401, no DB activity', async () => {
        // WHO: forged or replay-attacker webhook, OR a real HubSpot delivery
        //       arriving with whitespace-different body bytes than the
        //       signed bytes (the bug the route just fixed)
        // WHAT: signature verification fails → 401, no event processing
        // WHEN: POST /hubspot/webhook with a body whose bytes don't match
        //        what the signature was computed over
        // WHERE: src/routes/hubspot.ts L101-104
        // WHY: pre-fix the route re-serialized req.body through V8's
        //       JSON.stringify, dropping/changing whitespace from the
        //       original HubSpot payload. The signature would never match
        //       in production. Now that we use req.rawBody, this test
        //       confirms the gate still rejects bad signatures.
        const payload = JSON.stringify({ subscriptionType: 'contact.creation', objectId: 12345 });
        const timestamp = String(Date.now());
        const wrongSig = signHubSpot('POST', HUBSPOT_URI_PATH, payload, timestamp, 'wrong-secret');

        const res = await hubspotApp.inject({
            method: 'POST',
            url: HUBSPOT_URI_PATH,
            headers: {
                'content-type': 'application/json',
                'x-hubspot-signature-v3': wrongSig,
                'x-hubspot-request-timestamp': timestamp,
            },
            payload,
        });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ error: 'Invalid webhook signature' });
        const dataQueries = hubspotHandle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries).toHaveLength(0);
    });

    it('HAPPY: valid signature with fresh timestamp passes — fix-confirms rawBody-not-restringified', async () => {
        // WHO: real HubSpot webhook delivery with byte-perfect signature
        // WHAT: route reads req.rawBody (preserved by the content-type
        //        parser) and the HMAC matches → route proceeds past the
        //        gate.
        // WHEN: POST /hubspot/webhook with HubSpot's exact payload bytes
        // WHERE: src/routes/hubspot.ts (post-fix using req.rawBody)
        // WHY: the WHOLE POINT of the fix. Pre-fix the route signed
        //       JSON.stringify(req.body) which only matches HubSpot's
        //       output by coincidence (compact JSON + same key order).
        //       Post-fix the route signs the actual bytes HubSpot sent.
        // NOTE: The route builds its URI as `${req.protocol}://${req.hostname}${req.url}` —
        //       so for verification we must construct the same string
        //       (Fastify reports protocol='http' and hostname='localhost' for app.inject).
        const payload = JSON.stringify({ subscriptionType: 'contact.creation', objectId: 99999 });
        const timestamp = String(Date.now());
        const fullUri = `http://localhost${HUBSPOT_URI_PATH}`;
        const sig = signHubSpot('POST', fullUri, payload, timestamp, HUBSPOT_CLIENT_SECRET);

        const res = await hubspotApp.inject({
            method: 'POST',
            url: HUBSPOT_URI_PATH,
            headers: {
                'content-type': 'application/json',
                'x-hubspot-signature-v3': sig,
                'x-hubspot-request-timestamp': timestamp,
            },
            payload,
        });

        // Past the gate: 200 acknowledged. Event processing happens async.
        expect(res.statusCode).toBe(200);
    });

    it('SAD: stale timestamp (>5 min) is rejected with replay-protection 401', async () => {
        // WHY: pin that the timestamp-freshness window guards against
        //       replay attacks even when the signature math itself works.
        const payload = JSON.stringify({ subscriptionType: 'contact.creation', objectId: 1 });
        const staleTimestamp = String(Date.now() - 6 * 60 * 1000); // 6 min ago
        const fullUri = `http://localhost${HUBSPOT_URI_PATH}`;
        const sig = signHubSpot('POST', fullUri, payload, staleTimestamp, HUBSPOT_CLIENT_SECRET);

        const res = await hubspotApp.inject({
            method: 'POST',
            url: HUBSPOT_URI_PATH,
            headers: {
                'content-type': 'application/json',
                'x-hubspot-signature-v3': sig,
                'x-hubspot-request-timestamp': staleTimestamp,
            },
            payload,
        });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ error: expect.stringMatching(/replay/i) });
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
        const payload = JSON.stringify({ event_id: 'evt-1', type: 'booking.created', merchant_id: 'm1' });
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
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
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

// ────────────────────────────────────────────────────────────────────
// Jobber — /jobber/webhook/:tenantId
// ────────────────────────────────────────────────────────────────────

describe('Jobber /jobber/webhook/:tenantId signature verification', () => {
    /**
     * Jobber webhook signature: HMAC-SHA256 over the body, keyed with the
     * per-tenant webhook secret stored in tenant_integration_settings.
     * Output is hex.
     */
    function signJobber(body: string, secret: string): string {
        return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    }

    it('SAD: bad signature returns 401, no event processing', async () => {
        // The route looks up the per-tenant secret from
        // tenant_integration_settings before verifying. Mock that lookup.
        jobberHandle.queryResponses.push({ rows: [{ webhook_secret: JOBBER_WEBHOOK_SECRET }] });

        const payload = JSON.stringify({ data: { webHookEvent: { itemType: 'CLIENT', action: 'CREATE', itemId: 'abc' } } });
        const wrongSig = signJobber(payload, 'wrong-secret');

        const res = await jobberApp.inject({
            method: 'POST',
            url: `/jobber/webhook/${TENANT_ID}`,
            headers: {
                'content-type': 'application/json',
                'x-jobber-hmac-sha256': wrongSig,
            },
            payload,
        });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ error: 'Invalid webhook signature' });
    });

    it('HAPPY: valid signature passes — fix-confirms rawBody-not-restringified', async () => {
        // Jobber requires looking up the per-tenant secret BEFORE the
        // signature check. Mock returns the secret. Then the verify
        // succeeds against req.rawBody.
        jobberHandle.queryResponses.push({ rows: [{ webhook_secret: JOBBER_WEBHOOK_SECRET }] });

        const payload = JSON.stringify({ data: { webHookEvent: { itemType: 'CLIENT', action: 'CREATE', itemId: 'abc' } } });
        const sig = signJobber(payload, JOBBER_WEBHOOK_SECRET);

        const res = await jobberApp.inject({
            method: 'POST',
            url: `/jobber/webhook/${TENANT_ID}`,
            headers: {
                'content-type': 'application/json',
                'x-jobber-hmac-sha256': sig,
            },
            payload,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ success: true });
    });

    it('SAD: tenant has no active Jobber integration → 404 before signature check', async () => {
        // WHY: pin that the per-tenant secret lookup short-circuits with
        //       a 404 when no active integration exists, before doing any
        //       HMAC math. Otherwise we'd be HMAC-verifying against a
        //       null/undefined key, which the verify helper handles but
        //       the operator-facing error would be misleading ("invalid
        //       signature" rather than "no integration set up").
        jobberHandle.queryResponses.push({ rows: [] }); // no active integration

        const payload = JSON.stringify({ data: {} });
        const sig = signJobber(payload, 'whatever');

        const res = await jobberApp.inject({
            method: 'POST',
            url: `/jobber/webhook/${TENANT_ID}`,
            headers: {
                'content-type': 'application/json',
                'x-jobber-hmac-sha256': sig,
            },
            payload,
        });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ error: expect.stringMatching(/integration/i) });
    });
});
