'use client';

/**
 * Mon–Sun weekly grid for single-employee tenants. Replaces the full team
 * timeline (zoom, week nav, employee picker) with a simple form that maps to
 * how a solo operator thinks: "what days do I work and what hours?"
 * Writes via expandWeekly so bookings honour the schedule immediately.
 * Extracted from ShiftManagementView.tsx (dense-view decomposition).
 *
 * 2026-05-28 P1 UX: a baker/solo stylist shouldn't need a timeline built for
 * 10-person shops.
 */

import React, { useState } from 'react';
import { Clock } from 'lucide-react';
import { Api } from '../../lib/api';
import { TimeInput } from '../ui/TimeInput';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';

const WEEK_DAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

interface DayRow {
  day_of_week: number;
  active: boolean;
  start_time: string;
  end_time: string;
}

export function SoloScheduleView({
  tenantId,
  employeeId,
  employeeName,
}: {
  tenantId: string | null;
  employeeId: string;
  employeeName: string;
}) {
  const [rows, setRows] = useState<DayRow[]>(
    WEEK_DAYS.map((d) => ({
      day_of_week: d.id,
      active: [1, 2, 3, 4, 5].includes(d.id), // Mon-Fri on by default
      start_time: '08:00',
      end_time: '17:00',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(dow: number) {
    setRows((prev) => prev.map((r) => (r.day_of_week === dow ? { ...r, active: !r.active } : r)));
    setSaved(false);
  }

  function updateTime(dow: number, field: 'start_time' | 'end_time', val: string) {
    setRows((prev) => prev.map((r) => (r.day_of_week === dow ? { ...r, [field]: val } : r)));
    setSaved(false);
  }

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);
    try {
      const pattern = rows
        .filter((r) => r.active)
        .map((r) => ({
          day_of_week: r.day_of_week,
          start_time: r.start_time,
          end_time: r.end_time,
        }));
      const res = await Api.shifts.expandWeekly(tenantId, employeeId, pattern);
      if (!res.success) {
        // apiMutate resolves {success:false} on a server 4xx/5xx (only network
        // drops throw) — without this check a rejected save would still flip
        // "Schedule saved".
        showToast(res.error || 'Failed to save schedule', 'error');
        return;
      }
      setSaved(true);
      showToast('Schedule saved', 'success');
    } catch {
      showToast('Failed to save schedule', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-8"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
          >
            <Clock className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-display">Working Days</h1>
        </div>
        <p className="text-sm ml-11" style={{ color: 'var(--text-secondary)' }}>
          {employeeName} — which days do you work and what hours?
        </p>
      </header>

      <div className="max-w-lg space-y-2 mb-6">
        {WEEK_DAYS.map(({ id, label }) => {
          const row = rows.find((r) => r.day_of_week === id)!;
          return (
            <div
              key={id}
              className="flex items-center gap-3 p-3 rounded-xl border transition-colors"
              style={{
                borderColor: row.active ? 'var(--accent)' : 'var(--border-soft)',
                backgroundColor: row.active ? 'var(--accent-muted)' : 'var(--bg-raised)',
              }}
            >
              {/* Day toggle */}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="w-12 text-sm font-bold shrink-0 text-left"
                style={{ color: row.active ? 'var(--accent-soft)' : 'var(--text-muted)' }}
                aria-label={`Toggle ${label}`}
              >
                {label}
              </button>

              {row.active ? (
                <>
                  <TimeInput
                    value={row.start_time}
                    onChange={(v) => updateTime(id, 'start_time', v)}
                    aria-label={`${label} start time`}
                  />
                  <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>
                    to
                  </span>
                  <TimeInput
                    value={row.end_time}
                    onChange={(v) => updateTime(id, 'end_time', v)}
                    aria-label={`${label} end time`}
                  />
                </>
              ) : (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Off
                </span>
              )}

              {/* Quick toggle button */}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="ml-auto text-xs px-2.5 py-1 rounded-md min-h-[36px] transition-colors"
                style={{
                  backgroundColor: row.active ? 'var(--accent)' : 'var(--bg-surface)',
                  color: row.active ? 'var(--primary-text)' : 'var(--text-muted)',
                  border: '1px solid var(--border-soft)',
                }}
              >
                {row.active ? 'Working' : 'Off'}
              </button>
            </div>
          );
        })}
      </div>

      <Button
        variant="primary"
        onClick={() => void handleSave()}
        isLoading={saving}
        disabled={saving}
      >
        {saved ? 'Saved!' : 'Save schedule'}
      </Button>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        Saves your working days for the next 4 weeks. Callers can only book during these hours.
      </p>
    </div>
  );
}
