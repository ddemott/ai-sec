'use client';

import React from 'react';
import { MessageSquare, Info } from 'lucide-react';

interface SystemPromptSectionProps {
  value: string;
  onChange: (val: string) => void;
}

export function SystemPromptSection({ value, onChange }: SystemPromptSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2
          className="text-lg font-bold flex items-center"
          style={{ color: 'var(--text-primary)' }}
        >
          <MessageSquare className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
          Personality &amp; Instructions
        </h2>
        <span
          className="text-xs font-medium px-2 py-1 rounded"
          style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-raised)' }}
        >
          Advanced
        </span>
      </div>
      <div
        className="border p-4 rounded-xl flex items-start"
        style={{ backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent-muted)' }}
      >
        <Info
          className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0"
          style={{ color: 'var(--accent-soft)' }}
        />
        <p className="text-sm leading-relaxed" style={{ color: 'var(--accent-soft)' }}>
          This prompt defines your AI&apos;s personality. Tell it what to say, what to avoid, and
          how to handle specific situations. The AI will follow these rules on every call.
        </p>
      </div>
      <textarea
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-4 border rounded-xl text-sm md:text-base leading-relaxed focus:ring-2 outline-none shadow-inner font-mono"
        style={{
          borderColor: 'var(--border-soft)',
          backgroundColor: 'var(--bg-raised)',
          color: 'var(--text-primary)',
        }}
        placeholder="Ex: You are a warm, professional assistant for our business. Greet callers, answer their questions, and help them book. Be concise..."
      />
    </section>
  );
}
