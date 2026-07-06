'use client';

/**
 * AI Receptionist status banner on the Home tab.
 * Shows active phone number or a "Configure" prompt when none is set.
 * Extracted from DashboardHome.tsx (dense-view decomposition).
 */

import React from 'react';
import { Phone, ArrowRight } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import type { Tab } from '../../app/dashboard/page';

interface HomeAiStatusProps {
  /** undefined = still loading (hidden), null = no phone configured, string = active number */
  tenantPhone: string | null | undefined;
  onNavigate?: (tab: Tab) => void;
}

export function HomeAiStatus({ tenantPhone, onNavigate }: HomeAiStatusProps) {
  if (tenantPhone === undefined) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border"
      style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-raised)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="p-2 rounded-lg shrink-0"
          style={{
            backgroundColor: tenantPhone
              ? 'color-mix(in srgb, var(--green, #22c55e) 15%, transparent)'
              : 'var(--bg-surface)',
          }}
        >
          <Phone
            className="w-4 h-4"
            style={{ color: tenantPhone ? 'var(--green, #22c55e)' : 'var(--text-muted)' }}
            aria-hidden="true"
          />
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            AI Receptionist
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {tenantPhone
              ? `Active on ${formatPhone(tenantPhone)}`
              : 'No phone number configured yet'}
          </div>
        </div>
      </div>
      {!tenantPhone && onNavigate && (
        <button
          type="button"
          onClick={() => onNavigate('ai-insights')}
          className="text-xs flex items-center gap-1 shrink-0 hover:underline"
          style={{ color: 'var(--accent-soft)' }}
        >
          Configure <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
