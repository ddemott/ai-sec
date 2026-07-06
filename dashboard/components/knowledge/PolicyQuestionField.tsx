'use client';

/**
 * Auto-save textarea for a single policy question. Shows saving/saved/error
 * status inline. Extracted from KnowledgeBaseView.tsx (dense-view decomposition).
 */

import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Globe } from 'lucide-react';

export function PolicyQuestionField({
  question,
  placeholder,
  savedAnswer,
  savedId,
  fromWebsite = false,
  onSave,
}: {
  question: string;
  placeholder: string;
  savedAnswer: string;
  savedId: string | null;
  /** True when this saved answer was pre-filled by the website scan (source='website-scan'). */
  fromWebsite?: boolean;
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
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
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
            <span
              className="flex items-center gap-1 text-xs opacity-50"
              style={{ color: 'var(--text-muted)' }}
            >
              <CheckCircle2 className="w-3 h-3" />
              Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {/* Persistent marker for an answer loaded from the DB (answered in a
              prior session) — without this, a previously-answered question looks
              identical to a blank one, since savedAt only reflects this session.
              A website-scan-sourced answer gets a distinct "from your website"
              marker so the owner knows its provenance (vs typed by hand). */}
          {status === 'idle' && !savedAt && savedId && value.trim().length > 0 && (
            <span
              className="flex items-center gap-1 text-xs opacity-50"
              style={{ color: fromWebsite ? 'var(--accent-soft)' : 'var(--success)' }}
            >
              {fromWebsite ? <Globe className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
              {fromWebsite ? 'From your website' : 'Answered'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
