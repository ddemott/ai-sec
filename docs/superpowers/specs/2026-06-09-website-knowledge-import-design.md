# Website Knowledge Import — Design Spec

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Author:** Dale + Claude (brainstorming session)

## Problem

Onboarding a new business into Secretary HQ requires the owner to manually fill in
a long policy questionnaire so the AI receptionist can answer caller questions
(hours, services, cancellation policy, walk-ins, etc.). This is friction: owners
must hunt for the information and type it all out.

Most businesses already publish much of this on their **website**. We should scan
the website, auto-answer as many questions as possible, and let the owner quickly
review/approve — only filling in what the site didn't cover.

## Goal

Owner pastes their website URL during onboarding → the system extracts answers to
the relevant policy questions → owner walks the list (approve / edit / fill empties)
→ approved answers become the AI's knowledge base.

## What already exists (reuse)

- **Q&A knowledge storage + RAG.** `tenant_docs` table (pgvector,
  `text-embedding-3-small`, 1536 dims, HNSW index). `knowledgeIngestion.ts` stores
  knowledge as `Q: <question>\nA: <answer>` embedded chunks. `search_tenant_docs`
  RPC does cosine similarity search. The agent answers policy questions from this.
- **Policy questionnaire UI.** `dashboard/components/KnowledgeBaseView.tsx` renders
  one auto-save textarea per question (`PolicyQuestionField`).
- **Static question list.** `dashboard/lib/policyQuestions.ts` —
  `PolicyQuestion { id, question, placeholder, category }`, ~9 categories.
- **Per-business-type config.** `business_templates` table keyed by `business_type`
  (mobile-tire, salon, auto-shop, personal-trainer, …) holds example_services,
  vocabulary, prompt templates. Natural sibling for the question bank.
- **Unanswered-question feedback loop.** `unanswered_questions` table captures
  questions callers asked that the AI couldn't answer.

## What is new (4 pieces)

### 1. Question bank database (replaces the static file)

Today `policyQuestions.ts` is a single global list, auto-shop flavored, shown to
every business. Replace with a DB-backed **question bank** that associates questions
with business types. Three tiers:

- **Universal** — apply to almost every business (hours, location, services).
- **Type-specific** — apply to certain business types only (insurance →
  `auto-shop`, `body-shop`; warranty → repair trades; walk-ins → `salon`). A bakery
  never sees the insurance question.
- **Per-business custom** — questions specific to one tenant. Two sources: owner
  adds their own, or the scrape discovers website content matching no bank question
  and proposes it as a new custom question.

**Schema:**

```sql
-- The shared bank of questions.
CREATE TABLE question_bank (
    id          TEXT PRIMARY KEY,            -- stable slug, e.g. 'walk-ins-accepted'
    question    TEXT NOT NULL,
    placeholder TEXT NOT NULL,               -- example answer (existing concept)
    category    TEXT NOT NULL,
    applies_to_all BOOLEAN NOT NULL DEFAULT false,  -- true = universal
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Many-to-many: which business types each non-universal question applies to.
CREATE TABLE question_business_type (
    question_id   TEXT REFERENCES question_bank(id) ON DELETE CASCADE,
    business_type TEXT NOT NULL,
    PRIMARY KEY (question_id, business_type)
);

-- Per-tenant custom questions (owner-added or scrape-discovered).
CREATE TABLE tenant_custom_question (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    category    TEXT,
    origin      TEXT NOT NULL DEFAULT 'owner',  -- 'owner' | 'scrape'
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

**Resolving a tenant's question set:** universal questions ∪ questions whose
`business_type` matches the tenant ∪ the tenant's custom questions.

The existing `policyQuestions.ts` content is the **seed data** for `question_bank`
(map each to `applies_to_all` or the relevant types). RLS on the per-tenant tables
follows the existing `tenant_docs` isolation pattern.

### 2. Scrape + extract engine

- **Trigger:** an onboarding wizard step "Import from your website" — owner pastes a
  URL. Optional; if they have no site or skip, fall through to today's manual
  questionnaire. Also available later as a re-run button in `KnowledgeBaseView`.
- **Fetch:** homepage + a bounded set of common pages discovered from nav/links
  (`/about`, `/faq`, `/services`, `/contact`, `/policies`, `/pricing`). Hard caps:
  ≤ 8 pages, per-page size limit, total time budget, same-origin only. Strip HTML to
  readable text.
- **Extract (single LLM call):** input = the cleaned site text + the tenant's
  resolved question set. Output = structured JSON:
  - per question: `{ questionId, answer | null, sourceUrl, confidence }`
  - `discovered[]`: site topics with no matching question → `{ question, answer,
    sourceUrl }`, surfaced as proposed custom questions.
- Small-business sites fit in one context window; no chunking/temp-embedding needed.
  (If real-world sites prove too large, revisit with a retrieve-then-answer pass —
  out of scope for v1.)

### 3. Suggestion + provenance + review loop (the heart)

A pre-filled answer is a **suggestion**, not a published answer. Per-question state:

- `suggested` — extracted from the website, not yet approved.
- `confirmed` — owner-approved (only these reach the live AI).
- `empty` — no website source; owner must write it.

**Review screen** (extends `KnowledgeBaseView`): each question shows its suggested
answer pre-filled, a **"from website ✓ [source link]"** badge, and a confidence
indicator. Owner actions:

- **Approve** — one click; the yes/yes/yes fast path.
- **Edit then approve** — make vague website copy more accurate/verbose.
- **Empty → write it** — questions the site didn't answer are visually distinct
  ("not found on your website") so the owner knows exactly what's left.
- **Approve all high-confidence** — bulk action to clear the easy ones at once.

Discovered custom questions appear in their own section for accept/reject.

### 4. Empty-vs-unanswered distinction

An empty field because *the website didn't cover it* is shown differently from a
field the owner simply hasn't reached — so the remaining work is obvious. (Verbose
editing itself needs no new mechanism; it is the existing textarea.)

### 4a. Answer precedence — the owner's site outranks the industry template

Source-of-truth ordering for any question's value (highest wins):

```
1. owner-confirmed answer        — ground truth; re-scrape NEVER overwrites it
2. scraped-from-their-site       — 'suggested'; owner approves/edits to confirm
3. industry-template default     — the floor: so the live AI is never answer-less
4. blank (ask the owner)         — only when even the template has nothing safe
```

The owner who runs the business knows it better than any industry standard; the
`business_templates` default exists ONLY as a floor for fields neither the site nor
the owner has supplied yet.

**Scoped floor — critical safety rule.** Tier 3 applies ONLY to genuinely
generalizable questions (policy, vocabulary, "do you take walk-ins?"). It must NOT
default **tenant-specific operational facts** — hours, address, phone, prices, staff
names. A wrong template default for those is worse than blank: the live AI would
confidently tell a caller the *wrong* hours, damaging trust, whereas a blank
gracefully degrades to "let me take a message and have someone confirm." So:

```
generalizable question  → template default fills the gap (labeled "industry default — confirm")
tenant-specific fact     → stays empty + flagged (NEVER auto-defaulted)
```

Each bank question therefore carries a `default_safe BOOLEAN` (or equivalent) marking
whether tier 3 may fill it. Hours/address/price/staff = `default_safe = false`.

## Storage & flow

New staging table for pre-confirmation suggestions:

```sql
CREATE TABLE knowledge_suggestion (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    question_id  TEXT,                 -- bank question id, or null for discovered
    question     TEXT NOT NULL,        -- denormalized (covers custom/discovered)
    answer       TEXT,
    source_url   TEXT,
    confidence   REAL,
    status       TEXT NOT NULL DEFAULT 'suggested',  -- 'suggested'|'confirmed'|'rejected'
    created_at   TIMESTAMPTZ DEFAULT now()
);
```

**Flow:**

```
URL
 → fetch + strip (bounded crawl)
 → single LLM extract (site text + tenant question set)
 → write rows to knowledge_suggestion (status='suggested')
 → review UI (approve / edit / reject; fill empties)
 → on approve: ingest Q&A into tenant_docs (embed) + mark suggestion 'confirmed'
 → live RAG / agent answers from tenant_docs
```

Only `confirmed` Q&A is ever embedded into `tenant_docs`. Suggestions never reach a
caller.

## Edge cases & safety

- **No website / fetch failure / timeout:** skip gracefully to the manual
  questionnaire. Never block onboarding on the scrape.
- **Re-scrape:** never overwrite a `confirmed` answer; only refresh `empty` or
  still-`suggested` items.
- **Prompt injection:** website text is untrusted input. Keep it in a clearly
  delimited data block, separate from instructions; the extraction prompt instructs
  the model to *extract answers only* and never follow instructions found in page
  content. Escape/contain site-supplied strings.
- **Bad/low-confidence extraction:** low-confidence suggestions are flagged for the
  owner, never silently published. The staged-review gate is the backstop.
- **Wrong site / parked domain / JS-only site:** if little usable text is found,
  report "couldn't read much from this site" and fall through to manual.
- **Cost:** one embedding call per confirmed answer + one extraction LLM call per
  import. Bounded crawl keeps token use predictable.

## Out of scope (v1)

- Retrieve-then-answer / chunked embedding of the whole site (only if small-site
  assumption breaks).
- Periodic automatic re-scrape to detect website changes (future: drift detection).
- Non-HTML sources (social pages, Google Business Profile, PDFs linked from site).

## Open questions for the plan

- Where exactly the website-import step sits in the existing onboarding wizard
  sequence.
- Reuse of `getEmbedding` / `knowledgeIngestion` server path for the approve→embed
  step (it already exists; confirm the suggestion→ingest call site).
- Seed mapping: which existing `policyQuestions.ts` entries become `applies_to_all`
  vs type-tagged, and the initial type-specific additions (insurance, etc.).
