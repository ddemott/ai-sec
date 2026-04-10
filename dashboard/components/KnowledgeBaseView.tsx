'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  BookOpen, Upload, Trash2, FileText, AlertCircle, CheckCircle2,
  Search, Loader2, ChevronDown, ChevronRight, MessageSquare, Save
} from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId } from '../lib/SessionContext'
import { Card } from './ui/Card'
import { Input } from './ui/Input'
import { Badge } from './ui/Badge'
import { POLICY_CATEGORIES, POLICY_QUESTIONS } from '../lib/policyQuestions'
import type { KnowledgeEntry } from '../lib/types'

type Tab = 'questionnaire' | 'documents' | 'entries'

// ── Policy Question Field (auto-save) ──────────────────────

function PolicyQuestionField({
  question,
  placeholder,
  savedAnswer,
  savedId,
  onSave
}: {
  question: string
  placeholder: string
  savedAnswer: string
  savedId: string | null
  onSave: (answer: string, existingId: string | null) => Promise<string | null>
}) {
  const [value, setValue] = useState(savedAnswer)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(savedId)

  useEffect(() => { setValue(savedAnswer) }, [savedAnswer])
  useEffect(() => { idRef.current = savedId }, [savedId])
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    setValue(newVal)
    setStatus('idle')

    if (timerRef.current) clearTimeout(timerRef.current)
    if (newVal.trim().length < 10) return

    timerRef.current = setTimeout(async () => {
      setStatus('saving')
      try {
        const newId = await onSave(newVal, idRef.current)
        if (newId) idRef.current = newId
        setStatus('saved')
        fadeTimerRef.current = setTimeout(() => setStatus('idle'), 2000)
      } catch {
        setStatus('error')
        fadeTimerRef.current = setTimeout(() => setStatus('idle'), 4000)
      }
    }, 1500)
  }

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
            color: 'var(--text-primary)'
          }}
        />
        <div className="absolute top-2 right-2">
          {status === 'saving' && <Loader2 className="w-4 h-4 animate-spin text-orange-500" />}
          {status === 'saved' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
          {status === 'error' && <span className="flex items-center gap-1 text-[10px] font-bold text-red-500"><AlertCircle className="w-3.5 h-3.5" />Save failed</span>}
          {status === 'idle' && savedId && <Save className="w-3.5 h-3.5 text-gray-400 opacity-40" />}
        </div>
      </div>
    </div>
  )
}

// ── Category Accordion ─────────────────────────────────────

function PolicyCategory({
  category,
  questions,
  savedAnswers,
  onSave
}: {
  category: string
  questions: typeof POLICY_QUESTIONS
  savedAnswers: Map<string, { id: string; answer: string }>
  onSave: (question: string, answer: string, existingId: string | null, category: string) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const answeredCount = questions.filter(q => savedAnswers.has(q.question)).length

  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-soft)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:opacity-80 transition-opacity"
        style={{ backgroundColor: 'var(--bg-raised)' }}
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{category}</span>
        </div>
        <Badge variant={answeredCount === questions.length ? 'success' : 'secondary'}>
          {answeredCount}/{questions.length}
        </Badge>
      </button>
      {open && (
        <div className="p-4 border-t" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
          {questions.map(q => {
            const saved = savedAnswers.get(q.question)
            return (
              <PolicyQuestionField
                key={q.id}
                question={q.question}
                placeholder={q.placeholder}
                savedAnswer={saved?.answer || ''}
                savedId={saved?.id || null}
                onSave={(answer, existingId) => onSave(q.question, answer, existingId, q.category)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────

export default function KnowledgeBaseView() {
  const tenantId = useActiveTenantId()
  const [tab, setTab] = useState<Tab>('questionnaire')
  const [docs, setDocs] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [savedAnswers, setSavedAnswers] = useState<Map<string, { id: string; answer: string }>>(new Map())

  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDocs = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    try {
      const data = await Api.knowledge.list(tenantId)
      setDocs(data)

      // Pre-fill questionnaire from saved entries
      const answers = new Map<string, { id: string; answer: string }>()
      for (const doc of data) {
        if (doc.source === 'policy-questionnaire' && doc.title) {
          const answerMatch = doc.content.match(/^Q: .+\nA: ([\s\S]+)$/)
          const answer = answerMatch ? answerMatch[1] : doc.content
          answers.set(doc.title, { id: doc.id, answer })
        }
      }
      setSavedAnswers(answers)
    } catch (err) {
      console.error('Failed to fetch knowledge', err)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  async function handleSaveAnswer(question: string, answer: string, existingId: string | null, category: string): Promise<string | null> {
    if (!tenantId) return null
    try {
      if (existingId) {
        await Api.knowledge.update(existingId, tenantId, { question, answer, category })
        setSavedAnswers(prev => new Map(prev).set(question, { id: existingId, answer }))
        return existingId
      } else {
        const res = await Api.knowledge.add(tenantId, { question, answer, category })
        if (res.success) {
          setSavedAnswers(prev => new Map(prev).set(question, { id: res.id, answer }))
          return res.id
        }
      }
    } catch (err) {
      console.error('Failed to save answer', err)
    }
    return null
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !tenantId) return
    setUploading(true)
    setMessage(null)
    try {
      const res = await Api.knowledge.ingest(tenantId, file)
      if (res.success) {
        setMessage({ type: 'success', text: `Ingested ${res.chunksIngested} knowledge chunks from ${file.name}.` })
        fetchDocs()
      } else {
        setMessage({ type: 'error', text: res.error || 'Upload failed' })
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this knowledge entry? The AI will no longer have access to this information.')) return
    try {
      await Api.knowledge.delete(id, tenantId)
      setDocs(docs.filter(d => d.id !== id))
      // Also remove from savedAnswers if it was a questionnaire entry
      setSavedAnswers(prev => {
        const next = new Map(prev)
        for (const [q, v] of next) {
          if (v.id === id) { next.delete(q); break }
        }
        return next
      })
    } catch {
      alert('Failed to delete')
    }
  }

  const filteredDocs = docs.filter(d =>
    d.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.source?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.title?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const totalAnswered = savedAnswers.size
  const totalQuestions = POLICY_QUESTIONS.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header className="mb-6 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center">
          <div className="bg-orange-100 dark:bg-orange-900/30 p-2 rounded-lg mr-4 text-orange-600 dark:text-orange-400">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">Knowledge Base</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Teach the AI about your business so it can answer caller questions.
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl shrink-0" style={{ backgroundColor: 'var(--bg-raised)' }}>
        {([
          { key: 'questionnaire' as Tab, label: 'Policy Questionnaire', icon: MessageSquare, badge: `${totalAnswered}/${totalQuestions}` },
          { key: 'documents' as Tab, label: 'Upload Documents', icon: Upload },
          { key: 'entries' as Tab, label: 'All Entries', icon: FileText, badge: String(docs.length) },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'shadow-sm'
                : 'hover:opacity-70'
            }`}
            style={tab === t.key
              ? { backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }
              : { color: 'var(--text-secondary)' }
            }
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.badge && (
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{t.badge}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* Message banner */}
      {message && (
        <div className={`mb-4 p-4 rounded-xl flex items-center gap-3 ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-medium">{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-auto text-current opacity-50 hover:opacity-100 font-bold">×</button>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 italic">
            <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-20" />
            <p>Loading knowledge base...</p>
          </div>
        ) : (
          <>
            {/* ── Questionnaire Tab ── */}
            {tab === 'questionnaire' && (
              <div className="space-y-3 max-w-3xl">
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Answer these questions about your business. The AI will use your answers to respond to callers.
                  Answers auto-save as you type.
                </p>
                {POLICY_CATEGORIES.map(cat => (
                  <PolicyCategory
                    key={cat}
                    category={cat}
                    questions={POLICY_QUESTIONS.filter(q => q.category === cat)}
                    savedAnswers={savedAnswers}
                    onSave={handleSaveAnswer}
                  />
                ))}
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
                      <Loader2 className="w-10 h-10 animate-spin text-orange-500 mb-4" />
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Processing document...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-orange-500 mb-4" />
                      <p className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Drop a file here or click to upload</p>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Supports PDF, TXT, DOC, DOCX, and Markdown files
                      </p>
                    </>
                  )}
                </div>
                <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
                  Upload your employee handbook, warranty policy, price sheet, or any document you want the AI to reference.
                  Documents are split into chunks and embedded for semantic search.
                </p>
              </div>
            )}

            {/* ── All Entries Tab ── */}
            {tab === 'entries' && (
              <>
                <div className="mb-4 relative max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search knowledge base..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {filteredDocs.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredDocs.map(doc => (
                      <Card key={doc.id} className="group relative flex flex-col h-full hover:border-orange-200 dark:hover:border-orange-900/50 transition-all duration-300" style={{ borderColor: 'var(--border-soft)' }}>
                        <div className="p-5 flex-1 flex flex-col">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="text-[10px] font-bold text-orange-500 uppercase tracking-widest flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                {doc.source === 'policy-questionnaire' ? 'Policy Q&A' : doc.source || 'Manual'}
                              </div>
                              {doc.section && (
                                <Badge variant="secondary" className="text-[9px] py-0 px-1.5">{doc.section}</Badge>
                              )}
                            </div>
                            <button
                              onClick={() => handleDelete(doc.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          {doc.title && (
                            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{doc.title}</p>
                          )}
                          <p className="text-sm line-clamp-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {doc.content}
                          </p>
                          <div className="mt-auto pt-4">
                            <span className="text-[10px] text-gray-400">{new Date(doc.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 rounded-2xl border-2 border-dashed" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
                    <BookOpen className="w-10 h-10 text-gray-300 dark:text-gray-700 mb-3" />
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {searchTerm ? 'No matching entries found.' : 'No knowledge entries yet. Start with the questionnaire or upload a document.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
