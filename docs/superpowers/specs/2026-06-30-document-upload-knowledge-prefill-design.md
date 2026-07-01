# Document upload → knowledge prefill (Solo setup)

**Date:** 2026-06-30
**Status:** Design (approved in brainstorming; pending spec review)
**Related:** `docs/STRATEGY.md` (website-scan onboarding = the "tiny yes"), the existing
website Scan & Prefill flow (`POST /knowledge/import-website`), `shared/questionBank.ts`.

---

## 1. Problem / goal

The Solo setup already has a **Scan & Prefill** button (paste a URL → the AI reads the
site and pre-fills the standard policy questions). Owners also want to **upload a document**
(their existing info sheet / FAQ, as PDF or text) and have it do the same job — plus a
**standard marker format** so an owner can put their **own** questions in that document and
have the system add them (with answers) to the page automatically.

One upload does two things:

1. **Answer the standard questions** — the AI reads the document's prose/FAQ and fills the
   page's standard questions (exactly like the website scan, but from a file, not a URL).
2. **Add the owner's custom questions** — any Q&A the owner marks with the `**Q:/**A:`
   convention is parsed **deterministically** and added as a custom question + answer.

Everything is **staged for owner review** before it reaches a live call — same gate as the
website scan's "Suggestions".

### Non-goals

- No new document store, no persistent "uploaded files" library (the KB already has file
  upload via `Api.knowledge.ingest` for raw-chunk RAG — this feature is about *questions*, not
  raw-chunk ingestion).
- No AI *invention* of custom questions from prose in v1 (the brainstorm chose the
  deterministic marker over fuzzy AI detection). AI is used only to answer the **standard**
  questions. Custom questions come **only** from the `**Q:/**A:` markers.
- Not wired into the main `KnowledgeBaseView` in v1 — Solo setup question step only. (Trivial
  to surface later since the endpoint is generic.)

---

## 2. The standard format (what the owner writes)

A plain **.txt / .md / .pdf** — the company's info sheet or FAQ. Two zones:

```
[Free prose: hours, services, policies, an existing FAQ — anything.
 The AI reads THIS to answer the STANDARD questions on the page.]

**Q: What is your cancellation policy?
**A: You can cancel up to 24 hours ahead at no charge. This answer is one
continuous block and may span several lines until a blank line ends it.

**Q: Do you sell gift cards?
**A: Yes — any amount, in-store or online.
```

**Parse rules (deterministic; no AI judgement):**

- A line whose first non-whitespace characters are `**Q:` starts a **question**. The question
  text is everything after `**Q:` on that line, joined with any following lines up to the
  `**A:` line (question may be a continuous multi-line block).
- A line whose first non-whitespace characters are `**A:` starts the **answer**. The answer is
  that line's text after `**A:` plus all following lines (a continuous block) **until a blank
  line (gap)** — the gap terminates the answer.
- A `**Q:` with no following `**A:` before the next `**Q:` / EOF — **or** interrupted by a blank
  line before any `**A:` — is **malformed** → skipped and reported (not silently dropped). The
  blank line ends the orphan question; any text after it is plain prose.
- Case-insensitive marker match; tolerate `** Q:` / `**q:` / surrounding whitespace; CRLF and
  LF both handled.
- Everything **not** inside a `**Q:/**A:` block is **prose** → passed to the AI pass for the
  standard questions.

The parser is a **pure function** — input `string`, output
`{ custom: {question, answer}[]; malformed: string[]; prose: string }` — no I/O, fully
unit-testable. (`prose` = everything outside a marker block, fed to the standard-question AI pass.)

---

## 3. Architecture / components

Small surface; most is reuse.

| Unit | New? | Responsibility |
| --- | --- | --- |
| `shared/markerQuestions.ts` — `parseMarkerQuestions(text)` | **new** | Pure `**Q:/**A:` parser → `{ custom, malformed, prose }`. Cross-runtime (shared) so backend + tests use it directly. |
| `POST /knowledge/import-document` (in `src/routes/knowledge.ts`) | **new** (mirrors `import-website`) | Multipart file → `extractFileContent` → `parseMarkerQuestions` (custom) + LLM extract over the prose (standard answers) → returns both; stages to `knowledge_suggestion` for review, same as the scan. |
| `extractFileContent` (`knowledgeIngestion.ts`) | reuse | PDF/txt/md/csv parsing (already used by `import-website` region + `knowledge/ingest`). |
| LLM extract prompt | reuse | The exact prompt/shape `import-website` uses to answer the standard questions (`resolveQuestions` + `max_tokens: 3000`, timeout-bounded). Extracted to a shared helper if `import-website` currently inlines it, so both endpoints call one function (targeted refactor, not new behavior). |
| `resolveQuestions` (`shared/questionBank.ts`) | reuse | The standard question set (+ tenant customs) the AI answers against. |
| `knowledge_suggestion` staging + review UI | reuse | Custom Q&A + AI standard answers land here; the owner approves/edits/discards before they hit `tenant_docs`. |
| `scanRateLimiter` (`scanRateLimit.ts`) | reuse | Per-tenant rate limit (a document parse costs an LLM call), same guard as the scan. |
| Dashboard: "Upload a document" control in `Step7WebsiteScan.tsx` | **new** (small) | File `<input>` next to Scan & Prefill → `Api.knowledge.importDocument(tenantId, file)` → prefill standard answers + surface custom questions for review. |
| `Api.knowledge.importDocument` (`dashboard/lib/api.ts`) | **new** | Multipart POST wrapper (mirror `Api.knowledge.ingest`). |

---

## 4. Data flow

```
Owner (Solo setup, question step)
  → clicks "Upload a document", picks a PDF/txt/md
  → Api.knowledge.importDocument(tenantId, file)     [multipart]
  → POST /knowledge/import-document
       1. rate-limit (scanRateLimiter)               → 429 if dry
       2. extractFileContent(buffer, filename)       → plain text (or graceful error)
       3. parseMarkerQuestions(text)                 → custom Q&A (deterministic) + malformed[]
       4. AI extract over the prose vs resolveQuestions(customs)
                                                     → standard_answers [{question_id, answer}]
       5. stage everything to knowledge_suggestion (source tag distinguishes
          'document-standard' vs 'document-custom')  → for review
       6. return { standard_answers, custom_questions, malformed, counts }
  → dashboard prefills the standard questions ("from your document") + lists the
    custom questions as added rows the owner can edit / keep / discard
  → on wizard finalize (existing path): approved answers → tenant_docs
       standard  → source='document-upload'
       custom    → source='custom-question'  (so resolveQuestions surfaces them next visit)
```

Consistency: mirrors the website-scan flow end-to-end so the review UX and storage are
identical — an owner who used the scan already knows this flow.

---

## 5. Error handling

- **Unsupported file / parse failure** — `extractFileContent` already returns
  `{success:false,error}`; surface a friendly "couldn't read that file — try a PDF or a .txt".
- **No markers + no extractable answers** — return empty sets + a message ("nothing to
  pre-fill — you can answer the questions by hand"), exactly like the scan's empty result.
- **Malformed `**Q:` (no `**A:`)** — skipped, returned in `malformed[]`, shown to the owner as
  "these looked like questions but had no answer — fix and re-upload."
- **LLM down / over quota** — the standard-answer pass degrades gracefully (empty standard
  answers) but the **deterministic custom questions still come through** (they need no AI).
  This is a real resilience win: the marker path never depends on the model.
- **Rate limit** — 429 + "you've uploaded a few documents recently, try again shortly."
- File size / page bounds reuse the existing ingest/scan guards (max chunks, timeouts).

---

## 6. Testing

- **Parser unit tests** (`shared/markerQuestions.test.ts`, pure, no DB): single block;
  multi-line question; multi-line answer; blank-line termination; multiple blocks; no markers
  (→ empty custom, all prose); malformed `**Q:` without `**A:` (→ malformed[]); case/whitespace
  variants (`** q:`); CRLF; a `**A:` with no preceding `**Q:` (ignored).
- **Backend** (`import-document`): multipart upload → returns `standard_answers` +
  `custom_questions` + `malformed`; LLM stubbed via `KNOWLEDGE_IMPORT_E2E_STUB` (same hook the
  scan uses); rate-limit 429; unsupported-file graceful error; LLM-down still returns custom
  questions.
- **Dashboard**: upload control renders next to Scan & Prefill; a stubbed import response
  pre-fills standard answers + lists custom questions; malformed list shows.
- **E2E** (stub-gated, mirrors `kb-import-website-stub`): upload a fixture doc with prose +
  two `**Q:/**A:` blocks → standard answers pre-filled + two custom questions staged.

---

## 7. Rollout / flags

- Reuses the existing `KNOWLEDGE_IMPORT_E2E_STUB` for deterministic CI (no real OpenAI key in
  CI). No new prod env var. No migration (uses existing `tenant_docs` + `knowledge_suggestion`).
- Ships behind the normal review gate — nothing auto-publishes to callers.

---

## 8. Open items (small, decide in the plan)

- Whether to extract the `import-website` LLM-extract block into a shared helper now (clean) or
  duplicate minimally (faster) — lean **extract to a helper** so both endpoints stay in sync.
- Exact `knowledge_suggestion.source` tag values for document-standard vs document-custom (so
  the review UI can label provenance) — align with the existing scan tags.
