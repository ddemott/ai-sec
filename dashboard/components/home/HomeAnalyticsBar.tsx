'use client';

/**
 * Analytics reliability snapshot on the Home tab.
 * Shows pre-aggregated top-line numbers + recent activity feed.
 * Extracted from DashboardHome.tsx (dense-view decomposition).
 */

import React from 'react';
import type { AnalyticsStats } from '../../lib/types';

interface HomeAnalyticsBarProps {
  stats: AnalyticsStats;
}

export function HomeAnalyticsBar({ stats }: HomeAnalyticsBarProps) {
  return (
    <div
      className="mb-6 p-4 rounded-xl border"
      style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-raised)' }}
    >
      <div
        className="text-[10px] uppercase tracking-[1px] mb-2 flex items-center gap-2"
        style={{ color: 'var(--text-muted)' }}
      >
        <span>Analytics data (reliable aggregates)</span>
        <span className="text-[9px] normal-case opacity-60">
          — from voice_sessions + appointments
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm">
        <div>
          Calls this week:{' '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.calls.week}
          </span>
          <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>
            (total {stats.calls.total})
          </span>
        </div>
        <div>
          Upcoming appts:{' '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.appointments.upcoming}
          </span>
        </div>
        <div>
          New customers (7d):{' '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.customers.new_this_week}
          </span>
        </div>
        <div>
          Appts (week):{' '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.appointments.week}
          </span>
        </div>
      </div>
      {stats.recent_activity && stats.recent_activity.length > 0 && (
        <div
          className="mt-2 pt-2 border-t text-xs"
          style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
        >
          Recent:{' '}
          {stats.recent_activity.slice(0, 3).map((a, i) => (
            <span key={i}>
              {a.description}
              {i < 2 && stats.recent_activity.length > i + 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
