# Security Posture

**Last reviewed:** 2026-05-09 (security review pass 1 + pass 2 — webhook signature verification, RLS coverage, JWT/refresh, AGENT_SECRET rotation)

This is a baseline of the production-surface security posture so future audits start from a known shape rather than re-deriving it. Each section names the threat, the current control, where it lives, and any gaps left open with a rationale.

## Threat model

SecretaryHQ is a multi-tenant voice-AI receptionist SaaS for service businesses. The realistic threats:

- **Cross-tenant data leak** — tenant A reading or writing tenant B's customers, appointments, or voice transcripts. Highest-stakes class of breach for this platform.
- **Webhook forgery** — attacker forging a Stripe / Square / Telnyx webhook to manipulate subscription state, customer records, or call routing. (The HubSpot / Jobber / ServiceTitan CRM webhooks were removed 2026-06-12 with those integrations; Square sync was retained.)
- **Account takeover** — password-reset token exfiltration, JWT theft, or replay of an old token after credential rotation.
- **Agent worker impersonation** — caller forging `/agent-tools/*` requests to read a tenant's booking data, customer context, or trigger fraudulent bookings without being on a real call.

Out of scope (not a multi-tenant SaaS concern at this stage): DDoS, application-layer DoS, supply-chain via npm dependencies, encryption-at-rest beyond what Supabase managed Postgres + Railway provide.

## Multi-tenant isolation (cross-tenant leak)

**Control: row-level security with FORCE, plus per-request middleware gate.**

- `tenants.id` is a UUID; every tenant-scoped table has a `tenant_id` column FK'd to it with `ON DELETE CASCADE`.
- `set_tenant_context(uuid)` sets a session-local GUC (`app.current_tenant_id`); `withTenantClient(tenantId, fn)` in `src/database/index.ts` wraps every tenant-scoped route in a checkout-set-fn-clear-release lifecycle.
- All 29 tenant-scoped tables have `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a policy of the shape `tenant_id::text = current_setting('app.current_tenant_id', true)`.
- The application middleware adds defense in depth: `tenantMiddleware` in `src/middleware.ts` rejects any request that supplies `?tenant_id=<other>` or `body.tenant_id=<other>` differing from the JWT's `tenant_id` (unless caller is super-admin). Closed cross-tenant override gap on 2026-05-06.
- **Unauthenticated tenant-route access closed 2026-05-21.** The 2026-05-06 override guard only fired when a `jwtTenant` already existed — it never covered the case of *no JWT at all*. An anonymous request (no `Authorization` header) with `?tenant_id=<uuid>` (or a body `tenant_id`) had `tenantMiddleware`'s `candidate || jwtTenant` resolve to the attacker-supplied value; `requireTenantId` accepted it (it also read `body.tenant_id` directly); `withTenantClient` scoped RLS to it; and the route returned that tenant's data — read **and** write **and** delete — with zero authentication. RLS faithfully scoped to the attacker-chosen tenant; RLS was never authentication. Fix: `tenantMiddleware` now rejects any non-public, non-tenant-exempt request lacking `req.auth` with `401` before any tenant resolution; `requireTenantId` no longer falls back to `body.tenant_id` and returns `401` (not the misleading `400`) when there is no authenticated session. Public routes (login, password reset, demo, metrics, OAuth callbacks, HMAC-signed webhooks) and secret-authed `/agent-tools/*` (tenant-exempt) are unaffected.
- `/tenants/*` admin routes gated by `requireSuperAdmin()` (added 2026-05-06).
- 39 multi-tenant isolation probes (`src/multi-tenant-isolation.test.ts`) run on every CI build against real Postgres, exercising query-string override + body-FK injection + cross-tenant id under JWT-only + **unauthenticated `?tenant_id=` access (read/write/delete)** + admin-route gating + RLS configuration metadata.

**Gaps acknowledged:**

- Local test Postgres uses a SUPERUSER+BYPASSRLS `postgres` role. RLS is bypassed in that role regardless of FORCE. The probes use `api_user` (non-super, non-BYPASSRLS) for behavioral cross-tenant tests. Production runs against Supabase-managed Postgres where the `postgres` role is non-super (otherwise the FORCE migrations from 2026-03-23 would have been pointless). FORCE-vs-managed-postgres behavior is not tested locally — it has to be verified post-deploy.
- `audit_log` is `SECURITY DEFINER` so the audit trigger bypasses RLS to write rows. The trigger itself is internal and only ever fires from already-tenant-scoped INSERTs/UPDATEs/DELETEs.

## Webhook signature verification

**Control: HMAC verification against the raw request body for every external webhook.**

| Webhook | Header | Algorithm | Verifier | Test |
|---|---|---|---|---|
| Stripe `/billing/webhook` | `stripe-signature` | Stripe v1 (constructEvent) | `stripe.webhooks.constructEvent` | `webhook-signatures.test.ts` |
| Square `/square/webhook` | `x-square-hmacsha256-signature` | HMAC-SHA256 over `${notificationUrl}${body}`, base64 | `squareClient.verifyWebhookSignature` | `webhook-signatures.test.ts` |
| Telnyx (SIP, not HTTP) | n/a | n/a — SIP layer auth via SIP Connection ID | n/a | n/a |

> The HubSpot / Jobber / ServiceTitan CRM webhooks (and their HMAC verifiers) were removed 2026-06-12 along with those integrations. Stripe and Square are the remaining HMAC-verified HTTP webhooks.

**Critical correctness detail:** all HMAC verifications use `req.rawBody` (preserved by the global content-type parser at `src/index.ts:142`), NOT `JSON.stringify(req.body)`. Re-serializing through V8 doesn't byte-match the original payload (whitespace, key order, number formatting differ), so signature math fails deterministically. This was a bug from 2026-04-22 to 2026-05-09 in the HubSpot/Square/Jobber routes; fixed in commit `4c3205d`. (The HubSpot/Jobber routes were later removed entirely on 2026-06-12; the rule still applies to the surviving Stripe and Square webhooks.)

Square also verifies HMAC against `${notificationUrl}${body}` rather than the body alone, so the registered notification URL must match exactly.

## Password reset flow

**Control: short-lived single-use tokens + per-user invalidation timestamp + RLS.**

- `/forgot-password` issues a 32-byte random token, stores its SHA-256 hash in `password_resets`, and emails the raw token. Always returns 200 (no email-existence oracle). Rate-limited 3/hour per IP.
- `/reset-password` looks up by token hash, verifies expiry + not-yet-used, updates `users.password_hash` + `users.password_changed_at = NOW()`, marks the row used.
- `password_resets` has RLS enabled with FORCE + a policy that only allows access when `app.current_tenant_id` is empty. The `/forgot-password` and `/reset-password` routes run via `withPoolClient` (no setTenantContext call), so they remain authorized; any authenticated tenant session is denied (defense in depth — there's no production caller that should ever read this table from a tenant-scoped connection). Closed RLS-zero gap on 2026-05-09.

## JWT / session management

**Control: 8-hour stateless tokens with password-rotation revocation.**

- `JWT_EXPIRY = 8h` (configurable via env var).
- Every authenticated request goes through `registerJwtAuthHook` which (a) verifies the JWT signature + expiry, (b) looks up `users.password_changed_at` and rejects tokens with `iat < password_changed_at` epoch.
- `/auth/refresh` issues a fresh 8h token to anyone with a valid current token (sliding window).
- Password rotation IS the revocation mechanism: changing a password invalidates all outstanding tokens for that user.

**Gaps acknowledged:**

- No global denylist. A compromised token can't be revoked mid-window without a password change. Mitigation: admin can run `UPDATE users SET password_changed_at = NOW() WHERE id = '<user>'` to force-invalidate sessions without changing the password, but this has no UI surface today.
- 8h is long for an access token. Reasonable for a B2B dashboard where users stay logged in across a workday; would tighten if we ever ship a public API where token theft is more likely.
- `/auth/refresh` lets anyone with a valid token extend indefinitely — there's no maximum session lifetime. Acceptable for the current threat model.

## Agent secret (`/agent-tools/*` auth)

**Control: shared-secret HMAC-style header, constant-time compared, with hot-rotation support.**

- Every `/agent-tools/*` route is gated by `x-agent-secret: $AGENT_SECRET` header.
- Comparison uses `crypto.timingSafeEqual` (added 2026-05-09) with a length-mismatch guard so timing-channel probes cannot extract the secret one byte at a time.
- Rotation is hot-swappable via `AGENT_SECRET` (primary) + `AGENT_SECRET_OLD` (transitional). To rotate:
  1. Generate a new secret (32+ chars).
  2. On the backend Railway service, set `AGENT_SECRET = <new>` AND `AGENT_SECRET_OLD = <old>`. Both values are accepted during the transition.
  3. On the agent-worker Railway service, set `AGENT_SECRET = <new>` and redeploy.
  4. Once every worker is on the new value, drop `AGENT_SECRET_OLD` from the backend service.
- Tests: `agentTools.test.ts` pins missing-header / wrong-value / unset-AGENT_SECRET / shorter-provided-secret-no-crash / rotation-accepts-OLD / rotation-rejects-third-value.

**Gaps acknowledged:**

- One global secret per environment. We don't bind it to a specific worker identity. Mitigation: the secret is 32+ chars (Zod `min(32)` in agent config), only present in two Railway services' env, never logged. Forward path: switch to per-worker JWT auth if/when the agent worker count grows beyond one tenant's worth.

## Open follow-ups

These are tracked in `docs/TODO.md`:

- Admin "lock account" UI surface (currently SQL-only via `password_changed_at` update).
- Per-worker agent identity (only matters when we run multiple agent workers concurrently).
