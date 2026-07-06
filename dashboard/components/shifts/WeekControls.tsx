'use client';

/**
 * Week navigation toolbar — prev/next/today arrows, copy-to-next-week button,
 * and the timeline zoom +/− control. Extracted from ShiftManagementView.tsx.
 */

import React from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, Minus } from 'lucide-react';
import { formatWeekLabel, getZoomPercent, MIN_COL_W, MAX_COL_W } from './shiftFormatters';

interface WeekControlsProps {
  weekStart: Date;
  copying: boolean;
  loadingShifts: boolean;
  colW: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onCopyToNextWeek: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function WeekControls({
  weekStart,
  copying,
  loadingShifts,
  colW,
  onPrevWeek,
  onNextWeek,
  onToday,
  onCopyToNextWeek,
  onZoomIn,
  onZoomOut,
}: WeekControlsProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrevWeek}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold min-w-[200px] text-center">
          {formatWeekLabel(weekStart)}
        </span>
        <button
          onClick={onNextWeek}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={onToday}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
        >
          Today
        </button>
        <button
          onClick={onCopyToNextWeek}
          disabled={copying || loadingShifts}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-40"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-raised)' }}
          title="Copy this week's schedule to next week"
        >
          <Copy className="w-3.5 h-3.5" />
          {copying ? 'Copying...' : 'Copy to Next Week'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-0 rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--border-soft)' }}
        >
          <button
            onClick={onZoomOut}
            disabled={colW <= MIN_COL_W}
            className="p-1.5 transition-colors disabled:opacity-30"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span
            className="text-xs font-bold px-2 select-none"
            style={{ color: 'var(--text-muted)' }}
          >
            {getZoomPercent(colW)}%
          </span>
          <button
            onClick={onZoomIn}
            disabled={colW >= MAX_COL_W}
            className="p-1.5 transition-colors disabled:opacity-30"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
