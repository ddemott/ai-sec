# Website Knowledge Import — Plan 3: Suggestion Review UI + Approve→Embed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner paste their website during onboarding, run the import (Plan 2), and review the results inside the question list — approving, editing, or filling empties — where only **confirmed** answers get embedded into live RAG (`tenant_docs`).

**Architecture:** Three new backend endpoints (`GET /knowledge/suggestions`, `POST /knowledge/suggestions/:id/approve`, `POST /knowledge/suggestions/:id/reject`). Approve reuses Plan 1/existing `prepareQADocument` → insert into `tenant_docs` (exactly the `/knowledge/add` path), then marks the suggestion `confirmed`. The dashboard gets a new wizard step `StepWebsiteImport` (positioned **before** the existing caller-questions step per Dale's flow: "ask if they have a website → scan → return them to the question list pre-filled → they fill the rest") and a suggestion-aware question list (badge + confidence + empty-vs-found distinction). Discovered topics surface as a custom-questions section.

**Tech Stack:** Fastify + `pg`/`withTenantClient`, existing `prepareQADocument`/`getEmbedding`/`normalizeForEmbedding`, React dashboard (Next.js), Vitest + @testing-library/react.

**Prerequisites:** Plan 1 (question bank + `resolveQuestionSet` + `GET /knowledge/questions`) and Plan 2 (`knowledge_suggestion` table + `POST /knowledge/import-website`) merged.

---

## File Structure

- Modify: `src/routes/knowledge.ts` — add list/approve/reject suggestion endpoints.
- Create: `src/services/suggestionApprove.ts` — pure helper that maps a suggestion row to the `prepareQADocument` inputs (testable without DB).
- Create: `src/services/suggestionApprove.test.ts`.
- Modify: `dashboard/lib/api.ts` — `Api.knowledge.suggestions / approveSuggestion / rejectSuggestion`.
- Create: `dashboard/components/SetupWizard/StepWebsiteImport.tsx` — the URL-paste + run-import step.
- Create: `dashboard/components/SetupWizard/StepWebsiteImport.test.tsx`.
- Modify: `dashboard/components/SetupWizard/types.ts` — extend `WizardStep` to include `9`.
- Modify: `dashboard/components/SetupWizard/WizardStepContent.tsx` — renumber trailing steps, render new step.
- Modify: `dashboard/components/SetupWizard/index.tsx` — labels, nav bounds, chip strip.
- Modify: `dashboard/components/SetupWizard/SoloWizard.tsx` — same insert for the solo flow.
- Modify: `dashboard/components/KnowledgeBaseView.tsx` — show suggestions on the questionnaire (badge/confidence/empty-vs-found) + a re-run import button + discovered section.

---

## Task 1: GET /knowledge/suggestions endpoint

**Files:**
- Modify: `src/routes/knowledge.ts`

- [ ] **Step 1: Add the list handler**

Inside `registerKnowledgeRoutes`, after the import-website handler (Plan 2):

```ts
app.get(
  '/knowledge/suggestions',
  withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT id, question_id, question, answer, source_url, confidence, status, created_at
           FROM knowledge_suggestion
          WHERE tenant_id = $1 AND status = 'suggested'
          ORDER BY confidence DESC NULLS LAST, created_at`,
        [tenantId]
      );
    });
    return reply.send({ success: true, suggestions: res.rows });
  }, 'Failed to fetch suggestions')
);
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/routes/knowledge.ts
git commit -m "feat(knowledge): GET /knowledge/suggestions lists pending suggestions"
```

---

## Task 2: Approve helper (pure) + approve/reject endpoints

**Files:**
- Create: `src/services/suggestionApprove.ts`
- Test: `src/services/suggestionApprove.test.ts`
- Modify: `src/routes/knowledge.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
// src/services/suggestionApprove.test.ts
import { describe, it, expect } from 'vitest';
import { toQAInputs } from './suggestionApprove';

describe('toQAInputs', () => {
  it('HAPPY: maps a suggestion row to question/answer/category/source for embedding', () => {
    const row = {
      id: 'u1',
      question_id: 'hours-of-operation',
      question: 'What are your hours?',
      answer: 'Open 9-5 Mon-Fri',
      source_url: 'https://a.com/',
      confidence: 0.9,
    };
    const out = toQAInputs(row, 'Open 9-5 Mon-Fri'); // edited answer may override
    expect(out.question).toBe('What are your hours?');
    expect(out.answer).toBe('Open 9-5 Mon-Fri');
    // MUST be 'policy-questionnaire' so the approved answer shows up in
    // KnowledgeBaseView.fetchDocs (which maps only that source into savedAnswers).
    expect(out.source).toBe('policy-questionnaire');
    expect(out.category).toBeNull(); // no category on bank-id rows here; UI may add
  });

  it('SAD: rejects empty answers (nothing should embed with no content)', () => {
    // WHO: owner clicks approve on a not-found question by mistake.
    // WHAT: toQAInputs throws so the route returns 400 rather than embedding "".
    // WHERE: toQAInputs guard. WHY: empty Q&A pollutes RAG with a useless vector.
    const row = {
      id: 'u2', question_id: null, question: 'Q?', answer: null, source_url: null, confidence: 0,
    };
    expect(() => toQAInputs(row, '')).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/services/suggestionApprove.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

```ts
// src/services/suggestionApprove.ts
export interface SuggestionRow {
  id: string;
  question_id: string | null;
  question: string;
  answer: string | null;
  source_url: string | null;
  confidence: number | null;
}

export interface QAInputs {
  question: string;
  answer: string;
  category: string | null;
  source: string;
}

/**
 * Map a suggestion (optionally with an owner-edited answer) to the inputs the
 * existing prepareQADocument/tenant_docs insert expects. Throws on an empty
 * answer so we never embed a contentless vector.
 */
export function toQAInputs(row: SuggestionRow, editedAnswer?: string): QAInputs {
  const answer = (editedAnswer ?? row.answer ?? '').trim();
  if (!answer) throw new Error('Cannot approve a suggestion with an empty answer');
  return {
    question: row.question,
    answer,
    category: null,
    // Use the same source the manual questionnaire writes so the approved answer
    // is picked up by KnowledgeBaseView.fetchDocs (it maps only
    // source === 'policy-questionnaire' into savedAnswers) and so later edits go
    // through the existing /knowledge/:id update path cleanly. tenant_docs has no
    // source_url column, so website provenance is not retained at embed time anyway.
    source: 'policy-questionnaire',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/services/suggestionApprove.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the approve + reject routes**

In `src/routes/knowledge.ts` add the import and the two handlers:

```ts
import { toQAInputs } from '../services/suggestionApprove';

const approveBodySchema = z.object({
  tenant_id: z.string().uuid(),
  answer: z.string().optional(), // owner-edited answer; falls back to the stored one
});

app.post(
  '/knowledge/suggestions/:id/approve',
  withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const { id } = req.params as { id: string };
    const parsed = approveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed' });
    }

    const result = await withTenantClient(tenantId, async (client) => {
      const found = await client.query(
        `SELECT id, question_id, question, answer, source_url, confidence
           FROM knowledge_suggestion
          WHERE id = $1 AND tenant_id = $2 AND status = 'suggested'`,
        [id, tenantId]
      );
      if (found.rowCount === 0) return { notFound: true as const };

      let qa;
      try {
        qa = toQAInputs(found.rows[0], parsed.data.answer);
      } catch {
        return { emptyAnswer: true as const };
      }

      // Embed into live RAG via the SAME path /knowledge/add uses.
      const { combined, normalizedText, embedding } = await prepareQADocument(
        qa.question, qa.answer, getEmbedding, normalizeForEmbedding
      );
      const ins = await client.query(
        `INSERT INTO tenant_docs (tenant_id, title, section, content, source, normalized_text, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING tenant_doc_id`,
        [tenantId, qa.question, qa.category, combined, qa.source, normalizedText, JSON.stringify(embedding)]
      );

      await client.query(
        `UPDATE knowledge_suggestion SET status = 'confirmed' WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      return { tenant_doc_id: ins.rows[0].tenant_doc_id as string };
    });

    if ('notFound' in result) return reply.status(404).send({ success: false, error: 'Suggestion not found' });
    if ('emptyAnswer' in result) return reply.status(400).send({ success: false, error: 'Answer is empty' });

    logEvent(req, 'suggestion_approved', { suggestionId: id, tenant_doc_id: result.tenant_doc_id });
    return reply.send({ success: true, tenant_doc_id: result.tenant_doc_id });
  }, 'Failed to approve suggestion')
);

app.post(
  '/knowledge/suggestions/:id/reject',
  withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const { id } = req.params as { id: string };

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `UPDATE knowledge_suggestion SET status = 'rejected'
          WHERE id = $1 AND tenant_id = $2 AND status = 'suggested' RETURNING id`,
        [id, tenantId]
      );
    });
    if (!assertRowAffected(res, reply, 'Suggestion')) return;

    logEvent(req, 'suggestion_rejected', { suggestionId: id });
    return reply.send({ success: true });
  }, 'Failed to reject suggestion')
);
```

> `prepareQADocument`, `getEmbedding`, and `normalizeForEmbedding` are already in
> scope inside `registerKnowledgeRoutes` (used by `/knowledge/add`). Reuse them; do
> not re-import or reconstruct.

- [ ] **Step 6: Typecheck + run helper test**

Run: `npm run build && npm test -- src/services/suggestionApprove.test.ts`
Expected: build exits 0; test PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/knowledge.ts src/services/suggestionApprove.ts src/services/suggestionApprove.test.ts
git commit -m "feat(knowledge): approve embeds to tenant_docs + reject endpoints"
```

---

## Task 3: Dashboard API client methods

**Files:**
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add suggestion methods to the `knowledge:` block**

```ts
suggestions: (tenantId: string | null) =>
  apiFetch<{
    success: boolean;
    suggestions: Array<{
      id: string;
      question_id: string | null;
      question: string;
      answer: string | null;
      source_url: string | null;
      confidence: number | null;
      status: string;
      created_at: string;
    }>;
  }>(`/knowledge/suggestions`, tenantId ? { tenant_id: tenantId } : undefined),

approveSuggestion: (id: string, tenantId: string | null, answer?: string) =>
  apiMutate<{ success: boolean; tenant_doc_id?: string }>(
    `/knowledge/suggestions/${id}/approve`,
    'POST',
    { tenant_id: tenantId, ...(answer !== undefined ? { answer } : {}) }
  ),

rejectSuggestion: (id: string, tenantId: string | null) =>
  apiMutate<{ success: boolean }>(`/knowledge/suggestions/${id}/reject`, 'POST', {
    tenant_id: tenantId,
  }),
```

- [ ] **Step 2: Typecheck the dashboard**

Run: `cd dashboard && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat(dashboard): suggestion list/approve/reject API methods"
```

---

## Task 4: StepWebsiteImport component (the URL-paste step)

**Files:**
- Create: `dashboard/components/SetupWizard/StepWebsiteImport.tsx`
- Test: `dashboard/components/SetupWizard/StepWebsiteImport.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
// dashboard/components/SetupWizard/StepWebsiteImport.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StepWebsiteImport } from './StepWebsiteImport';
import { Api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  Api: { knowledge: { importWebsite: vi.fn() } },
}));

describe('StepWebsiteImport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('HAPPY: runs the import and shows the result count', async () => {
    (Api.knowledge.importWebsite as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true, suggestionCount: 5, discoveredCount: 2,
    });
    render(<StepWebsiteImport tenantId="t1" />);
    fireEvent.change(screen.getByPlaceholderText(/yourbusiness\.com/i), {
      target: { value: 'https://a.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /scan my website/i }));
    await waitFor(() =>
      expect(screen.getByText(/filled in 5/i)).toBeInTheDocument()
    );
    expect(Api.knowledge.importWebsite).toHaveBeenCalledWith('t1', 'https://a.com');
  });

  it('SAD: a not_enough_content result tells the owner to fill manually', async () => {
    // WHO: owner with a parked/JS-only site. WHAT: friendly fall-through message.
    // WHERE: StepWebsiteImport result branch. WHY: never dead-end onboarding.
    (Api.knowledge.importWebsite as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false, reason: 'not_enough_content',
    });
    render(<StepWebsiteImport tenantId="t1" />);
    fireEvent.change(screen.getByPlaceholderText(/yourbusiness\.com/i), {
      target: { value: 'https://parked.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /scan my website/i }));
    await waitFor(() =>
      expect(screen.getByText(/couldn’t read much|couldn't read much/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run StepWebsiteImport`
Expected: FAIL — module `./StepWebsiteImport` not found.

- [ ] **Step 3: Write the component**

```tsx
// dashboard/components/SetupWizard/StepWebsiteImport.tsx
'use client';

import React, { useState } from 'react';
import { Globe, Loader2, Check } from 'lucide-react';
import { Api } from '../../lib/api';

interface Props {
  tenantId: string | null;
}

type Phase = 'idle' | 'running' | 'done' | 'skipped';

export function StepWebsiteImport({ tenantId }: Props) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [filled, setFilled] = useState(0);
  const [skipReason, setSkipReason] = useState<string | null>(null);

  async function runImport() {
    if (!url.trim() || !tenantId || phase === 'running') return;
    setPhase('running');
    setSkipReason(null);
    try {
      const res = await Api.knowledge.importWebsite(tenantId, url.trim());
      if (res.success) {
        setFilled(res.suggestionCount ?? 0);
        setPhase('done');
      } else {
        setSkipReason(res.reason ?? 'unknown');
        setPhase('skipped');
      }
    } catch {
      setSkipReason('error');
      setPhase('skipped');
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Do you have a website?
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Paste your website and we’ll read it to answer as many caller questions as we can.
          You’ll review everything on the next step. No website? Just skip — you can fill the
          questions in yourself.
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourbusiness.com"
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 dark:bg-gray-800 dark:border-gray-700"
          />
        </div>
        <button
          onClick={runImport}
          disabled={!url.trim() || phase === 'running'}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {phase === 'running' ? (
            <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</span>
          ) : (
            'Scan my website'
          )}
        </button>
      </div>

      {phase === 'done' && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          <Check className="w-4 h-4" />
          We filled in {filled} answer{filled === 1 ? '' : 's'} from your website. Review them on the
          next step — approve, edit, or fill in the rest.
        </div>
      )}

      {phase === 'skipped' && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {skipReason === 'not_enough_content'
            ? 'We couldn’t read much from this site. No problem — you can answer the questions yourself on the next step.'
            : skipReason === 'bad_url'
              ? 'That doesn’t look like a valid website address. Double-check it, or skip and fill the questions in yourself.'
              : 'We couldn’t scan the site right now. You can answer the questions yourself on the next step.'}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run StepWebsiteImport`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard/components/SetupWizard/StepWebsiteImport.tsx dashboard/components/SetupWizard/StepWebsiteImport.test.tsx
git commit -m "feat(dashboard): website-import wizard step component"
```

---

## Task 5: Insert the new step into the TEAM wizard (before caller-questions)

The team wizard currently runs steps 1–8, where step 7 = `Step7CallerQuestions` ("Teach Your AI") and step 8 = `Step7GoLive` ("You're live"). Insert the website-import as the **new step 7**, pushing caller-questions → 8 and go-live → 9.

**Files:**
- Modify: `dashboard/components/SetupWizard/types.ts`
- Modify: `dashboard/components/SetupWizard/WizardStepContent.tsx`
- Modify: `dashboard/components/SetupWizard/index.tsx`

- [ ] **Step 1: Widen the WizardStep type**

In `dashboard/components/SetupWizard/types.ts`:

```ts
// was: export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
```

- [ ] **Step 2: Renumber the step switch + render the new step**

In `dashboard/components/SetupWizard/WizardStepContent.tsx`, add the import and change the trailing cases:

```tsx
import { StepWebsiteImport } from './StepWebsiteImport';
```

```tsx
    case 7:
      return <StepWebsiteImport tenantId={tenantId} />;
    case 8:
      return <Step7CallerQuestions tenantId={tenantId} />;
    case 9:
      return <Step7GoLive phoneStatus={phoneStatus} inboundPhone={inboundPhone} />;
    default:
      return null;
```

- [ ] **Step 3: Update labels, nav bounds, and the chip strip in index.tsx**

In `dashboard/components/SetupWizard/index.tsx`:

1. `getStepLabels` return object — insert the new label and shift the trailing two (it returns `Record<WizardStep, string>`):

```ts
    // ...existing 1..6 labels unchanged...
    7: 'From your website',
    8: 'Teach Your AI',
    9: "You're live",
```

2. Advance bound (was `Math.min(step + 1, 8)`):

```ts
const next = Math.min(step + 1, 9) as WizardStep;
```

3. Go-live fan-out guard (was `next === 8`) — Go Live is now step 9:

```ts
if (next === 9 && tenantId) {
```

4. Chip strip array (was `[1, 2, 3, 4, 5, 6, 7, 8]`):

```ts
{([1, 2, 3, 4, 5, 6, 7, 8, 9] as WizardStep[]).map((s) => (
```

> `canAdvanceTo` gates forward moves by completeness of the *current* step. The new
> website-import step must always be skippable (it is optional). Check `canAdvanceTo`
> — if it has a per-step rule that would block leaving step 7, ensure step 7 returns
> `true` (no required input). The caller-questions step was already skippable, so
> shifting it to 8 keeps that behavior; just confirm no numeric literal inside
> `canAdvanceTo` still points at the old step numbers.

- [ ] **Step 4: Typecheck + run the team wizard tests**

Run: `cd dashboard && npx tsc --noEmit && npx vitest run SetupWizard`
Expected: typecheck clean; `SetupWizard.test.tsx`, `SetupWizard.seed.test.tsx`, `SetupWizard.backToPicker.test.tsx` pass. If any assert a step count or label by number, update those assertions to the new numbering.

- [ ] **Step 5: Commit**

```bash
git add dashboard/components/SetupWizard/types.ts dashboard/components/SetupWizard/WizardStepContent.tsx dashboard/components/SetupWizard/index.tsx
git commit -m "feat(dashboard): add website-import step before caller-questions (team wizard)"
```

---

## Task 6: Insert the new step into the SOLO wizard

The solo wizard (`SoloWizard.tsx`) renders `Step7CallerQuestions` at its step 3 (`{step === 3 && <Step7CallerQuestions .../>}`), with go-live at step 4 and a `STEP_LABELS: Record<SoloStep, string>` map. Insert website-import as the **new step 3**, pushing caller-questions → 4 and go-live → 5.

**Files:**
- Modify: `dashboard/components/SetupWizard/SoloWizard.tsx`

- [ ] **Step 1: Renumber and add the new step**

In `SoloWizard.tsx`:

1. Widen the `SoloStep` type (find its definition — e.g. `type SoloStep = 1 | 2 | 3 | 4;`) to add one more number:

```ts
type SoloStep = 1 | 2 | 3 | 4 | 5;
```

2. Add the import:

```ts
import { StepWebsiteImport } from './StepWebsiteImport';
```

3. In the existing `STEP_LABELS` map: leave the entries for steps 1 and 2 exactly as they are, then set the three trailing entries so the new step 3 is the import and caller-questions/go-live shift up:

```ts
  // keep existing `1:` and `2:` entries unchanged, then:
  3: 'From your website',
  4: 'Teach Your AI',
  5: "You're live",
```

> The existing map currently ends at `3:` (caller-questions) and `4:` (go-live). You
> are adding a `5:` entry and re-pointing `3:`/`4:`. Keep whatever exact strings the
> file already uses for the caller-questions and go-live labels (move them to `4:`/`5:`).

4. Renumber the render conditions. The current `{step === 3 && <Step7CallerQuestions tenantId={tenantId} />}` and the step-4 go-live block shift up by one; the new step 3 renders the import:

```tsx
{step === 3 && <StepWebsiteImport tenantId={tenantId} />}
{step === 4 && <Step7CallerQuestions tenantId={tenantId} />}
{/* step === 5: the existing go-live block, renumbered from 4 */}
```

5. Update any numeric nav bounds in the solo wizard (the `Math.min(step + 1, MAX)` advance and any `step === LAST` guards) so the max step is now `5`. Grep the file for every numeric step literal and shift the trailing ones.

- [ ] **Step 2: Typecheck + run the solo wizard tests**

Run: `cd dashboard && npx tsc --noEmit && npx vitest run SoloWizard`
Expected: typecheck clean; `SoloWizard.test.tsx` passes. Update any step-number assertions in the test to the new numbering.

- [ ] **Step 3: Commit**

```bash
git add dashboard/components/SetupWizard/SoloWizard.tsx
git commit -m "feat(dashboard): add website-import step before caller-questions (solo wizard)"
```

---

## Task 7: Suggestion-aware question list + discovered section (KnowledgeBaseView)

This makes the questionnaire the review surface Dale described: questions the site answered show pre-filled with a "from website" badge + confidence and Approve/Edit; questions the site did not answer are visually marked "not found on your website"; discovered topics get an accept/reject section; and a re-run import button lives here too.

**Files:**
- Modify: `dashboard/components/KnowledgeBaseView.tsx`

- [ ] **Step 1: Load suggestions alongside the existing data**

In the main component, add suggestion state and fetch it in the existing `fetchDocs` flow (it already calls `Api.knowledge.list`). Build a map keyed by `question_id` for O(1) lookup while rendering each question:

```tsx
import type { PolicyQuestion } from '../lib/policyQuestions';

interface Suggestion {
  id: string;
  question_id: string | null;
  question: string;
  answer: string | null;
  source_url: string | null;
  confidence: number | null;
}

// inside the component:
const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(new Map());
const [discovered, setDiscovered] = useState<Suggestion[]>([]);

const fetchSuggestions = useCallback(async () => {
  if (!tenantId) return;
  try {
    const res = await Api.knowledge.suggestions(tenantId);
    if (!res.success) return;
    const byQid = new Map<string, Suggestion>();
    const disc: Suggestion[] = [];
    for (const s of res.suggestions) {
      if (s.question_id) byQid.set(s.question_id, s);
      else disc.push(s); // discovered topics have no bank question_id
    }
    setSuggestions(byQid);
    setDiscovered(disc);
  } catch {
    // no suggestions surface → questionnaire behaves exactly as before
  }
}, [tenantId]);

useEffect(() => { void fetchSuggestions(); }, [fetchSuggestions]);
```

- [ ] **Step 2: Render the suggestion badge + Approve/Edit on each question field**

Extend `PolicyQuestionField` (or its caller) so that when a `suggestion` prop is present AND there is no saved confirmed answer yet, it:
- pre-fills the textarea with `suggestion.answer`,
- shows a badge `from website ✓` linking to `suggestion.source_url`,
- shows a confidence pill (`High`/`Medium`/`Low` from `confidence` ≥0.75 / ≥0.4 / else),
- offers an **Approve** button calling `Api.knowledge.approveSuggestion(suggestion.id, tenantId, currentTextareaValue)` then refetching, and
- when the owner edits the textarea before approving, the edited text is what gets sent (edit-then-approve is the same Approve button).

```tsx
// add to PolicyQuestionField props:
//   suggestion?: Suggestion | null;
//   onApprove?: (suggestionId: string, answer: string) => Promise<void>;

{suggestion && !savedId && (
  <div className="flex items-center gap-2 mb-1">
    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
      from website ✓
    </span>
    {suggestion.source_url && (
      <a href={suggestion.source_url} target="_blank" rel="noreferrer"
         className="text-xs underline text-blue-600 dark:text-blue-400">source</a>
    )}
    <ConfidencePill confidence={suggestion.confidence} />
    <button
      onClick={() => onApprove?.(suggestion.id, value)}
      className="ml-auto text-xs font-medium px-2 py-0.5 rounded bg-green-500 text-white"
    >
      Approve
    </button>
  </div>
)}
```

Add a small `ConfidencePill` helper in the same file:

```tsx
function ConfidencePill({ confidence }: { confidence: number | null }) {
  const c = confidence ?? 0;
  const label = c >= 0.75 ? 'High' : c >= 0.4 ? 'Medium' : 'Low';
  const cls =
    c >= 0.75 ? 'bg-green-100 text-green-700'
    : c >= 0.4 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label} confidence</span>;
}
```

- [ ] **Step 3: Mark empty-vs-unanswered (spec piece 4)**

For a question that has **no** saved answer AND **no** suggestion, show a subtle "not found on your website" marker so the owner sees exactly what the scan could not fill — distinct from a question they simply haven't reached. Only render this marker after at least one import has run (i.e. when `suggestions.size > 0 || discovered.length > 0`), so businesses that never imported don't see it:

```tsx
{importHasRun && !savedAnswer && !suggestion && (
  <span className="text-xs italic text-gray-400">not found on your website — add it here</span>
)}
```

Pass `importHasRun = suggestions.size > 0 || discovered.length > 0` down to the field.

- [ ] **Step 4: Discovered-topics section + a re-run import control**

Add a section (near the existing Custom Questions section) listing `discovered` suggestions with **Accept** (calls `approveSuggestion`, which embeds it) and **Dismiss** (calls `rejectSuggestion`), refetching after each. Add a "Re-scan website" button that opens a small URL input and calls `Api.knowledge.importWebsite`, then `fetchSuggestions()` — reusing the same path as the wizard step. (Spec: re-scrape never overwrites confirmed answers; the backend already enforces this by deleting only `suggested` rows.)

- [ ] **Step 5: Typecheck + run dashboard tests**

Run: `cd dashboard && npx tsc --noEmit && npx vitest run KnowledgeBaseView`
Expected: typecheck clean; existing `KnowledgeBaseView` tests pass. If a test asserts the exact field markup, update it for the new badge/marker.

- [ ] **Step 6: Commit**

```bash
git add dashboard/components/KnowledgeBaseView.tsx
git commit -m "feat(dashboard): suggestion review in questionnaire — badge, confidence, empty-vs-found, discovered"
```

---

## Task 8: Full-suite verification

- [ ] **Step 1: Backend checks + tests**

Run: `npm run checks && npm test`
Expected: format/lint/tsc clean; all backend tests pass (incl. Plan 2 + Plan 3 service tests).

- [ ] **Step 2: Dashboard typecheck + tests**

Run: `cd dashboard && npx tsc --noEmit && npx vitest run`
Expected: clean; all dashboard tests pass.

- [ ] **Step 3: Manual end-to-end smoke (optional, with a dev server)**

1. Start backend + dashboard (`npm start` or the project's run script).
2. Onboard a new tenant → reach the new "From your website" step → paste a real small-business URL → Scan.
3. Advance to "Teach Your AI": confirm questions pre-fill with "from website ✓" badges + confidence; Approve one; confirm it disappears from suggestions and appears as a saved answer.
4. Confirm a question the site did not cover shows "not found on your website".
5. Confirm an approved answer is now retrievable by the agent (it lives in `tenant_docs`).

- [ ] **Step 4: Commit (if any test fixups were needed)**

```bash
git add -A
git commit -m "test: align wizard/knowledge tests with website-import review flow"
```

---

## Plan 3 Self-Review

- **Spec coverage:** Implements spec §"What is new — 3. Suggestion + provenance + review loop" (suggestion vs confirmed vs empty states; "from website ✓ [source]" badge; confidence indicator; Approve / Edit-then-approve / Empty-write-it; discovered section) and §4 empty-vs-unanswered distinction. Approve→embed goes through the existing `prepareQADocument` path so only confirmed Q&A reaches `tenant_docs` (spec "Storage & flow"). Re-scan safety (never overwrite confirmed) is enforced backend-side from Plan 2 and surfaced via the re-run control here.
- **Type consistency:** `Suggestion` shape (`id, question_id, question, answer, source_url, confidence, status`) matches the `knowledge_suggestion` columns (Plan 2) and the `Api.knowledge.suggestions` return type (Task 3). `toQAInputs` output feeds the identical `tenant_docs` insert column list used by `/knowledge/add`. New `WizardStep`/`SoloStep` numbering is applied consistently across type, switch, labels, nav bounds, and chip strip.
- **Deferred / not done:** "Approve all high-confidence" bulk action from the spec is a nice-to-have not broken into a task here — it is a thin client-side loop over `approveSuggestion` for suggestions with `confidence ≥ 0.75`; add it as a follow-up button in Task 7 if desired. Flagged so it is not silently dropped.
- **Open verifications flagged inline:** exact `canAdvanceTo` numeric literals (team wizard); the solo wizard's `SoloStep` definition + label strings + numeric nav bounds; whether existing wizard/KnowledgeBaseView tests assert step numbers or field markup (update to new numbering/markup). Each is called out at the step that touches it.

---

## Feature complete

With Plans 1–3 merged, the full "Website Knowledge Import" feature ships: business-type-aware question bank → paste-URL bounded scrape → single-LLM extraction with injection containment → staged suggestions → in-questionnaire review (approve/edit/fill) → only confirmed Q&A embedded to live RAG. See the design spec `docs/superpowers/specs/2026-06-09-website-knowledge-import-design.md`.
