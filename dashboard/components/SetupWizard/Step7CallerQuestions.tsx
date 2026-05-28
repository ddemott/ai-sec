'use client';

import React, { useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import { Api } from '../../lib/api';
import { POLICY_QUESTIONS } from '../../lib/policyQuestions';

const STARTER_IDS = [
  'hours-of-operation',
  'business-location',
  'service-pricing',
  'walk-ins-accepted',
  'cancellation-policy',
  'how-to-book',
  'accepted-payment-methods',
];

const STARTER_QUESTIONS = POLICY_QUESTIONS.filter((q) => STARTER_IDS.includes(q.id));

interface Props {
  tenantId: string | null;
}

export function Step7CallerQuestions({ tenantId }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

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

  const answeredCount = Object.values(answers).filter((v) => v.trim()).length;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">What will callers ask?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Answer a few common questions so your AI knows what to say. Each answer saves when you
          leave the field. Skip any you're not ready for — you can finish in the Phone Assistant tab.
        </p>
      </div>

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
                    Couldn't save
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
