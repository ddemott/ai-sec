'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen,
  Upload,
  Trash2,
  FileText,
  AlertCircle,
  CheckCircle2,
  Search,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Save,
  Plus,
  X,
} from 'lucide-react';
import { Api } from '../lib/api';
import { useActiveTenantId } from '../lib/SessionContext';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { POLICY_CATEGORIES, POLICY_QUESTIONS } from '../lib/policyQuestions';
import { ConfirmModal } from './ui/ConfirmModal';
import { useConfirm } from '../lib/useConfirm';
import { showToast } from './ui/Toast';
import type { KnowledgeEntry } from '../lib/types';

type Tab = 'questionnaire' | 'documents' | 'entries';

const CUSTOM_QUESTION_SOURCE = 'custom-question';

// ── Policy Question Field (auto-save) ──────────────────────

function PolicyQuestionField({
  question,
  placeholder,
  savedAnswer,
  savedId,
  onSave,
}: {
  question: string;
  placeholder: string;
  savedAnswer: string;
  savedId: string | null;
  onSave: (answer: string, existingId: string | null) => Promise<string | null>;
}) {
  const [value, setValue] = useState(savedAnswer);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Persist the timestamp of last successful save so users can see "Saved
  // 2m ago" without waiting for the 2s fade. 2026-05-28 UX audit #F3.
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(savedId);

  useEffect(() => {
    setValue(savedAnswer);
  }, [savedAnswer]);
  useEffect(() => {
    idRef.current = savedId;
  }, [savedId]);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    setStatus('idle');

    if (timerRef.current) clearTimeout(timerRef.current);
    if (newVal.trim().length < 2) return;

    timerRef.current = setTimeout(async () => {
      setStatus('saving');
      try {
        const newId = await onSave(newVal, idRef.current);
        if (newId) idRef.current = newId;
        setStatus('saved');
        setSavedAt(new Date());
        fadeTimerRef.current = setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('error');
        fadeTimerRef.current = setTimeout(() => setStatus('idle'), 4000);
      }
    }, 1500);
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {question}
      </label>
      <div className="relative">
        <textarea
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          rows={3}
          className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/30"
          style={{
            backgroundColor: 'var(--bg-raised)',
            borderColor: 'var(--border-soft)',
            color: 'var(--text-primary)',
          }}
        />
        <div className="absolute top-2 right-2">
          {status === 'saving' && (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--warning)' }} />
          )}
          {status === 'saved' && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
          {status === 'error' && (
            <span
              className="flex items-center gap-1 text-xs font-bold"
              style={{ color: 'var(--danger)' }}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Save failed — check connection
            </span>
          )}
          {status === 'idle' && savedAt && (
            <span className="flex items-center gap-1 text-xs opacity-50" style={{ color: 'var(--text-muted)' }}>
              <CheckCircle2 className="w-3 h-3" />
              Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Category Accordion ─────────────────────────────────────

function PolicyCategory({
  category,
  questions,
  savedAnswers,
  onSave,
  defaultOpen = false,
}: {
  category: string;
  questions: typeof POLICY_QUESTIONS;
  savedAnswers: Map<string, { id: string; answer: string }>;
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
                onSave={(answer, existingId) => onSave(q.question, answer, existingId, q.category)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Custom Questions section (owner-authored Q&A) ──────────
//
// 2026-05-18: the preset POLICY_QUESTIONS catalog is industry-generic.
// Owners need a place to record business-specific facts the agent
// should know — wholesale account numbers, after-hours protocol, the
// "we don't service Teslas" caveat. They show up alongside the preset
// answers in the RAG search (same `tenant_docs` table, just a
// different `source` discriminator) so the agent's
// get_company_policy_answer tool returns them as easily as anything
// else. Edit happens via the Entries tab's existing delete-and-re-add
// flow; the inline UI here optimizes for Adding (the primary action).

function CustomQuestionsSection({
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

// ── Main Component ─────────────────────────────────────────

export default function KnowledgeBaseView() {
  const tenantId = useActiveTenantId();
  const [tab, setTab] = useState<Tab>('questionnaire');
  const [docs, setDocs] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savedAnswers, setSavedAnswers] = useState<Map<string, { id: string; answer: string }>>(
    new Map()
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state: confirmState, confirm, close: closeConfirm } = useConfirm();

  const fetchDocs = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await Api.knowledge.list(tenantId);
      setDocs(data);

      // Pre-fill questionnaire from saved entries
      const answers = new Map<string, { id: string; answer: string }>();
      for (const doc of data) {
        if (doc.source === 'policy-questionnaire' && doc.title) {
          const answerMatch = doc.content.match(/^Q: .+\nA: ([\s\S]+)$/);
          const answer = answerMatch ? answerMatch[1] : doc.content;
          answers.set(doc.title, { id: doc.tenant_doc_id, answer });
        }
      }
      setSavedAnswers(answers);
    } catch (err) {
      console.error('Failed to fetch knowledge', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchDocs();
  }, [fetchDocs]);

  async function handleSaveAnswer(
    question: string,
    answer: string,
    existingId: string | null,
    category: string
  ): Promise<string | null> {
    if (!tenantId) return null;
    try {
      if (existingId) {
        await Api.knowledge.update(existingId, tenantId, { question, answer, category });
        setSavedAnswers((prev) => new Map(prev).set(question, { id: existingId, answer }));
        return existingId;
      } else {
        const res = await Api.knowledge.add(tenantId, { question, answer, category });
        if (res.success) {
          setSavedAnswers((prev) => new Map(prev).set(question, { id: res.tenant_doc_id, answer }));
          return res.tenant_doc_id;
        }
      }
    } catch (err) {
      console.error('Failed to save answer', err);
    }
    return null;
  }

  /**
   * Add an owner-authored custom Q&A. Differs from handleSaveAnswer in:
   *   - source: 'custom-question' (vs 'policy-questionnaire') so the
   *     entry shows up under the Custom Questions section, not under
   *     a preset POLICY_CATEGORIES bucket.
   *   - category: 'Custom' (catch-all label visible in the Entries tab).
   *   - on success: refetch docs so the new entry appears in the
   *     Custom Questions list — we don't have a parallel in-memory
   *     map like savedAnswers because custom entries don't pre-fill
   *     a fixed question label.
   * Returns true on success so the form can clear + close itself.
   */
  async function handleAddCustomQuestion(question: string, answer: string): Promise<boolean> {
    if (!tenantId) return false;
    try {
      const res = await Api.knowledge.add(tenantId, {
        question,
        answer,
        category: 'Custom',
        source: CUSTOM_QUESTION_SOURCE,
      });
      if (res.success) {
        await fetchDocs();
        showToast('Custom question saved', 'success');
        return true;
      }
      showToast('Failed to save custom question', 'error');
      return false;
    } catch (err) {
      console.error('Failed to add custom question', err);
      showToast('Failed to save custom question', 'error');
      return false;
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;
    setUploading(true);
    setMessage(null);
    try {
      const res = await Api.knowledge.ingest(tenantId, file);
      if (res.success) {
        setMessage({
          type: 'success',
          text: `Successfully processed ${file.name} — your AI can now answer questions from this document.`,
        });
        void fetchDocs();
      } else {
        setMessage({ type: 'error', text: res.error || 'Upload failed' });
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleDelete(id: string) {
    confirm({
      title: 'Delete Knowledge Entry',
      message: 'Delete this entry? The AI will no longer have access to this information.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        closeConfirm();
        void doDelete(id);
      },
    });
  }

  async function doDelete(id: string) {
    try {
      await Api.knowledge.delete(id, tenantId);
      setDocs(docs.filter((d) => d.tenant_doc_id !== id));
      // Also remove from savedAnswers if it was a questionnaire entry
      setSavedAnswers((prev) => {
        const next = new Map(prev);
        for (const [q, v] of next) {
          if (v.id === id) {
            next.delete(q);
            break;
          }
        }
        return next;
      });
    } catch {
      showToast('Failed to delete', 'error');
    }
  }

  const filteredDocs = docs.filter(
    (d) =>
      d.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.source?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.title?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalAnswered = savedAnswers.size;
  const totalQuestions = POLICY_QUESTIONS.length;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden p-8 transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      {/* Header */}
      <header className="mb-6 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center">
          <div className="bg-orange-100 dark:bg-orange-900/30 p-2 rounded-lg mr-4 text-orange-600 dark:text-orange-400">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">What Your AI Knows</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Teach the AI about your business so it can answer caller questions.
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-xl shrink-0"
        style={{ backgroundColor: 'var(--bg-raised)' }}
      >
        {[
          {
            key: 'questionnaire' as Tab,
            label: 'Teach Your AI',
            icon: MessageSquare,
            badge: `${totalAnswered}/${totalQuestions}`,
          },
          { key: 'documents' as Tab, label: 'Upload Documents', icon: Upload },
          {
            key: 'entries' as Tab,
            label: 'Review Everything',
            icon: FileText,
            badge: String(docs.length),
          },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? 'shadow-sm' : 'hover:opacity-70'
            }`}
            style={
              tab === t.key
                ? { backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.badge && (
              <Badge variant="secondary" className="text-xs py-0 px-1.5">
                {t.badge}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Message banner */}
      {message && (
        <div
          className={`mb-4 p-4 rounded-xl flex items-center gap-3 ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          <span className="font-medium">{message.text}</span>
          <button
            onClick={() => setMessage(null)}
            className="ml-auto text-current opacity-50 hover:opacity-100 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div
            className="flex flex-col items-center justify-center h-64 italic"
            style={{ color: 'var(--text-muted)' }}
          >
            <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-20" />
            <p>Loading knowledge base...</p>
          </div>
        ) : (
          <>
            {/* ── Questionnaire Tab ── */}
            {tab === 'questionnaire' && (
              <div className="space-y-3 max-w-3xl pb-8">
                {/* "Start here" banner for 0-entry users — gives a clear
                    entry point instead of staring at 9 collapsed rows.
                    2026-05-28 UX fix. */}
                {totalAnswered === 0 && (
                  <div
                    className="flex items-start gap-3 p-4 rounded-xl border mb-2"
                    style={{
                      backgroundColor: 'var(--accent-muted)',
                      borderColor: 'var(--accent)',
                    }}
                  >
                    <MessageSquare className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--accent-soft)' }} />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--accent-soft)' }}>
                        Start here — answer a few questions about your business
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        Your AI uses these answers to respond to callers. Each answer auto-saves as you type. Start with Business Hours below.
                      </p>
                    </div>
                  </div>
                )}
                {/* Progress bar — more motivating than the tiny tab badge */}
                {totalQuestions > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {totalAnswered} of {totalQuestions} answered
                        {totalAnswered === totalQuestions && ' — fully trained!'}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {Math.round((totalAnswered / totalQuestions) * 100)}%
                      </span>
                    </div>
                    <div className="w-full rounded-full h-1.5" style={{ backgroundColor: 'var(--bg-raised)' }}>
                      <div
                        className="h-1.5 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round((totalAnswered / totalQuestions) * 100)}%`,
                          backgroundColor: 'var(--accent-soft)',
                        }}
                      />
                    </div>
                    {totalAnswered < totalQuestions && (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        The more you fill in, the better your AI sounds to callers.
                      </p>
                    )}
                  </div>
                )}
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Answer these questions about your business. The AI will use your answers to
                  respond to callers. Answers auto-save as you type. Add business-specific Q&amp;A
                  in the Custom Questions section at the bottom.
                </p>
                {POLICY_CATEGORIES.map((cat, idx) => (
                  <PolicyCategory
                    key={cat}
                    category={cat}
                    questions={POLICY_QUESTIONS.filter((q) => q.category === cat)}
                    savedAnswers={savedAnswers}
                    onSave={handleSaveAnswer}
                    defaultOpen={idx === 0}
                  />
                ))}
                <CustomQuestionsSection
                  customDocs={docs.filter((d) => d.source === CUSTOM_QUESTION_SOURCE)}
                  onAdd={handleAddCustomQuestion}
                  onDelete={handleDelete}
                />
              </div>
            )}

            {/* ── Documents Tab ── */}
            {tab === 'documents' && (
              <div className="max-w-2xl">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".pdf,.txt,.doc,.docx,.md"
                />
                <div
                  className="flex flex-col items-center justify-center h-64 rounded-2xl border-2 border-dashed cursor-pointer hover:border-orange-400 transition-colors"
                  style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <>
                      <Loader2
                        className="w-10 h-10 animate-spin mb-4"
                        style={{ color: 'var(--warning)' }}
                      />
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        Processing document...
                      </p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 mb-4" style={{ color: 'var(--warning)' }} />
                      <p className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                        Drop a file here or click to upload
                      </p>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Supports PDF, TXT, DOC, DOCX, and Markdown files
                      </p>
                    </>
                  )}
                </div>
                <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
                  Upload your price sheet, service menu, warranty policy, or any document about
                  your business. When a caller asks a question, the AI searches your documents
                  for the answer and reads it back to them.
                </p>
              </div>
            )}

            {/* ── All Entries Tab ── */}
            {tab === 'entries' && (
              <>
                <div className="mb-4 relative max-w-md">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <Input
                    data-shortcut-target="search"
                    placeholder="Search knowledge base..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {filteredDocs.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredDocs.map((doc) => (
                      <Card
                        key={doc.tenant_doc_id}
                        className="group relative flex flex-col h-full hover:border-orange-200 dark:hover:border-orange-900/50 transition-all duration-300"
                        style={{ borderColor: 'var(--border-soft)' }}
                      >
                        <div className="p-5 flex-1 flex flex-col">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="text-xs font-bold uppercase tracking-widest flex items-center gap-1"
                                style={{ color: 'var(--warning)' }}
                              >
                                <FileText className="w-3 h-3" />
                                {doc.source === 'policy-questionnaire'
                                  ? 'Policy Q&A'
                                  : doc.source || 'Manual'}
                              </div>
                              {doc.section && (
                                <Badge variant="secondary" className="text-[9px] py-0 px-1.5">
                                  {doc.section}
                                </Badge>
                              )}
                            </div>
                            <button
                              onClick={() => handleDelete(doc.tenant_doc_id)}
                              className="opacity-40 hover:opacity-100 focus:opacity-100 p-1 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
                              style={{ color: 'var(--text-muted)' }}
                              aria-label="Delete entry"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          {doc.title && (
                            <p
                              className="text-sm font-medium mb-1"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {doc.title}
                            </p>
                          )}
                          <p
                            className="text-sm line-clamp-4 leading-relaxed"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            {doc.content}
                          </p>
                          <div className="mt-auto pt-4">
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {new Date(doc.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-center justify-center h-48 rounded-2xl border-2 border-dashed"
                    style={{
                      backgroundColor: 'var(--bg-raised)',
                      borderColor: 'var(--border-soft)',
                    }}
                  >
                    <BookOpen className="w-10 h-10 mb-3" style={{ color: 'var(--text-muted)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {searchTerm
                        ? 'No matching entries found.'
                        : 'No knowledge entries yet. Start with the questionnaire or upload a document.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      <ConfirmModal {...confirmState} onClose={closeConfirm} />
    </div>
  );
}
