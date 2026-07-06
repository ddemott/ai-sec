'use client';

/**
 * Card shell for a single analytics metric — icon + title + subtitle + slot
 * for metric content. Extracted from AnalyticsView.tsx (dense-view decomposition).
 */

import React from 'react';

export function MetricCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-soft)',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        {subtitle}
      </p>
      {children}
    </div>
  );
}
