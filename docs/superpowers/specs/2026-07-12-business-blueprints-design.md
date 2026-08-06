# Business Blueprints — clone a working business into a new one

**Status:** design, not started. **Date:** 2026-07-12. **Owner:** Dale.

**The ask:** an auto shop signs up. Instead of an owner (or you) sitting through nine
wizard steps inventing services, durations, shifts, skills, and an opening script from
nothing, they pick *"start from an existing auto shop"* and land on a fully-populated
setup they only need to correct. Voice, persona, and opening line included — live in
minutes, not an afternoon.

---

## 1. What already exists (and the one thing that doesn't)

**You already own both halves of the pipe.** This is the important finding — a clone
feature is mostly wiring, not new machinery.

| Half | What it is | Where |
| --- | --- | --- |
| **Reader** | `GET /setup/graph` returns a tenant's live shape graph — services, resources, employees, mappings, and shifts **already collapsed from date-rows back to a weekly pattern** (`DISTINCT ... EXTRACT(DOW FROM shift_date)`) | `src/routes/setup.ts:43-112` |
| **Writer** | `insertDraftGraph()` materializes that same shape onto a tenant: resources → services → employees → `expandWeeklyToSchedule` → `service_employee` / `service_resource` | `src/services/setupGraph.ts:192-452` |

The reader emits exactly the shape the writer consumes. That is not a coincidence — it's
how the re-runnable wizard works. **A clone is `read(source) → strip identity → write(target)`.**

### Two template systems exist. Only one is alive.

- **`business_templates`** (DB table, PK `business_type`, 30 seeded rows) — **real and
  wired**: two `tenants` INSERT triggers (`apply_business_template_defaults` fills
  `system_prompt` / `voice_id` / `first_message` with `{{business_name}}` substitution;
  `create_default_resources` inserts one resource), plus `GET /vocabulary` and the
  wizard's `example_services` seeding.
- **`src/templates/*.yaml`** (5 files) — **dead code.** There is no YAML parser in the
  repo. Nothing reads them. They describe custom-attribute schemas for tables that have
  no columns to hold them. **Delete them** (`Test it or delete it`). They are the reason
  this question feels harder than it is — they *look* like the templating system and
  aren't.

### The gap, stated precisely

`business_templates` can express: a prompt, a first message, a voice, **one** default
resource, five vocabulary labels, and `example_services text[]` — **names only, no
durations, no prices**.

It cannot express: **skills, shifts, service↔employee mappings, service↔resource
mappings, prices, durations, resource capabilities, or the knowledge base.** Those are
precisely the things that take an afternoon to set up.

That gap *is* the feature.

---

## 2. The core design decision

> **A clone populates the wizard's DRAFT, not the database.**

The obvious implementation — "copy source tenant's rows into target tenant" — is the
wrong one. Clone into the draft graph the Setup Assistant already uses, and:

- You reuse `insertDraftGraph()` verbatim. **No second write path into the entity graph**,
  which means no second place for a booking-stranding bug to live.
- You inherit the review step (step 6), the coverage dry-run, and the removal-impact
  gate that was just hardened in #240/#241.
- The owner **sees and edits everything before it commits**. A cloned service list is a
  starting point, not a fait accompli — they'll want to rename "Synthetic Oil Change"
  and drop the one service they don't offer.
- Zero new destructive surface. The scary code (prune, soft-delete, impact) is already
  written, reviewed, and tested.

So the feature is: **a new source for the draft.** Today the draft comes from
`example_services` (create mode) or `GET /setup/graph` (sync mode). We add a third:
`GET /blueprints/:id/draft`.

---

## 3. Identity vs. shape — the crux

Every column falls in exactly one bucket. Getting this wrong is how you leak one
customer's phone number into another customer's assistant.

### ✅ Shape — clone freely

- `services`: name, subtitle, description, duration_minutes, price, `required_skills[]`,
  `required_resources[]` — **note these are arrays of NAMES, not FKs, so they clone by
  value with no remapping.** A genuine piece of luck.
- `resources`: name, description, `capabilities[]`
- `tenant_skills`: `(tenant_id, name)`, description
- `service_employee`, `service_resource`: the mapping structure (**needs UUID remap**)
- `employee_schedule`: **collapse to weekly, re-expand from the new tenant's start date.**
  Never copy dates.
- `tenants`: `persona_name`, all 8 voice/tone columns (`tts_voice`, `tts_speed`,
  `tts_soft`, `tts_cheerful`, `tts_formal`, `tts_warm`, `tts_concise`, `voice_id`),
  `save_preferences_enabled`, `preferences_instructions`, `default_buffer_minutes`,
  the 5 vocab labels, `sms_enabled`, `email_enabled`, `timezone` (if same market)

### ⚠️ Shape, but name-bearing — must be re-templated

- **`system_prompt`** and **`first_message`** — this is the "opening script ready to go"
  the ask specifically calls for. They almost certainly contain the *source's* business
  name in prose. **On blueprint capture, re-tokenize:** replace every occurrence of the
  source tenant's `name` with `{{business_name}}`. The substitution machinery already
  exists — `apply_business_template_defaults()` does exactly this on tenant INSERT, and
  `buildSystemPrompt` already substitutes `{{business_name}}` / `{{current_date}}` /
  `{{caller_phone}}` at call time.
- **`call_disclosure`** — the text is shape; **`call_disclosure_attested_at` /
  `_attested_by` are NOT.** Legal attestation is per-owner and per-business. Copy the
  text, force a fresh attestation.
- **`default_service_id`** — a UUID reference; must be remapped to the cloned service's
  new id, or nulled.

### ⚠️ Hybrid — the one that needs judgment: `employees`

An employee row is **half shape, half a real human being.**

- Shape: how many of them, what `skills[]` each carries, which services they do, when
  they work.
- Identity: `name`, `first_name`, `last_name`, `email`, `phone`. **Real people. Never clone.**

**Design:** clone N employee *slots* with their skills, schedules, and mappings intact,
but **blank the PII** and name them from the tenant's vocabulary — `Technician 1`,
`Technician 2`, `Stylist 1`. The owner renames them in step 3, which is a 30-second job,
versus rebuilding the skill matrix and the shift grid, which is not.

This preserves the thing that's actually expensive (the *structure*: who can do what,
when) and discards the thing that's cheap to re-enter (names).

### ⚠️ `tenant_docs` (the RAG knowledge base) — high value, highest risk

**Value:** the embeddings copy verbatim. No re-embedding cost, no OpenAI spend, instant
KB. A cloned auto shop immediately answers "do you do alignments?" correctly.

**Risk:** KB content is *prose about a specific business*. It will contain the source's
phone number, address, hours, prices, warranty terms, and staff names. Copying it blind
means the new shop's assistant confidently tells callers the **wrong shop's** prices.

**Design:** KB is **opt-in per blueprint and requires a review pass.** Curated
platform blueprints get a scrubbed, generic KB written once ("we accept most major
insurance", not "we accept Geico and our number is 630-…"). Ad-hoc tenant→tenant clones
default KB **off**, with a checkbox and a warning naming the risk. Never silently.

### ❌ Never clone

`customers`, `appointments`, `customer_preferences`, `customer_messages`, `voice_sessions`,
`call_summaries`, `call_transcripts`, `communications_history`, `reminder_schedules`,
`consent_records`, `opt_out_records`, `job_inquiries`, `ai_cost_events`, `audit_log`,
`record_versions`, `users`, `password_resets`, `phone_verifications`,
`tenant_calendar_settings` (**holds OAuth access/refresh tokens**),
`tenant_integration_settings` (CRM secrets), and every phone/billing column on `tenants`
(`inbound_phone`, `forward_phone`, `forwarded_from_phone`, `owner_phone`,
`telnyx_phone_number_id`, `phone_status`, `stripe_*`, `subscription_*`).

`src/routes/exportData.ts:151-175` (`EXPORT_TABLES`) is the best existing enumeration of
tenant-scoped tables — use it as the checklist, and make the blueprint's table list an
explicit **allowlist**, never a denylist. A new table added next year must not
auto-join the clone.

---

## 3b. The hard-won voice rules are ALREADY platform-level — do not clone them

The behavioral prompt engineering — *"never re-ask a phone number you already have"*, the
phone read-back rule, availability discipline, don't-ask-"which service?"-blind, widen
rather than give up, the booking-tool selection rule — is the single most expensive asset
in this product. It took real iteration against real calls.

**It already lives in the right place: `agent/src/prompt.ts` (455 lines, 17 behavioral
sections).** It is CODE, not tenant data.

`tenants.system_prompt` in prod is ~432 characters — an identity paragraph and nothing
more ("You are a friendly and professional virtual receptionist for `{{business_name}}`…").
`buildSystemPrompt()` composes **tenant identity + platform behavior**: the custom prompt
replaces only the opening identity line (`baseIdentity`), and every behavioral section is
appended below it unconditionally.

**Three consequences, all good:**

1. **A blueprint does not carry the voice rules.** Every new business gets all 17 sections
   for free at creation. There is nothing to copy.
2. **Improvements propagate backwards.** Iron out rule #18 next month and it deploys to
   every tenant at once, including ones onboarded a year ago. Had these rules lived in each
   tenant's `system_prompt` column — the obvious place to put them — every clone would carry
   a frozen snapshot, and you would be re-fixing the same bug in thirty places forever.
3. **An owner cannot delete them.** Editing the persona on the AI Persona page replaces the
   identity line only. The rules survive.

So the blueprint's prompt payload is small and safe: persona name, the 8 voice/tone columns,
and the ~400-char identity paragraph (with the source's business name re-tokenized to
`{{business_name}}`).

**The one hazard this creates:** a tenant custom prompt that *contradicts* a platform rule —
an owner writing "always confirm the caller's phone number" pulls directly against
"never re-ask." Worth a lint/warning on the AI Persona page. The platform rules are
appended last, so they generally win, but the model is being given conflicting instructions
and that shows up as flaky behavior on live calls, which is the worst kind to debug.

**Regression harness:** `./scripts/simulate.sh toolselect` replays the real prompt + real
tool schemas through gpt-4o-mini and grades the chosen tool sequence. That is what keeps
rule #4 from silently breaking when rule #18 lands. Run it after any prompt change.

## 4. Two flavors, one mechanism

**A. Clone from an existing tenant** — "copy Joe's Auto." Ad-hoc, super-admin only (it
reads another tenant's data; a normal owner must never be able to point at a tenant they
don't own). This is the fast path for *you* onboarding a customer who resembles one you
already run.

**B. Curated blueprints** — a platform-owned, named, versioned shape: "Auto Shop v1",
"Hair Salon v1". Built **by capturing a real, working tenant** and then hand-polishing it
(scrub the KB, generalize the prompt, sanity-check the services). Owner-selectable at
signup with no super-admin involvement.

They're the same mechanism. A curated blueprint is just a captured tenant that someone
blessed. Build A, then promote its output into B.

### Storage

New table. Natural key, per the project's composite/natural-key convention:

```sql
CREATE TABLE business_blueprints (
    slug          TEXT PRIMARY KEY,           -- 'auto-shop-v1'
    display_name  TEXT NOT NULL,              -- 'Auto Repair Shop'
    business_type TEXT REFERENCES business_templates(business_type),
    category      TEXT NOT NULL DEFAULT 'Other',
    description   TEXT,                       -- what the owner sees when choosing
    graph         JSONB NOT NULL,             -- the draft graph: services/resources/
                                              -- employees/skills/shifts/mappings
    persona       JSONB NOT NULL,             -- tenants.* shape columns, incl. the
                                              -- {{business_name}}-tokenized prompt
                                              -- + first_message
    includes_kb   BOOLEAN NOT NULL DEFAULT false,
    kb_docs       JSONB,                      -- tenant_docs rows WITH embeddings, or NULL
    source_tenant_id UUID,                    -- provenance; nullable (hand-authored)
    is_published  BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why JSONB and not relational shadow tables:** a blueprint is a *snapshot*, not a live
entity. It has no referential relationship to anything (its "services" aren't rows, they're
a recipe). Normalizing it would mean maintaining a parallel schema that must track the real
one forever. The JSONB *is* the draft-graph shape the wizard already speaks — one contract,
validated by the same Zod schema the commit path uses.

**RLS:** published blueprints are publicly readable (same policy shape as
`business_templates`); writes are super-admin only.

---

## 5. Where it lands in the UI

**Setup Assistant gets a step 0: "How do you want to start?"**

1. **From scratch** — today's behavior.
2. **From a blueprint** — a card grid, grouped by the existing `business_templates.category`
   (Auto & Vehicle, Beauty & Personal Care, Home Services…). Each card shows what's
   included: "12 services · 3 bays · 4 staff roles · full week of shifts · opening script".
3. **From an existing business** (super-admin only) — a tenant picker.

Pick one → the draft hydrates → **the owner walks the same nine steps they already walk**,
correcting rather than composing. Commit is unchanged.

The win is that step 1 stops being a blank page. Every subsequent step is a review.

---

## 6. Gotchas found in the code (each one will bite)

1. **`create_default_resources()` AFTER-INSERT trigger** (`baseline.sql:1043`) gives every
   brand-new tenant one resource *before* you clone anything in. Blueprint application must
   dedupe or clear `is_auto_seeded = true` rows first — the wizard already has this concept
   (`POST /tenants/:id/finalize-setup` flips the flag).
2. **The wizard never writes skills.** `insertDraftGraph` hardcodes
   `required_skills = '{}'`, `required_resources = '{}'`, `employees.skills = '{}'`
   (`setupGraph.ts:254, 294`), and never touches `tenant_skills` at all. The **only** code
   that writes a complete skilled graph is `src/services/demoSeed.ts`. **A blueprint must
   extend `insertDraftGraph` to carry skills**, or the cloned shop's booking RPC will happily
   assign the wrong tech to a transmission job. This is the single biggest code change in
   the feature.
3. **`useWizardCrud.ts:87-95` drops `price` and `subtitle`** from the draft even though both
   the backend schema and `GET /setup/graph` carry them. A clone that preserves prices needs
   this fixed — and prices are half the value of cloning.
4. **`demoSeed.ts` is the real prior art.** It's the only function that materializes a
   complete, skilled, mapped, scheduled tenant. Read it before writing the applier; the
   blueprint applier is `demoSeed` with the hardcoded data replaced by a blueprint row.
5. **`POST /demo/start` seeds `business_type = 'automotive'`**, which is **not** a real
   `business_templates.business_type` (those are kebab-case: `auto-shop`). So the demo tenant's
   triggers silently do nothing. Pre-existing bug; fix it while you're in here.

---

## 7. Phasing

**P0 — Skills through the graph.** Extend the draft schema + `insertDraftGraph` to carry
`tenant_skills`, `services.required_skills/required_resources`, `employees.skills`, and
`resources.capabilities`. Fix the `price`/`subtitle` drop. **This is a prerequisite for
everything else and is independently valuable** — the wizard currently produces shops whose
booking RPC can't do skill matching.

**P1 — Clone from tenant (super-admin).** `GET /tenants/:id/blueprint` (capture:
read graph + persona, tokenize the prompt, blank employee PII) → wizard step 0 → existing
commit path. No new table yet; capture straight into the draft. **This alone delivers the
ask.**

**P2 — `business_blueprints` table + capture/publish.** "Save this business as a blueprint"
from any tenant. Seed 3–5 curated ones (auto shop, salon, mobile tire) captured from real
working tenants and hand-polished. Owner-selectable at signup, no super-admin.

**P3 — KB cloning.** Opt-in, with a scrub/review pass. Embeddings copy verbatim (free).
Curated blueprints ship a generic scrubbed KB.

**P4 — Delete `src/templates/*.yaml`.** Dead code that actively misleads.

---

## 8. The thing I'd argue about

**Prices.** Cloning a competitor-shaped price list into a new shop is either the most
valuable thing here or a liability, depending on your read. A new owner who accepts the
cloned prices unexamined is quoting *someone else's* rates to their callers.

My recommendation: **clone prices, but make step 1 of the reviewed wizard show them
prominently with a "review your pricing" nudge.** A wrong-but-present number gets fixed;
a blank field gets skipped and then the assistant tells callers "I don't have pricing
information," which is worse. But it's your call, and it's the one decision here I'd want
you to make deliberately rather than inherit from a default.
