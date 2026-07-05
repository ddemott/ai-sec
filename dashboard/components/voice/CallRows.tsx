/**
 * Presentational rows for the Calls list — a live/active call and a history
 * call. Extracted from VoiceCallsView.tsx (dense-view decomposition). Pure
 * presentation + a select callback; no data fetching of their own beyond the
 * active row's on-open session hydrate.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { type VoiceSession, type VoiceSessionDisplay } from '@/lib/types';
import { Api } from '../../lib/api';
import { formatPhone } from '../../lib/phone';
import { showToast } from '../ui/Toast';
import { formatDuration, formatRelativeTime } from './callFormatters';
import { OutcomeBadge } from './outcome';

interface ActiveCallRowProps {
  call: VoiceSessionDisplay;
  tenantId: string | null;
  onSelect: (session: VoiceSession) => void;
}

export function ActiveCallRow({ call, tenantId, onSelect }: ActiveCallRowProps) {
  const open = () => {
    void Api.voice
      .getSession(tenantId, call.call_id)
      .then((session) => {
        onSelect(session);
      })
      .catch(() => {
        showToast('Could not open that call. Please try again.', 'error');
      });
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View live call from ${call.customer_name || formatPhone(call.caller_phone)}`}
      className="p-3 hover:brightness-110 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--success)' }}
          />
          <span className="font-medium text-[var(--text-primary)]">
            {call.customer_name || formatPhone(call.caller_phone)}
          </span>
        </div>
        <span className="text-xs text-gray-500">{formatRelativeTime(call.started_at)}</span>
      </div>
      {call.is_known_customer && (
        <span className="text-xs ml-4" style={{ color: 'var(--success)' }}>
          Returning customer
        </span>
      )}
    </div>
  );
}

interface HistoryCallRowProps {
  call: VoiceSession;
  isSelected: boolean;
  onSelect: (call: VoiceSession) => void;
}

export function HistoryCallRow({ call, isSelected, onSelect }: HistoryCallRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`View call from ${call.customer_name || call.customer_context?.customer?.name || formatPhone(call.caller_phone)}`}
      className={`p-3 hover:brightness-110 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
        isSelected ? 'border-l-2' : ''
      }`}
      style={
        isSelected
          ? { backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent)' }
          : undefined
      }
      onClick={() => onSelect(call)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(call);
        }
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-[var(--text-primary)] text-sm">
          {call.customer_name ||
            call.customer_context?.customer?.name ||
            formatPhone(call.caller_phone)}
        </span>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>{formatRelativeTime(call.started_at)}</span>
        <span>·</span>
        <span>{formatDuration(call.duration_seconds)}</span>
        {call.outcome && (
          <>
            <span>·</span>
            <OutcomeBadge outcome={call.outcome} />
          </>
        )}
      </div>
      {call.customer_context?.is_known_customer && (
        <div className="mt-1">
          <span className="text-xs" style={{ color: 'var(--accent-soft)' }}>
            {call.customer_context.appointment_history.total} appointments
          </span>
        </div>
      )}
    </div>
  );
}
