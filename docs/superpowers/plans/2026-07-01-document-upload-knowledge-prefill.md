# Document Upload → Knowledge Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner upload a PDF/txt/md document that (a) auto-fills the standard knowledge questions from its prose and (b) adds their own custom Q&A via a deterministic `**Q:/**A:` marker convention — all staged for review, mirroring the existing website Scan & Prefill.

**Architecture:** A new pure parser (`shared/markerQuestions.ts`) splits an uploaded document into deterministic custom Q&A blocks + leftover prose. A new backend endpoint `POST /knowledge/import-document` reuses `extractFileContent` (file → text), the parser (custom questions), and the existing `extractAnswersWithLLM` over the prose (standard answers), then stages everything to `knowledge_suggestion` for owner review — the same staging + review flow the website scan already uses. A dashboard upload control sits next to the existing "Scan & Prefill".

**Tech Stack:** TypeScript, Fastify 4 (+ `@fastify/multipart` already wired for `/knowledge/ingest`), Postgres (`knowledge_suggestion` table), Vitest (backend + `shared/**`), React/Next.js dashboard.

## Global Constraints

- **No DB migration.** Stage to the existing `knowledge_suggestion` table (columns: `tenant_id, question_id, question, answer, source_url, confidence, status`). There is no `source` column — carry provenance in `source_url` as the literal `document:<filename>`. Copied from spec §7 ("No migration").
- **Nothing auto-publishes.** Every item enters `knowledge_suggestion` with `status = 'suggested'`; the owner approves/edits/discards before it reaches the live KB. (Same gate as the website scan.)
- **Deterministic custom questions only.** Custom Q&A come ONLY from `**Q:/**A:` markers — no AI invention. AI is used ONLY to answer the standard questions from prose.
- **E2E stub gate:** `KNOWLEDGE_IMPORT_E2E_STUB === '1'` (strict literal) swaps the real OpenAI extract for canned output AND skips the rate limiter — same discipline as `/knowledge/import-website`. Off by default.
- **Marker syntax (verbatim from spec §2):** a line whose first non-whitespace chars are `**Q:` starts a question (case-insensitive, tolerate `** Q:` / `**q:` / surrounding whitespace); `**A:` starts the answer; the answer runs as a continuous block until a **blank line** ends it; a `**Q:` with no following `**A:` before the next `**Q:`/EOF is malformed → reported, not dropped; a `**A:` with no preceding `**Q:` is ignored; everything outside a block is prose. CRLF and LF both handled.
- **Allowed file types:** reuse the existing `ALLOWED_EXTENSIONS` allow-list already enforced by `/knowledge/ingest` (`getFileExtension` / `isAllowedExtension` in `src/routes/knowledge.ts`).

---

### Task 1: Marker parser (`shared/markerQuestions.ts`)

Pure, cross-runtime, no I/O. Splits document text into deterministic custom Q&A, malformed markers, and leftover prose.

**Files:**

- Create: `shared/markerQuestions.ts`
- Test: `shared/markerQuestions.test.ts`

**Interfaces:**

- Consumes: nothing (pure string in).
- Produces:

  ```ts
  export interface MarkerQuestion {
    question: string;
    answer: string;
  }
  export interface MarkerParseResult {
    custom: MarkerQuestion[]; // well-formed **Q:/**A: pairs
    malformed: string[]; // question text of a **Q: with no **A:
    prose: string; // everything outside any marker block
  }
  export function parseMarkerQuestions(text: string): MarkerParseResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `shared/markerQuestions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMarkerQuestions } from './markerQuestions';

describe('parseMarkerQuestions', () => {
  it('parses a single well-formed block', () => {
    const r = parseMarkerQuestions('**Q: Do you sell gift cards?\n**A: Yes, any amount.');
    expect(r.custom).toEqual([{ question: 'Do you sell gift cards?', answer: 'Yes, any amount.' }]);
    expect(r.malformed).toEqual([]);
  });

  it('joins a multi-line question up to the **A: line', () => {
    const r = parseMarkerQuestions(
      '**Q: What is your\ncancellation policy?\n**A: 24 hours notice.'
    );
    expect(r.custom[0].question).toBe('What is your cancellation policy?');
    expect(r.custom[0].answer).toBe('24 hours notice.');
  });

  it('treats the answer as a continuous block ended by a blank line', () => {
    const r = parseMarkerQuestions(
      '**Q: Hours?\n**A: Mon-Fri 9-5.\nWeekends closed.\n\nignored prose'
    );
    expect(r.custom[0].answer).toBe('Mon-Fri 9-5.\nWeekends closed.');
    expect(r.prose).toContain('ignored prose');
  });

  it('parses multiple blocks', () => {
    const r = parseMarkerQuestions('**Q: A?\n**A: 1.\n\n**Q: B?\n**A: 2.');
    expect(r.custom).toEqual([
      { question: 'A?', answer: '1.' },
      { question: 'B?', answer: '2.' },
    ]);
  });

  it('reports a **Q: with no **A: as malformed (not dropped)', () => {
    const r = parseMarkerQuestions('**Q: Orphan question?\n\n**Q: Real?\n**A: yes');
    expect(r.malformed).toEqual(['Orphan question?']);
    expect(r.custom).toEqual([{ question: 'Real?', answer: 'yes' }]);
  });

  it('ignores a **A: with no preceding **Q:', () => {
    const r = parseMarkerQuestions('**A: stray answer\nsome prose');
    expect(r.custom).toEqual([]);
    expect(r.malformed).toEqual([]);
  });

  it('is case- and whitespace-tolerant and handles CRLF', () => {
    const r = parseMarkerQuestions('  ** q :  Spaced?\r\n** a : Yes.\r\n');
    expect(r.custom).toEqual([{ question: 'Spaced?', answer: 'Yes.' }]);
  });

  it('returns all text as prose when there are no markers', () => {
    const r = parseMarkerQuestions('Just hours and services, no markers.');
    expect(r.custom).toEqual([]);
    expect(r.malformed).toEqual([]);
    expect(r.prose.trim()).toBe('Just hours and services, no markers.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/markerQuestions.test.ts`
Expected: FAIL — `Failed to resolve import "./markerQuestions"` / `parseMarkerQuestions is not a function`.

- [ ] **Step 3: Write the implementation**

Create `shared/markerQuestions.ts`:

```ts
/**
 * Pure parser for the document-upload knowledge convention. An owner marks their
 * own Q&A with `**Q:` / `**A:` lines; everything else is prose the AI answers the
 * standard questions from. No I/O — fully unit-testable. (Spec: docs/superpowers/
 * specs/2026-06-30-document-upload-knowledge-prefill-design.md §2.)
 */
export interface MarkerQuestion {
  question: string;
  answer: string;
}

export interface MarkerParseResult {
  /** Well-formed `**Q:`/`**A:` pairs. */
  custom: MarkerQuestion[];
  /** Question text of any `**Q:` that never got a `**A:` — reported, not dropped. */
  malformed: string[];
  /** Everything outside a marker block, for the standard-question AI pass. */
  prose: string;
}

const Q_MARKER = /^\s*\*\*\s*q\s*:/i;
const A_MARKER = /^\s*\*\*\s*a\s*:/i;

/** Strip the leading `**Q:` / `**A:` marker, return the remainder trimmed. */
function afterMarker(line: string): string {
  return line.replace(/^\s*\*\*\s*[qa]\s*:/i, '').trim();
}

export function parseMarkerQuestions(text: string): MarkerParseResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const custom: MarkerQuestion[] = [];
  const malformed: string[] = [];
  const prose: string[] = [];

  // State machine: 'prose' | 'q' (collecting question) | 'a' (collecting answer).
  let state: 'prose' | 'q' | 'a' = 'prose';
  let qBuf: string[] = [];
  let aBuf: string[] = [];

  const commitPair = () => {
    const question = qBuf.join(' ').trim();
    const answer = aBuf.join('\n').trim();
    if (question) custom.push({ question, answer });
    qBuf = [];
    aBuf = [];
  };
  const commitOrphanQuestion = () => {
    const question = qBuf.join(' ').trim();
    if (question) malformed.push(question);
    qBuf = [];
  };

  for (const line of lines) {
    const isQ = Q_MARKER.test(line);
    const isA = A_MARKER.test(line);

    if (isQ) {
      // A new question starts. Close whatever came before.
      if (state === 'a') commitPair();
      else if (state === 'q') commitOrphanQuestion(); // previous **Q: never got a **A:
      state = 'q';
      qBuf = [afterMarker(line)];
      continue;
    }

    if (isA) {
      if (state === 'q') {
        state = 'a';
        aBuf = [afterMarker(line)];
      }
      // A stray **A: with no open **Q: is ignored (dropped, not prose).
      continue;
    }

    if (state === 'q') {
      // Multi-line question body continues until the **A: line.
      qBuf.push(line.trim());
      continue;
    }

    if (state === 'a') {
      // Answer is a continuous block; a blank line ends it.
      if (line.trim() === '') {
        commitPair();
        state = 'prose';
      } else {
        aBuf.push(line);
      }
      continue;
    }

    // state === 'prose'
    prose.push(line);
  }

  // Flush trailing state at EOF.
  if (state === 'a') commitPair();
  else if (state === 'q') commitOrphanQuestion();

  return { custom, malformed, prose: prose.join('\n') };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run shared/markerQuestions.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/markerQuestions.ts shared/markerQuestions.test.ts
git commit -m "feat(knowledge): pure **Q:/**A: marker parser for document upload"
```

---

### Task 2: Backend endpoint `POST /knowledge/import-document`

Multipart upload → text → deterministic custom Q&A + AI-answered standard questions → stage to `knowledge_suggestion`. Mirrors `/knowledge/ingest` (multipart) + `/knowledge/import-website` (resolve → extract → stage).

**Files:**

- Modify: `src/routes/knowledge.ts` (add the route; register it alongside `/knowledge/import-website`, which ends near line 654 with `}, 'Failed to import from website'));`)
- Test: `src/knowledge-import-document.test.ts` (create)

**Interfaces:**

- Consumes: `extractFileContent(buffer, filename)` → `{ success: true, text } | { success: false, error }`; `parseMarkerQuestions(text)` (Task 1); `resolveQuestions({ customs })` → `Array<{ id: string | null; question: string }>`; `extractAnswersWithLLM(text, questions, source, apiKey)` → `{ success: true, answers, discovered, usage } | { success: false, error }`; `scanRateLimiter.tryAcquire(tenantId)`; `getFileExtension` / `isAllowedExtension` / `ALLOWED_EXTENSIONS`.
- Produces: `POST /knowledge/import-document` returning

  ```ts
  {
    success: true;
    standard_answers: Array<{ questionId: string | null; question: string; answer: string | null }>;
    custom_questions: Array<{ question: string; answer: string }>;
    malformed: string[];
    confirmed: number;   // count staged (standard w/ answer + custom)
  } | { success: false; error: string }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/knowledge-import-document.test.ts` (mirrors the E2E-stub discipline of the website-scan tests; drives the endpoint through `app.inject` with a multipart body and `KNOWLEDGE_IMPORT_E2E_STUB=1`). Use the existing test harness helpers the other route tests use:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import FormData from 'form-data';
import { buildTestApp, type TestApp } from './test-utils'; // buildTestApp returns { app, tenantId, ownerToken, client }
import { skipIfDbDown } from './test-utils';

describe('POST /knowledge/import-document', () => {
  let t: TestApp;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    process.env.KNOWLEDGE_IMPORT_E2E_STUB = '1';
    try {
      t = await buildTestApp();
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    delete process.env.KNOWLEDGE_IMPORT_E2E_STUB;
    if (dbAvailable && t) await t.close();
  });

  async function upload(body: string, filename = 'faq.md') {
    const form = new FormData();
    form.append('tenant_id', t.tenantId);
    form.append('file', Buffer.from(body), { filename, contentType: 'text/markdown' });
    return t.app.inject({
      method: 'POST',
      url: '/knowledge/import-document',
      headers: { ...form.getHeaders(), authorization: `Bearer ${t.ownerToken}` },
      payload: form,
    });
  }

  it('parses custom **Q:/**A: blocks and stages them (deterministic, no AI)', async () => {
    if (!dbAvailable) return;
    const res = await upload(
      'We are open Mon-Fri.\n\n**Q: Do you sell gift cards?\n**A: Yes, any amount.\n'
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.custom_questions).toEqual([
      { question: 'Do you sell gift cards?', answer: 'Yes, any amount.' },
    ]);
    // Staged to knowledge_suggestion under a document: source.
    const staged = await t.client.query(
      `SELECT question, answer, source_url FROM knowledge_suggestion
       WHERE tenant_id = $1 AND source_url LIKE 'document:%'`,
      [t.tenantId]
    );
    expect(staged.rows.some((r) => r.question === 'Do you sell gift cards?')).toBe(true);
  });

  it('reports malformed **Q: without **A:', async () => {
    if (!dbAvailable) return;
    const res = await upload('**Q: Orphan?\n\nsome prose', 'x.md');
    expect(res.json().malformed).toEqual(['Orphan?']);
  });

  it('rejects an unsupported file type', async () => {
    if (!dbAvailable) return;
    const res = await upload('irrelevant', 'malware.exe');
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });
});
```

> NOTE for the implementer: match the ACTUAL test harness in this repo. Confirm the exact `buildTestApp` shape by reading a sibling route test that uses `app.inject` with an owner JWT (e.g. `src/voice.test.ts`) and adapt the helper names/imports (`ownerToken`, `client`, `close`) to whatever that harness exposes. Keep the three assertions above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/knowledge-import-document.test.ts`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Write the route**

In `src/routes/knowledge.ts`, add the import at the top (near the other shared imports, after line 20 `import { resolveQuestions } from '../../shared/questionBank';`):

```ts
import { parseMarkerQuestions } from '../../shared/markerQuestions';
```

Then register the route immediately after the `/knowledge/import-website` route closes (`}, 'Failed to import from website'));`):

```ts
// POST /knowledge/import-document — upload a PDF/txt/md info sheet. Deterministic
// **Q:/**A: markers become custom questions; the leftover prose is AI-answered
// against the standard question bank. Everything stages to knowledge_suggestion
// for owner review — same gate as the website scan. (Spec: docs/superpowers/
// specs/2026-06-30-document-upload-knowledge-prefill-design.md)
app.post(
  '/knowledge/import-document',
  withHandler(async (req: AppRequest, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });

    const tenantId = (data.fields.tenant_id as { value?: string } | undefined)?.value;
    if (!tenantId)
      return reply.status(400).send({ success: false, error: 'tenant_id is required' });

    const filename = data.filename;
    const ext = getFileExtension(filename);
    if (!isAllowedExtension(ext)) {
      return reply.status(400).send({
        success: false,
        error: `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
    }

    // Per-tenant guardrail on the expensive AI pass (skipped in the deterministic
    // E2E stub). Same limiter the website scan uses.
    if (process.env.KNOWLEDGE_IMPORT_E2E_STUB !== '1' && !scanRateLimiter.tryAcquire(tenantId)) {
      logEvent(req, 'document_import_rate_limited', { tenantId });
      return reply.status(429).send({
        success: false,
        error: 'Import limit reached. Please wait a bit before uploading again.',
      });
    }

    const buffer = await data.toBuffer();
    const extracted = await extractFileContent(buffer, filename);
    if (!extracted.success) {
      return reply.status(400).send({ success: false, error: extracted.error });
    }

    // Deterministic custom Q&A + leftover prose.
    const { custom, malformed, prose } = parseMarkerQuestions(extracted.text);

    // Standard questions = shared bank + this tenant's custom-question titles.
    const customRows = await withTenantClient(tenantId, async (client) =>
      client.query(
        `SELECT title FROM tenant_docs
           WHERE tenant_id = $1 AND source = 'custom-question' AND title IS NOT NULL
           ORDER BY created_at DESC
           LIMIT 50`,
        [tenantId]
      )
    );
    const customs = customRows.rows.map((r: any) => r.title as string);
    const questions = resolveQuestions({ customs });

    const sourceTag = `document:${filename}`;

    // Standard answers from the prose. Stub → deterministic; else real OpenAI.
    // The custom (marker) questions NEVER depend on the model — they come through
    // even if the AI pass fails/degrades (spec §5 resilience win).
    let standardAnswers: Array<{
      questionId: string | null;
      question: string;
      answer: string | null;
    }> = [];
    if (process.env.KNOWLEDGE_IMPORT_E2E_STUB === '1') {
      const picks = [
        ...questions.filter((q) => q.id === null),
        ...questions.filter((q) => q.id !== null).slice(0, 2),
      ];
      standardAnswers = picks.map((q) => ({
        questionId: q.id,
        question: q.question,
        answer: `Stubbed answer for: ${q.question}`,
      }));
    } else if (prose.trim().length > 0) {
      const llm = await extractAnswersWithLLM(
        prose,
        questions,
        sourceTag,
        process.env.OPENAI_API_KEY || ''
      );
      if (llm.success) {
        standardAnswers = llm.answers.map((a) => ({
          questionId: a.questionId,
          question: a.question,
          answer: a.answer,
        }));
        if (llm.usage) {
          const input = llm.usage.prompt_tokens || 0;
          const output = llm.usage.completion_tokens || 0;
          const cost = input * 0.15e-6 + output * 0.6e-6;
          withTenantClient(tenantId, (client) =>
            recordAiCostEvent(client, {
              tenantId,
              source: 'kb_ingestion',
              provider: 'openai',
              model: 'gpt-4o-mini',
              inputTokens: input,
              outputTokens: output,
              estimatedCostUsd: cost,
            })
          ).catch(() => undefined);
        }
      }
      // AI failure degrades gracefully: standardAnswers stays [] but custom still flows.
    }

    // Stage: standard (with a non-empty answer) + every custom pair, all 'suggested'.
    const standardItems = standardAnswers
      .filter((a) => a.answer != null && (a.answer as string).trim().length > 0)
      .map((a) => ({
        question_id: a.questionId || null,
        question: a.question || '',
        answer: a.answer as string,
      }));
    const customItems = custom.map((c) => ({
      question_id: null as string | null,
      question: c.question,
      answer: c.answer,
    }));
    const allItems = [...standardItems, ...customItems];

    if (allItems.length > 0) {
      await withTenantClient(tenantId, async (client) => {
        for (const item of allItems) {
          await client.query(
            `INSERT INTO knowledge_suggestion
                 (tenant_id, question_id, question, answer, source_url, confidence, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'suggested')`,
            [tenantId, item.question_id, item.question, item.answer, sourceTag, null]
          );
        }
      });
    }

    logEvent(req, 'document_knowledge_import', {
      tenantId,
      filename,
      standard: standardItems.length,
      custom: customItems.length,
      malformed: malformed.length,
    });

    return reply.send({
      success: true,
      standard_answers: standardAnswers,
      custom_questions: custom,
      malformed,
      confirmed: allItems.length,
    });
  }, 'Failed to import from document')
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/knowledge-import-document.test.ts`
Expected: PASS (3 tests). If the harness helper names differ, fix imports per the NOTE in Step 1 — do not change the assertions.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit && \
git add src/routes/knowledge.ts src/knowledge-import-document.test.ts && \
git commit -m "feat(knowledge): POST /knowledge/import-document (marker Q&A + prose extract)"
```

---

### Task 3: Dashboard API wrapper `Api.knowledge.importDocument`

**Files:**

- Modify: `dashboard/lib/api.ts` (inside the `knowledge:` namespace, right after the `ingest:` wrapper near line 816-836)

**Interfaces:**

- Consumes: `API_BASE_URL`, `getLocalStorageItem('authToken')` (both already used by `ingest`).
- Produces:

  ```ts
  Api.knowledge.importDocument(tenantId: string | null, file: File): Promise<{
    success: boolean;
    standard_answers?: Array<{ questionId: string | null; question: string; answer: string | null }>;
    custom_questions?: Array<{ question: string; answer: string }>;
    malformed?: string[];
    confirmed?: number;
    error?: string;
  }>
  ```

- [ ] **Step 1: Add the wrapper**

In `dashboard/lib/api.ts`, directly after the `ingest:` wrapper's closing `},` inside `knowledge: {`:

```ts
    importDocument: async (tenantId: string | null, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (tenantId) formData.append('tenant_id', tenantId);

      const token = getLocalStorageItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE_URL}/knowledge/import-document`, {
        method: 'POST',
        headers,
        body: formData,
      });
      return (await response.json()) as {
        success: boolean;
        standard_answers?: Array<{ questionId: string | null; question: string; answer: string | null }>;
        custom_questions?: Array<{ question: string; answer: string }>;
        malformed?: string[];
        confirmed?: number;
        error?: string;
      };
    },
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat(knowledge): Api.knowledge.importDocument multipart wrapper"
```

---

### Task 4: Dashboard "Upload a document" control (`Step7WebsiteScan.tsx`)

Add a file input beside the existing "Scan & Prefill" that calls `importDocument`, prefills the standard starter answers exactly like the scan, and reports custom questions added + malformed markers.

**Files:**

- Modify: `dashboard/components/SetupWizard/Step7WebsiteScan.tsx`
- Test: `dashboard/components/SetupWizard/Step7WebsiteScan.test.tsx` (create if absent; else add a test case)

**Interfaces:**

- Consumes: `Api.knowledge.importDocument` (Task 3); `Api.knowledge.add` (already imported/used in this file); `STARTER_IDS`, `STARTER_QUESTIONS` (already imported).
- Produces: no exports (internal handler `handleUpload`).

- [ ] **Step 1: Write the failing component test**

Create `dashboard/components/SetupWizard/Step7WebsiteScan.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockImportDocument = vi.fn();
const mockAdd = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../lib/api', () => ({
  Api: {
    knowledge: {
      importDocument: (...a: unknown[]) => mockImportDocument(...a),
      add: (...a: unknown[]) => mockAdd(...a),
      importWebsite: vi.fn(),
    },
  },
}));

import { Step7WebsiteScan } from './Step7WebsiteScan';

describe('Step7WebsiteScan — document upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads a document and reports the custom questions added', async () => {
    mockImportDocument.mockResolvedValue({
      success: true,
      standard_answers: [],
      custom_questions: [{ question: 'Do you sell gift cards?', answer: 'Yes.' }],
      malformed: [],
      confirmed: 1,
    });

    render(<Step7WebsiteScan tenantId="t1" />);
    const input = screen.getByTestId('kb-document-upload') as HTMLInputElement;
    const file = new File(['**Q: Do you sell gift cards?\n**A: Yes.'], 'faq.md', {
      type: 'text/markdown',
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockImportDocument).toHaveBeenCalledWith('t1', file));
    await waitFor(() => expect(screen.getByText(/1 custom question/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run components/SetupWizard/Step7WebsiteScan.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="kb-document-upload"]`.

- [ ] **Step 3: Add the upload control + handler**

In `dashboard/components/SetupWizard/Step7WebsiteScan.tsx`, add a handler alongside `handleScan` and render a file input. Insert the handler after `handleScan`:

```tsx
const handleUpload = useCallback(
  async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await Api.knowledge.importDocument(tenantId, file);
      if (res?.success) {
        // Prefill the standard starter questions exactly like the website scan.
        let filled = 0;
        for (const item of res.standard_answers || []) {
          if (item.questionId && STARTER_IDS.includes(item.questionId) && item.answer) {
            const q = STARTER_QUESTIONS.find((sq) => sq.id === item.questionId);
            if (q) {
              await Api.knowledge.add(tenantId, {
                question: item.question || q.question,
                answer: item.answer,
                category: q.category,
                source: 'document-upload',
              });
              filled++;
            }
          }
        }
        const customCount = res.custom_questions?.length || 0;
        const malformedCount = res.malformed?.length || 0;
        setMessage(
          `Imported ${filled} standard answer${filled === 1 ? '' : 's'} and ` +
            `${customCount} custom question${customCount === 1 ? '' : 's'} from your document. ` +
            `Review them in the next step.` +
            (malformedCount
              ? ` ${malformedCount} entr${malformedCount === 1 ? 'y' : 'ies'} looked like a question but had no **A: answer — fix and re-upload.`
              : '')
        );
      } else {
        setError(res?.error || 'Could not read that file — try a PDF or a .txt.');
      }
    } catch (err) {
      setError('Could not read that file — try a PDF or a .txt.');
      console.error('Document import error', err);
    } finally {
      setLoading(false);
      e.target.value = ''; // allow re-uploading the same filename
    }
  },
  [tenantId]
);
```

Then render the control next to the existing Scan button (inside the component's returned JSX, near the URL input / Scan button — keep the existing markup, add this block after it):

```tsx
<div className="mt-3">
  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
    …or upload a document (PDF, .txt, .md)
  </label>
  <input
    data-testid="kb-document-upload"
    type="file"
    accept=".pdf,.txt,.md"
    disabled={loading}
    onChange={handleUpload}
    className="block mt-1 text-sm"
  />
</div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run components/SetupWizard/Step7WebsiteScan.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd dashboard && npx tsc --noEmit && cd .. && \
git add dashboard/components/SetupWizard/Step7WebsiteScan.tsx dashboard/components/SetupWizard/Step7WebsiteScan.test.tsx && \
git commit -m "feat(knowledge): document-upload control in Step7 (prefill standard + custom)"
```

---

### Task 5: Bring the spec onto main + full-suite gate

**Files:**

- Create: `docs/superpowers/specs/2026-06-30-document-upload-knowledge-prefill-design.md` (copy from the parked `feat/document-upload-knowledge` branch so the design lands on main with the feature)

- [ ] **Step 1: Copy the spec**

```bash
git show feat/document-upload-knowledge:docs/superpowers/specs/2026-06-30-document-upload-knowledge-prefill-design.md \
  > docs/superpowers/specs/2026-06-30-document-upload-knowledge-prefill-design.md
```

- [ ] **Step 2: Run the full affected suites**

```bash
npx vitest run shared/markerQuestions.test.ts src/knowledge-import-document.test.ts
cd dashboard && npx vitest run components/SetupWizard/Step7WebsiteScan.test.tsx && npx tsc --noEmit && cd ..
npx tsc --noEmit
```

Expected: all PASS, both typechecks exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-30-document-upload-knowledge-prefill-design.md
git commit -m "docs(knowledge): land document-upload spec on main with the feature"
```

---

## Self-Review

**Spec coverage:**

- §2 marker format → Task 1 (parser) + tests. ✓
- §3 components: `shared/markerQuestions.ts` (T1), `POST /knowledge/import-document` (T2), reuse `extractFileContent`/`extractAnswersWithLLM`/`resolveQuestions`/`scanRateLimiter` (T2), `Api.knowledge.importDocument` (T3), upload control in `Step7WebsiteScan.tsx` (T4). ✓
- §4 data flow: rate-limit → extract → parse → AI-over-prose → stage to `knowledge_suggestion` → return counts. ✓ (T2)
- §5 error handling: unsupported file (400), no markers → prose only, malformed reported, LLM-down still returns custom, rate-limit 429. ✓ (T2 route + tests)
- §6 testing: parser unit tests (T1), backend stub tests (T2), dashboard test (T4). E2E is OPTIONAL and deferred — see note below.
- §7 rollout: reuses `KNOWLEDGE_IMPORT_E2E_STUB`, no migration, review-gated. ✓
- §8 open items: LLM-extract helper already exists (`extractAnswersWithLLM`) — reused, no new helper needed; provenance tag = `source_url = 'document:<filename>'` (decided, no `source` column). ✓

**Deferred (YAGNI):** The spec's optional stub-gated **E2E** (mirroring `kb-import-website-stub`) is not a task here — the backend stub test (T2) + component test (T4) cover the contract. Add an E2E later if the upload flow needs browser-level coverage. Flagged so it isn't mistaken for "covered".

**Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**Type consistency:** `parseMarkerQuestions` return `{ custom, malformed, prose }` used identically in T2; `standard_answers`/`custom_questions`/`malformed`/`confirmed` response shape matches between T2 (route), T3 (wrapper type), T4 (consumer). `extractAnswersWithLLM` 4-arg signature `(text, questions, source, apiKey)` matches its definition. ✓
