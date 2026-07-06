'use client';

/**
 * Accordion for owner-authored Q&A entries (source='custom-question'). Shows
 * existing entries as deletable cards and an add-form toggled by a button.
 * Extracted from KnowledgeBaseView.tsx (dense-view decomposition).
 *
 * 2026-05-18: preset POLICY_QUESTIONS is industry-generic; owners need a place
 * to record business-specific facts the agent should know — wholesale account
 * numbers, after-hours protocol, "we don't service Teslas", etc. Entries show
 * up alongside preset answers in the RAG search (same tenant_docs table, just a
 * different source discriminator) so get_company_policy_answer returns them too.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { KnowledgeEntry } from '../../lib/types';

export function CustomQuestionsSection({
  customDocs,
  onAdd,
  onDelete,
}: {
  customDocs: KnowledgeEntry[];
  onAdd: (question: string, answer: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!newQ.trim() || !newA.trim() || saving) return;
    setSaving(true);
    try {
      const ok = await onAdd(newQ.trim(), newA.trim());
      if (ok) {
        setNewQ('');
        setNewA('');
        setShowForm(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function cancelForm() {
    setShowForm(false);
    setNewQ('');
    setNewA('');
  }

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
            Custom Questions
          </span>
        </div>
        <Badge variant="secondary">{customDocs.length}</Badge>
      </button>
      {open && (
        <div
          className="p-4 border-t space-y-3"
          style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Add business-specific Q&amp;A the AI should know — things not covered by the preset
            categories above. The agent will use these the same way it uses preset answers.
          </p>

          {/* Add form (toggled) */}
          {showForm ? (
            <Card className="p-3 space-y-2">
              <label
                className="block text-xs font-bold uppercase"
                style={{ color: 'var(--text-secondary)' }}
              >
                Question
              </label>
              <textarea
                value={newQ}
                onChange={(e) => setNewQ(e.target.value)}
                placeholder="e.g. Do you service hybrid vehicles?"
                rows={2}
                autoFocus
                className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                style={{
                  backgroundColor: 'var(--bg-raised)',
                  borderColor: 'var(--border-soft)',
                  color: 'var(--text-primary)',
                }}
              />
              <label
                className="block text-xs font-bold uppercase pt-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Answer
              </label>
              <textarea
                value={newA}
                onChange={(e) => setNewA(e.target.value)}
                placeholder="What the agent should say. Plain language; the agent reads it as-is."
                rows={4}
                className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                style={{
                  backgroundColor: 'var(--bg-raised)',
                  borderColor: 'var(--border-soft)',
                  color: 'var(--text-primary)',
                }}
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={cancelForm} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAdd}
                  disabled={!newQ.trim() || !newA.trim() || saving}
                  isLoading={saving}
                >
                  Save question
                </Button>
              </div>
            </Card>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-1" /> Add custom question
            </Button>
          )}

          {/* Existing custom questions */}
          {customDocs.length === 0 && !showForm && (
            <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
              No custom questions yet.
            </p>
          )}
          {customDocs.map((doc) => {
            // Display: strip the "Q: ... \n A: ..." formatting back into separate parts.
            // The route adds the wrapper so RAG retrieval keeps the Q+A pair together; here we want them rendered as a card.
            const m = doc.content.match(/^Q: ([\s\S]+?)\nA: ([\s\S]+)$/);
            const q = m ? m[1] : doc.title || 'Question';
            const a = m ? m[2] : doc.content;
            return (
              <Card key={doc.tenant_doc_id} className="p-3 group relative">
                <button
                  onClick={() => onDelete(doc.tenant_doc_id)}
                  className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Delete custom question"
                  title="Delete"
                >
                  <X className="w-4 h-4" />
                </button>
                <div
                  className="text-sm font-medium mb-1 pr-8"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {q}
                </div>
                <div
                  className="text-sm whitespace-pre-wrap"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {a}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
