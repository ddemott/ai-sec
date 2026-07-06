'use client';

import React from 'react';
import { ShieldAlert, Mic, MessageSquare, RefreshCw } from 'lucide-react';
import { Input } from '../ui/Input';
import type { TenantFull } from '../../lib/types';

type Tenant = TenantFull;

interface TenantCoreAttributesSectionProps {
  selectedTenant: Tenant;
  form: Tenant;
  isEditing: boolean;
  onFormChange: (form: Tenant) => void;
}

export function TenantCoreAttributesSection({
  selectedTenant,
  form,
  isEditing,
  onFormChange,
}: TenantCoreAttributesSectionProps) {
  return (
    <section className="space-y-6">
      <div
        className="flex items-center space-x-2 border-b pb-2"
        style={{ color: 'var(--text-primary)', borderColor: 'var(--border-soft)' }}
      >
        <ShieldAlert className="w-5 h-5" style={{ color: 'var(--warning)' }} />
        <h2 className="text-lg font-bold tracking-tight">Secretary HQ Core Attributes</h2>
      </div>

      <div className="space-y-6">
        {/* Voice — a dropdown of valid OpenAI TTS voices (writes tts_voice).
            Replaces the old free-text "Voice ID" (voice_id) which the agent
            ignored — a typo silently did nothing. */}
        {isEditing ? (
          <div className="space-y-1">
            <label
              className="text-xs font-bold uppercase ml-1 flex items-center"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Mic className="w-3 h-3 mr-1" /> Voice
            </label>
            <select
              value={form.tts_voice || ''}
              onChange={(e) => onFormChange({ ...form, tts_voice: e.target.value || null })}
              className="w-full p-3 rounded-xl border text-sm"
              style={{
                backgroundColor: 'var(--bg-raised)',
                color: 'var(--text-primary)',
                borderColor: 'var(--border-soft)',
              }}
              aria-label="Voice"
            >
              <option value="">Default (Shimmer)</option>
              <option value="shimmer">Shimmer — Female (warm, calm)</option>
              <option value="nova">Nova — Female (bright, upbeat)</option>
              <option value="alloy">Alloy — Neutral</option>
              <option value="echo">Echo — Male (clear, steady)</option>
              <option value="onyx">Onyx — Male (deep)</option>
              <option value="fable">Fable — Expressive</option>
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <label
              className="text-xs font-bold uppercase ml-1 flex items-center"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Mic className="w-3 h-3 mr-1" /> Voice
            </label>
            <p
              className="p-3 rounded-xl text-xs border"
              style={{
                backgroundColor: 'var(--bg-raised)',
                color: 'var(--text-secondary)',
                borderColor: 'var(--border-soft)',
              }}
            >
              {selectedTenant.tts_voice || 'Default (Shimmer)'}
            </p>
          </div>
        )}

        {isEditing ? (
          <Input
            label="First Message (Greeting)"
            value={form.first_message || ''}
            onChange={(e) => onFormChange({ ...form, first_message: e.target.value })}
          />
        ) : (
          <div className="space-y-1">
            <label
              className="text-xs font-bold uppercase ml-1 flex items-center"
              style={{ color: 'var(--text-secondary)' }}
            >
              <MessageSquare className="w-3 h-3 mr-1" /> First Message (Greeting)
            </label>
            <p
              className="p-3 rounded-xl italic border-l-4 leading-relaxed"
              style={{
                backgroundColor: 'var(--bg-raised)',
                color: 'var(--text-primary)',
                borderLeftColor: 'var(--accent)',
              }}
            >
              &quot;{selectedTenant.first_message || 'No greeting set'}&quot;
            </p>
          </div>
        )}

        <div className="space-y-1">
          <label
            className="text-xs font-bold uppercase ml-1 flex items-center"
            style={{ color: 'var(--text-secondary)' }}
          >
            <RefreshCw className="w-3 h-3 mr-1" /> System Prompt (Brain)
          </label>
          {isEditing ? (
            <textarea
              rows={10}
              value={form.system_prompt || ''}
              onChange={(e) => onFormChange({ ...form, system_prompt: e.target.value })}
              className="w-full p-4 border rounded-xl outline-none focus:ring-2 text-sm font-mono shadow-inner transition"
              style={{
                backgroundColor: 'var(--bg-raised)',
                borderColor: 'var(--border-soft)',
                color: 'var(--text-primary)',
              }}
            />
          ) : (
            <div
              className="p-4 rounded-xl text-sm leading-relaxed font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border"
              style={{
                backgroundColor: 'var(--bg-raised)',
                color: 'var(--text-secondary)',
                borderColor: 'var(--border-soft)',
              }}
            >
              {selectedTenant.system_prompt || 'No prompt configured.'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
