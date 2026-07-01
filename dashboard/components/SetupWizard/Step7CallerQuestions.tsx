'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Check } from 'lucide-react';
import { Api } from '../../lib/api';
import { POLICY_QUESTIONS } from '../../lib/policyQuestions';
import { Button } from '../ui/Button';
import { downloadExampleSheet } from './exampleSheet';

export const STARTER_IDS = [
  'hours-of-operation',
  'business-location',
  'service-pricing',
  'walk-ins-accepted',
  'cancellation-policy',
  'how-to-book',
  'accepted-payment-methods',
];

export const STARTER_QUESTIONS = POLICY_QUESTIONS.filter((q) => STARTER_IDS.includes(q.id));

interface Props {
  tenantId: string | null;
  /** Hide the website import box (used in main SetupWizard since scan is a prior dedicated step). Default true for SoloWizard and other direct uses. */
  showWebsiteImport?: boolean;
}

export function Step7CallerQuestions({ tenantId, showWebsiteImport = true }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  // Website import states (used when showWebsiteImport=true, e.g. in SoloWizard)
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // Load any pre-filled answers (e.g. from the website scan step just before this one)
  useEffect(() => {
    if (!tenantId) return;
    Api.knowledge
      .list(tenantId)
      .then((docs: any[]) => {
        const loaded: Record<string, string> = {};
        const savedLoaded: Record<string, boolean> = {};
        for (const doc of docs || []) {
          const matching = STARTER_QUESTIONS.find(
            (q) => q.question === doc.title || q.question === doc.section
          );
          if (matching && doc.content) {
            loaded[matching.id] = doc.content;
            savedLoaded[matching.id] = true;
          }
        }
        if (Object.keys(loaded).length > 0) {
          setAnswers((prev) => ({ ...prev, ...loaded }));
          setSaved((prev) => ({ ...prev, ...savedLoaded }));
        }
      })
      .catch(() => {
        // ignore load errors, start empty
      });
  }, [tenantId]);

  const handleBlur = useCallback(
    async (questionId: string, question: string, category: string) => {
      const answer = answers[questionId]?.trim();
      if (!answer || !tenantId) return;
      try {
        await Api.knowledge.add(tenantId, { question, answer, category });
        setSaved((prev) => ({ ...prev, [questionId]: true }));
        setErrors((prev) => ({ ...prev, [questionId]: false }));
      } catch {
        setErrors((prev) => ({ ...prev, [questionId]: true }));
      }
    },
    [answers, tenantId]
  );

  const handleWebsiteImport = useCallback(async () => {
    if (!importUrl || !tenantId) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const res: any = await Api.knowledge.importWebsite(tenantId, importUrl);
      if (res?.extracted && Array.isArray(res.extracted)) {
        const newAnswers: Record<string, string> = {};
        let count = 0;
        for (const item of res.extracted) {
          if (item.questionId && item.answer) {
            newAnswers[item.questionId] = item.answer;
            count++;
          }
        }
        setAnswers((prev) => ({ ...prev, ...newAnswers }));
        setImportMessage(
          `Imported ${count} suggestion${count === 1 ? '' : 's'} from your website. Edit and save as usual.`
        );
      } else {
        setImportMessage('Scan complete, but no matching suggestions were extracted.');
      }
    } catch {
      setImportMessage('Could not scan the website. You can still answer manually.');
    } finally {
      setImporting(false);
    }
  }, [importUrl, tenantId]);

  const handleDocumentUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !tenantId) return;
      setImporting(true);
      setImportMessage(null);
      try {
        const res = await Api.knowledge.importDocument(tenantId, file);
        if (res?.success) {
          const newAnswers: Record<string, string> = {};
          let filled = 0;
          for (const item of res.standard_answers || []) {
            if (item.questionId && item.answer) {
              newAnswers[item.questionId] = item.answer;
              filled++;
            }
          }
          setAnswers((prev) => ({ ...prev, ...newAnswers }));
          const customCount = res.custom_questions?.length || 0;
          const malformedCount = res.malformed?.length || 0;
          setImportMessage(
            `Imported ${filled} answer${filled === 1 ? '' : 's'} and ${customCount} custom ` +
              `question${customCount === 1 ? '' : 's'} from your document.` +
              (customCount
                ? ' The custom ones are saved for review in the Phone Assistant tab.'
                : '') +
              (malformedCount
                ? ` ${malformedCount} looked like a question but had no **A: answer — fix and re-upload.`
                : '')
          );
        } else {
          setImportMessage(res?.error || 'Could not read that file — try a PDF or a .txt.');
        }
      } catch {
        setImportMessage('Could not read that file — try a PDF or a .txt.');
      } finally {
        setImporting(false);
        e.target.value = ''; // allow re-uploading the same filename
      }
    },
    [tenantId]
  );

  const answeredCount = Object.values(answers).filter((v) => v.trim()).length;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          What will callers ask?
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Answer a few common questions so your AI knows what to say. Each answer saves when you
          leave the field. Skip any you&apos;re not ready for — you can finish in the Phone
          Assistant tab.
        </p>
      </div>

      {showWebsiteImport && (
        <div
          className="p-3 border rounded-lg"
          style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-raised)' }}
        >
          <div className="text-sm font-medium mb-1">
            Import from your website (optional, recommended)
          </div>
          <div className="flex gap-2 mb-1">
            <input
              type="url"
              placeholder="https://your-business.com"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              className="flex-1 rounded border px-2 py-1 text-sm"
              style={{
                backgroundColor: 'var(--input-bg, var(--surface))',
                borderColor: 'var(--border)',
              }}
              disabled={importing}
            />
            <Button
              onClick={handleWebsiteImport}
              disabled={!importUrl || importing}
              isLoading={importing}
              size="sm"
            >
              Scan & prefill
            </Button>
          </div>

          <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
            <div className="text-sm font-medium mb-1">…or upload a document (PDF, .txt, .md)</div>
            <input
              data-testid="kb-document-upload"
              type="file"
              accept=".pdf,.txt,.md"
              disabled={importing}
              onChange={handleDocumentUpload}
              className="block text-sm"
            />
            <p className="text-[10px] text-muted mt-1">
              We&apos;ll pull answers from the text; lines you mark <code>**Q:</code> /{' '}
              <code>**A:</code> become your own custom questions.{' '}
              <button
                type="button"
                data-testid="kb-download-example"
                onClick={downloadExampleSheet}
                className="underline hover:no-underline"
                style={{ color: 'var(--accent-soft)' }}
              >
                Download an example sheet
              </button>
              .
            </p>
          </div>

          {importMessage && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {importMessage}
            </p>
          )}
          <p className="text-[10px] text-muted mt-1">
            We&apos;ll extract answers from your site and pre-fill below. Review and edit — they
            save automatically on blur.
          </p>
        </div>
      )}

      {answeredCount > 0 && (
        <div className="text-xs font-medium" style={{ color: 'var(--accent-soft)' }}>
          {answeredCount} of {STARTER_QUESTIONS.length} answered
        </div>
      )}

      <div className="space-y-4">
        {STARTER_QUESTIONS.map((q) => {
          const inputId = `caller-q-${q.id}`;
          return (
            <div key={q.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={inputId}
                  className="text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {q.question}
                </label>
                {saved[q.id] && (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 shrink-0">
                    <Check className="w-3 h-3" /> Saved
                  </span>
                )}
                {errors[q.id] && (
                  <span className="text-xs text-red-500 dark:text-red-400 shrink-0">
                    Couldn&apos;t save
                  </span>
                )}
              </div>
              <textarea
                id={inputId}
                rows={2}
                value={answers[q.id] ?? ''}
                placeholder={q.placeholder}
                onChange={(e) => {
                  const val = e.target.value;
                  setAnswers((prev) => ({ ...prev, [q.id]: val }));
                  if (saved[q.id]) setSaved((prev) => ({ ...prev, [q.id]: false }));
                }}
                onBlur={() => void handleBlur(q.id, q.question, q.category)}
                className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 transition"
                style={{
                  backgroundColor: 'var(--input-bg, var(--surface))',
                  borderColor: errors[q.id] ? 'var(--danger)' : 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        You can add all 40 questions in Phone Assistant → Teach Your AI after setup.
      </p>
    </div>
  );
}
