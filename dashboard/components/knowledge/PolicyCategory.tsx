'use client';

/**
 * Accordion for one policy category — collapses/expands its questions and
 * shows an answered/total badge. Extracted from KnowledgeBaseView.tsx.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '../ui/Badge';
import type { POLICY_QUESTIONS } from '../../lib/policyQuestions';
import { PolicyQuestionField } from './PolicyQuestionField';

type SavedAnswer = { id: string; answer: string; source?: string };

export function PolicyCategory({
  category,
  questions,
  savedAnswers,
  onSave,
  defaultOpen = false,
}: {
  category: string;
  questions: typeof POLICY_QUESTIONS;
  savedAnswers: Map<string, SavedAnswer>;
  onSave: (
    question: string,
    answer: string,
    existingId: string | null,
    category: string
  ) => Promise<string | null>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const answeredCount = questions.filter((q) => savedAnswers.has(q.question)).length;

  return (
    <div
      className="border rounded-xl overflow-hidden"
      style={{ borderColor: 'var(--border-soft)' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:opacity-80 transition-opacity"
        style={{ backgroundColor: 'var(--bg-raised)' }}
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {category}
          </span>
        </div>
        <Badge variant={answeredCount === questions.length ? 'success' : 'secondary'}>
          {answeredCount}/{questions.length}
        </Badge>
      </button>
      {open && (
        <div
          className="p-4 border-t"
          style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}
        >
          {questions.map((q) => {
            const saved = savedAnswers.get(q.question);
            return (
              <PolicyQuestionField
                key={q.id}
                question={q.question}
                placeholder={q.placeholder}
                savedAnswer={saved?.answer || ''}
                savedId={saved?.id || null}
                fromWebsite={saved?.source === 'website-scan'}
                onSave={(answer, existingId) => onSave(q.question, answer, existingId, q.category)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
