# Design — Separate "forwarded-from" and "transfer-to-a-person" numbers (+ loop guard)

**Date:** 2026-06-29
**Status:** Approved (design), spec for implementation
**Origin:** Dale, 2026-06-29 — a tenant who forwards their published line into the AI cannot also use that same number as the live-transfer target ("talk to a person"), or the transfer loops back into the AI. The two roles are currently crammed into one column (`forward_phone`).

---

## Problem

A tenant on the **forwarded-line model** publishes a number (e.g. `+1 608 217 5303`) that their carrier forwards to the AI's Telnyx DID. Two distinct behaviors depend on a phone number:

1. **Inbound detection** — when the SIP caller-ID equals the tenant's *forwarded-from* line, the call was forwarded (the caller-ID is the forwarding line, **not** the real customer). The agent must null `callerPhone` and collect the customer's name + number by voice, then write CRM / take a message / book.
2. **Live transfer** — when a caller asks for a person, `transfer_call` issues a SIP REFER to a **human** number.

Today both read `tenants.forward_phone`:

- `agent/src/index.ts:460` — `callerIdIsForwardNumber(sessionCtx.callerPhone, tenantConfig.forwardPhone)` uses `forward_phone` for the **inbound match**.
- `agent/src/transferClient.ts` + `transfer_call` — uses `forward_phone` as the **transfer target**.

So to make inbound detection work, `forward_phone` must equal the forwarded-from line — but then a transfer sends the live call **back to the forwarding line**, which forwards it straight back into the AI: an infinite loop. The two roles are mutually exclusive in one field.

---

## Goal

Split the two roles into two explicitly-named settings, plus a save-time loop guard, so any tenant can simultaneously (a) be detected as a forwarded line and (b) transfer to a different human — and can never save a config that loops.

**Non-goals:** changing the forwarded-line *behavior* itself (null caller phone + collect by voice already works), warm transfer, multi-destination transfer, IVR menus. Out of scope.

---

## Data model

Add one nullable column:

```sql
ALTER TABLE tenants ADD COLUMN forwarded_from_phone TEXT;
```

- Nullable, E.164 (same convention as `forward_phone` / `inbound_phone`). Default NULL.
- Migration file: `supabase/migrations/20260629000000_tenant_forwarded_from_phone.sql` (next number after the latest `20260625` migrations). Regenerate `baseline.sql` via `npm run db:baseline` after.

**Role table after this change** (no other column changes):

| Column | Role |
| --- | --- |
| `forwarded_from_phone` | **(new)** caller-ID matches this → call was forwarded from the tenant's own line → null caller phone, collect by voice |
| `forward_phone` | "talk to a person" → SIP REFER live-transfer target |
| `inbound_phone` | the AI's own Telnyx DID (SMS "from", etc.) |
| `owner_phone` | owner's personal/contact number (display); unchanged, not used for routing |

---

## Components & changes

### 1. Migration (`supabase/migrations/`)

New file adding the nullable column. Forward-compatible: existing rows get NULL; nothing breaks pre-deploy.

### 2. Backend — config read/write (`src/routes/tenants.ts`)

- **`UpdateConfigSchema`** (line 42): add `forwarded_from_phone: z.string().max(30).optional().nullable()`.
- **GET `/tenants/:id/config`** (line 163 SELECT): add `forwarded_from_phone` to the column list so the dashboard loads it.
- **POST `/tenants/:id/config`** (handler line 173):
  - The `FOR UPDATE` prior-fetch (line 222) must also select `forwarded_from_phone` **and `inbound_phone`** (needed for the loop guard).
  - **Loop guard** (new): compute the effective post-update values of `forward_phone`, `forwarded_from_phone`, `inbound_phone` (body value if provided, else prior). If `forward_phone` is non-empty and its **10-digit normalized** form equals that of `forwarded_from_phone` **or** `inbound_phone`, reject with `400` and a clear message (e.g. *"The transfer number can't be the same as the forwarded-from number or the AI's own number — it would loop the call back to the assistant."*). Use the existing phone normalization (`shared/phone.ts` `normalizePhone` / 10-digit compare, matching `tenDigits` used in the agent).
  - The `UPDATE` (line 266): add `forwarded_from_phone = $N` to the SET list and params.

### 3. Backend — agent config fetch (`src/routes/agentTools.ts`)

- The tenant-config SELECT (line 484) that builds the agent's `tenantConfig`: add `forwarded_from_phone`.
- The response object (around line 523): add `forwarded_from_phone: row.forwarded_from_phone ?? null` (camel-cased on the agent side as `forwardedFromPhone`).

### 4. Agent (`agent/src/`)

- **Tenant config type** (wherever `forwardPhone` is typed in the agent's config shape): add `forwardedFromPhone: string | null`.
- **`agent/src/index.ts:460`** — repoint the inbound match:
  ```js
  // was: callerIdIsForwardNumber(sessionCtx.callerPhone, tenantConfig.forwardPhone)
  callerIdIsForwardNumber(sessionCtx.callerPhone, tenantConfig.forwardedFromPhone)
  ```
- `matchesForwardedLine()` / `callerIdIsForwardNumber()` in `sessionContext.ts` already take a generic number argument — **no logic change**, only the field fed to them.
- **Back-compat:** keep the `UNTRUSTED_CALLER_ID_TENANTS` env check OR'd in. Detection fires if **either** the per-tenant `forwarded_from_phone` matches the caller-ID **or** the tenant is in the env list. Tenants with neither set behave exactly as today (no regression). `transfer_call` continues to read `forward_phone` unchanged.

### 5. Dashboard (`dashboard/components/AIConfigView.tsx`)

- Add a **"Forwarded-from number"** input near the existing "Forward Calls to a Person" section, with a one-line helper: *"If you forward your business line into the assistant, put that line here so the assistant knows to collect the caller's real number."*
- Bind to `config.forwarded_from_phone`; normalize on save (`normalizePhone`, mirroring the existing `forward_phone` handling at line 99).
- Include `forwarded_from_phone` in the `Api.tenants.updateConfig(...)` payload (line 83).
- **Client-side loop guard** mirroring the backend: if `forward_phone` and `forwarded_from_phone` (or `forward_phone` and the loaded `inbound_phone`) normalize equal, show an inline error and disable Save. The backend remains the source of truth (defense in depth) — the client check is just for fast feedback.
- Update `AIConfig` / config type in `dashboard/lib/types.ts` to include `forwarded_from_phone?: string | null`.

---

## Data flow (after change)

```
Inbound call (forwarded):
  carrier forwards tenant's published line  -> Telnyx DID (inbound_phone) -> LiveKit -> agent
  agent: caller-ID == forwarded_from_phone?  -> YES -> null callerPhone, collect name/number by voice -> CRM/message/book

Caller asks for a person:
  agent transfer_call -> SIP REFER to forward_phone (a DIFFERENT human line)
  forward_phone is guaranteed != forwarded_from_phone and != inbound_phone (save-time loop guard)
```

For a **solo tenant with one line** (Dale): set `forwarded_from_phone`, leave `forward_phone` blank → "talk to a person" gracefully falls back to take-a-message (existing behavior when `forward_phone` is null). No transfer, no loop.

---

## Error handling

- **Save with loop:** `400` + explanatory message; UPDATE not executed (guard runs before the write, inside the same `FOR UPDATE` transaction).
- **Agent, `forwarded_from_phone` NULL:** match falls back to the env list; if neither, no forwarded-line handling (caller-ID trusted as today).
- **Transfer when `forward_phone` NULL:** unchanged — take-a-message fallback.
- Normalization defends against format mismatch (`+1 608-217-5303` vs `6082175303`) on both the guard and the agent match (10-digit compare).

---

## Testing

- **Backend (`src/routes/tenants.test.ts` or equiv):**
  - happy: save with distinct `forwarded_from_phone` + `forward_phone` → 200, both persisted.
  - loop A: `forward_phone` == `forwarded_from_phone` (various formats) → 400, no write.
  - loop B: `forward_phone` == `inbound_phone` → 400, no write.
  - guard uses effective values (body-vs-prior): setting only `forward_phone` to collide with an existing stored `forwarded_from_phone` → 400.
- **Agent (`agent/src/sessionContext.test.ts` / `index` wiring):**
  - caller-ID == `forwarded_from_phone` → forwarded-line path (callerPhone nulled); caller-ID == old `forward_phone` (now a different number) → NOT treated as forwarded.
  - env-list back-compat still fires when `forwarded_from_phone` is null.
- **Dashboard (`AIConfigView.test.tsx`):** field renders + binds; colliding values show inline error + disable Save; clean values allow save with `forwarded_from_phone` in payload.
- **E2E (optional, stub-gated):** owner sets forwarded-from + a distinct transfer number → save OK; colliding save → blocked.

---

## Migration & deploy safety

- New column is nullable → **deploy is forward-compatible**; safe to merge before or after applying the migration (agent/back-end read `?? null`).
- Per project rule (merge-before-migrate): apply the migration to prod **before** the code relies on the column being populated. Reads degrade to NULL gracefully if it isn't yet.
- Regenerate `supabase/baseline.sql` (`npm run db:baseline`) so the schema-alignment guard passes.

---

## Rollout for Dale's tenant (Thinking Hammer)

1. Apply migration to prod.
2. On AI Persona page: set **Forwarded-from number** = `+1 608 217 5303`; leave **Forward to a person** blank.
3. Result: forwarded calls are detected (collect caller's real number by voice); "talk to a person" takes a message. No REFER toggle needed until a real second human line exists.
