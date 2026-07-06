'use client';

import React from 'react';
import { Clock, Info } from 'lucide-react';

interface BufferSectionProps {
  defaultBufferMinutes: number;
  onChange: (val: number) => void;
}

export function BufferSection({ defaultBufferMinutes, onChange }: BufferSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2
          className="text-lg font-bold flex items-center"
          style={{ color: 'var(--text-primary)' }}
        >
          <Clock className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
          Buffer Between Appointments
        </h2>
        <div className="flex items-center">
          <input
            data-testid="default-buffer-minutes"
            type="number"
            min={0}
            max={120}
            step={5}
            value={defaultBufferMinutes}
            onChange={(e) => {
              // Clamp to 0–120 matching backend Zod schema; empty field → 0.
              const raw = Number.parseInt(e.target.value, 10);
              onChange(Number.isNaN(raw) ? 0 : Math.min(120, Math.max(0, raw)));
            }}
            className="w-20 p-2 border rounded-lg text-right text-base focus:ring-2 outline-none"
            style={{
              borderColor: 'var(--border-soft)',
              backgroundColor: 'var(--bg-raised)',
              color: 'var(--text-primary)',
            }}
            aria-label="Default buffer minutes between appointments"
          />
          <span className="ml-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            minutes
          </span>
        </div>
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
          A gap your AI leaves between bookings so you can gather your thoughts, take notes, or just
          breathe between appointments. With a 15-minute buffer, an 8:00–9:00 appointment means the
          next opening your AI offers is 9:15, not 9:00. Set to <strong>0</strong> to allow
          back-to-back bookings. This only affects what your AI books — you can still place
          back-to-back appointments yourself from the schedule.
        </p>
      </div>
    </section>
  );
}
