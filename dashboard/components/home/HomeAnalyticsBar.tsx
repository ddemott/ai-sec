'use client';

/**
 * Analytics snapshot card on the Home tab.
 * Shows pre-aggregated top-line numbers + recent activity feed.
 * Extracted from DashboardHome.tsx (dense-view decomposition).
 */

import React from 'react';
import { BarChart2 } from 'lucide-react';
import { Card } from '../ui/Card';
import type { AnalyticsStats } from '../../lib/types';

interface HomeAnalyticsBarProps {
  stats: AnalyticsStats;
}

export function HomeAnalyticsBar({ stats }: HomeAnalyticsBarProps) {
  return (
    <Card>
      <h2
        className="font-semibold mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-primary)' }}
      >
        <BarChart2 className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} aria-hidden="true" />
        This Week
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>
            Calls
          </div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.calls.week}
            <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>
              of {stats.calls.total} total
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>
            Upcoming appts
          </div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.appointments.upcoming}
          </div>
        </div>
        <div>
          <div className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>
            New customers
          </div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.customers.new_this_week}
          </div>
        </div>
        <div>
          <div className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>
            Appts this week
          </div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.appointments.week}
          </div>
        </div>
      </div>
      {stats.recent_activity && stats.recent_activity.length > 0 && (
        <div
          className="mt-3 pt-3 border-t text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
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
    </Card>
  );
}
