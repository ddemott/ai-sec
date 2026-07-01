'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { type VoiceSession, type VoiceSessionDisplay, type CustomerMessage } from '@/lib/types';
import {
  Phone,
  PhoneIncoming,
  PhoneOff,
  User,
  Calendar,
  MessageSquare,
  RefreshCw,
  ChevronRight,
  CheckCircle,
  XCircle,
  AlertCircle,
  Filter,
  Mail,
  MailOpen,
  Trash2,
} from 'lucide-react';
import { Api } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { useActiveTenantId, useSessionContext } from '../lib/SessionContext';
import { useConfirm } from '../lib/useConfirm';
import { ConfirmModal } from './ui/ConfirmModal';
import { showToast } from './ui/Toast';
import { FolderTab, FolderTabBar } from './ui/FolderTabs';
import AnalyticsView from './AnalyticsView';
import { CommsSentView } from './CommsSentView';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
}

function getOutcomeLabel(outcome: string | null): string {
  const labels: Record<string, string> = {
    appointment_booked: 'Booked',
    appointment_rescheduled: 'Rescheduled',
    appointment_cancelled: 'Cancelled',
    info_provided: 'Info Provided',
    transferred: 'Transferred',
    voicemail: 'Voicemail',
    abandoned: 'Abandoned',
    other: 'Other',
  };
  return outcome ? labels[outcome] || outcome : 'Unknown';
}

type OutcomeStyle = { backgroundColor: string; color: string };

/**
 * Theme-token-driven outcome badge colors. Maps each outcome to the
 * semantic CSS vars defined per-theme in globals.css. Replaces the
 * earlier hardcoded `bg-green-100 text-green-800` Tailwind utilities
 * which only rendered correctly on light themes — every dark theme
 * (midnight/nord/forest/sunset/...) had unreadable badges before this.
 *
 * Mapping rationale:
 * - booked / rescheduled    → success  (positive outcome)
 * - cancelled / abandoned   → danger   (negative outcome)
 * - transferred / voicemail → warning  (procedural, needs follow-up)
 * - info_provided / other   → neutral  (uses --bg-raised + --text-secondary)
 *
 * Voicemail folds into warning instead of getting its own --info token
 * since the project doesn't define --info yet and adding it would
 * require an 8-theme override pass for a single outcome variant.
 */
function getOutcomeStyle(outcome: string | null): OutcomeStyle {
  switch (outcome) {
    case 'appointment_booked':
    case 'appointment_rescheduled':
      return { backgroundColor: 'var(--success-bg)', color: 'var(--success)' };
    case 'appointment_cancelled':
    case 'abandoned':
      return { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' };
    case 'transferred':
    case 'voicemail':
      return { backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' };
    default:
      return { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' };
  }
}

// ── Shared badge ─────────────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-xs" style={getOutcomeStyle(outcome)}>
      {getOutcomeLabel(outcome)}
    </span>
  );
}

// ── Active call row ───────────────────────────────────────────────────────────

interface ActiveCallRowProps {
  call: VoiceSessionDisplay;
  tenantId: string | null;
  onSelect: (session: VoiceSession) => void;
}

function ActiveCallRow({ call, tenantId, onSelect }: ActiveCallRowProps) {
  return (
    <div
      className="p-3 hover:brightness-110 cursor-pointer transition-colors"
      onClick={() => {
        void Api.voice.getSession(tenantId, call.call_id).then((session) => {
          onSelect(session);
        });
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

// ── History call row ──────────────────────────────────────────────────────────

interface HistoryCallRowProps {
  call: VoiceSession;
  isSelected: boolean;
  onSelect: (call: VoiceSession) => void;
}

function HistoryCallRow({ call, isSelected, onSelect }: HistoryCallRowProps) {
  return (
    <div
      className={`p-3 hover:brightness-110 cursor-pointer transition-colors ${
        isSelected ? 'border-l-2' : ''
      }`}
      style={
        isSelected
          ? { backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent)' }
          : undefined
      }
      onClick={() => onSelect(call)}
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

// ── Messages inbox ────────────────────────────────────────────────────────────

function MessagesInbox({ tenantId }: { tenantId: string | null }) {
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CustomerMessage | null>(null);
  const [filter, setFilter] = useState<'all' | 'new' | 'read' | 'actioned'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await Api.voice.listMessages(tenantId, {
        status: filter === 'all' ? undefined : filter,
      });
      setMessages(rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenantId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markStatus(msg: CustomerMessage, status: 'read' | 'actioned') {
    await Api.voice.updateMessageStatus(msg.message_id, status);
    setMessages((prev) =>
      prev.map((m) => (m.message_id === msg.message_id ? { ...m, status } : m))
    );
    if (selected?.message_id === msg.message_id) {
      setSelected({ ...msg, status });
    }
  }

  async function handleSelect(msg: CustomerMessage) {
    setSelected(msg);
    if (msg.status === 'new') {
      await markStatus(msg, 'read');
    }
  }

  const newCount = messages.filter((m) => m.status === 'new').length;

  return (
    <div className="flex h-full">
      {/* List */}
      <div
        className="w-80 border-r flex flex-col"
        style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2
              className="text-lg font-semibold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Mail className="w-5 h-5" />
              Messages
              {newCount > 0 && (
                <span
                  className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
                >
                  {newCount}
                </span>
              )}
            </h2>
            <button
              onClick={() => void load()}
              className="p-2 rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-1">
            {(['all', 'new', 'read', 'actioned'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="text-xs px-2 py-1 rounded capitalize"
                style={
                  filter === f
                    ? { backgroundColor: 'var(--accent)', color: '#fff' }
                    : { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-soft)]">
          {loading && (
            <div className="p-4 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              Loading…
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              No messages yet. When callers leave messages, they appear here.
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.message_id}
              className="p-3 cursor-pointer hover:brightness-110 transition-colors"
              style={
                selected?.message_id === msg.message_id
                  ? {
                      backgroundColor: 'var(--accent-muted)',
                      borderLeft: '2px solid var(--accent)',
                    }
                  : undefined
              }
              onClick={() => void handleSelect(msg)}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className="font-medium text-sm flex items-center gap-1.5"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {msg.status === 'new' ? (
                    <Mail className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  ) : (
                    <MailOpen className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                  )}
                  {msg.caller_name ?? 'Unknown'}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {new Date(msg.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                {msg.message}
              </p>
              {msg.callback_phone && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {formatPhone(msg.callback_phone)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--bg-base)' }}
      >
        {!selected ? (
          <div
            className="flex-1 flex items-center justify-center text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Select a message to read it
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-xl">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {selected.caller_name ?? 'Unknown caller'}
                  </h3>
                  <div className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(selected.created_at).toLocaleString()}
                  </div>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded capitalize"
                  style={
                    selected.status === 'new'
                      ? { backgroundColor: 'var(--accent)', color: '#fff' }
                      : selected.status === 'actioned'
                        ? { backgroundColor: 'var(--success)', color: '#fff' }
                        : { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }
                  }
                >
                  {selected.status}
                </span>
              </div>

              {(selected.callback_phone || selected.caller_phone) && (
                <div
                  className="mb-4 p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Contact
                  </div>
                  {selected.callback_phone && (
                    <div style={{ color: 'var(--text-primary)' }}>
                      Callback: {formatPhone(selected.callback_phone)}
                    </div>
                  )}
                  {selected.caller_phone && selected.caller_phone !== selected.callback_phone && (
                    <div style={{ color: 'var(--text-secondary)' }}>
                      Caller-ID: {formatPhone(selected.caller_phone)}
                    </div>
                  )}
                </div>
              )}

              <div
                className="p-4 rounded-lg text-sm leading-relaxed"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              >
                {selected.message}
              </div>

              {selected.status !== 'actioned' && (
                <div className="mt-4 flex gap-2">
                  {selected.status === 'new' && (
                    <button
                      onClick={() => void markStatus(selected, 'read')}
                      className="text-sm px-3 py-1.5 rounded"
                      style={{
                        backgroundColor: 'var(--bg-raised)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    onClick={() => void markStatus(selected, 'actioned')}
                    className="text-sm px-3 py-1.5 rounded flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--success)', color: '#fff' }}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Mark actioned
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

type CallsSubTab = 'calls' | 'analytics' | 'messages' | 'sent';

export default function VoiceCallsView() {
  const tenantId = useActiveTenantId();
  const [activeSubTab, setActiveSubTab] = useState<CallsSubTab>('calls');
  const [activeCalls, setActiveCalls] = useState<VoiceSessionDisplay[]>([]);
  const [callHistory, setCallHistory] = useState<VoiceSession[]>([]);
  const [selectedCall, setSelectedCall] = useState<VoiceSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  // Soft-delete controls are owner-only — call records carry caller PII.
  const { role } = useSessionContext();
  const isOwner = role === 'owner';
  const { state: confirmState, confirm: confirmAction, close: closeConfirm } = useConfirm();
  const [deleteWindowDays, setDeleteWindowDays] = useState(90);

  useEffect(() => {
    if (tenantId) {
      void fetchActiveCalls();
      void fetchCallHistory();
    }
    // Poll every 10s. Refresh active calls AND call history + the open detail
    // pane (silent) so a call that just ended/finalized updates without a manual
    // reload — fixes the stale "active / 0:00 / no transcript" view.
    const interval = setInterval(() => {
      if (tenantId) {
        void fetchActiveCalls();
        void fetchCallHistory(0, { silent: true });
      }
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function fetchActiveCalls() {
    try {
      const data = await Api.voice.getActiveCalls(tenantId);
      setActiveCalls(data.calls || []);
    } catch (err) {
      console.error('Failed to fetch active calls:', err);
      setActiveCalls([]);
    }
  }

  async function fetchCallHistory(offset = 0, opts: { silent?: boolean } = {}) {
    // silent = a background poll refresh: don't flip loading spinners or wipe
    // the list on a transient error (avoids flicker every 10s).
    if (!opts.silent) {
      if (offset === 0) setLoading(true);
      else setHistoryLoading(true);
    }

    try {
      const data = await Api.voice.getHistory(tenantId, { limit: 20, offset });
      if (offset === 0) {
        const fresh = data.calls || [];
        // A silent background poll that comes back empty is treated as transient:
        // skip the whole tick rather than wipe the list, churn the detail pane, or
        // reset total/hasMore from empty data (which would leave the UI showing
        // rows under a "Call History (0)" count).
        if (opts.silent && fresh.length === 0) return;
        if (opts.silent) {
          // Background poll: MERGE the fresh first page into the existing list so
          // we don't collapse pagination (a user who clicked "Load more" keeps
          // their older rows). Update matched rows in place; prepend brand-new
          // calls (newest-first). Dedupe by voice_session_id.
          setCallHistory((prev) => {
            if (prev.length <= fresh.length) return fresh; // not paginated → just take fresh
            // `fresh` is the authoritative newest page — the backend already
            // excludes soft-deleted rows. Take it verbatim (newest-first, with
            // in-place status/duration/transcript updates), then append only the
            // older "Load more" rows that fall BELOW the fresh window. A row that
            // sits inside the window but is missing from `fresh` was DELETED, so
            // it must not survive. The previous merge did `prev.map(... ?? c)`,
            // which kept every prev row — a call deleted from the first page
            // reappeared on the next 10s poll, reading as "delete not working"
            // (reported 2026-06-30). Compare on parsed timestamps, not raw
            // strings, so a formatting/precision difference can't misplace a row.
            const freshIds = new Set(fresh.map((c) => c.voice_session_id));
            const oldestFreshMs = Date.parse(fresh[fresh.length - 1].started_at);
            const olderRows = prev.filter(
              (c) => !freshIds.has(c.voice_session_id) && Date.parse(c.started_at) < oldestFreshMs
            );
            return [...fresh, ...olderRows];
          });
        } else {
          setCallHistory(fresh);
        }
        // Keep the open detail pane in sync with the poll: refresh the selected
        // call from its freshly-fetched row so status/duration/transcript update
        // live (a call that just finalized stops showing stale "active / 0:00").
        // Functional update avoids a stale `selectedCall` closure in the poll.
        setSelectedCall((prev) => {
          if (!prev) return fresh.length > 0 ? fresh[0] : null;
          return fresh.find((c) => c.voice_session_id === prev.voice_session_id) ?? prev;
        });
      } else {
        setCallHistory((prev) => [...prev, ...(data.calls || [])]);
      }
      setTotal(data.total || 0);
      setHasMore(data.has_more || false);
    } catch (err) {
      console.error('Failed to fetch call history:', err);
      if (!opts.silent) setCallHistory([]);
    } finally {
      if (!opts.silent) {
        setLoading(false);
        setHistoryLoading(false);
      }
    }
  }

  function handleRefresh() {
    void fetchActiveCalls();
    void fetchCallHistory();
  }

  function handleLoadMore() {
    if (!historyLoading && hasMore) {
      void fetchCallHistory(callHistory.length);
    }
  }

  // Soft-delete a single call (owner-only). Recoverable; hides it from lists +
  // analytics. Clears the detail pane if the deleted call was open.
  function handleDeleteCall(call: VoiceSession) {
    confirmAction({
      title: 'Delete this call?',
      message:
        'It will be removed from your call history and analytics. The record is kept hidden and can be restored by support if needed.',
      confirmLabel: 'Delete call',
      confirmVariant: 'danger',
      onConfirm: () => {
        void (async () => {
          try {
            await Api.voice.deleteCall(tenantId, call.voice_session_id);
            showToast('Call deleted', 'success');
            setSelectedCall((prev) =>
              prev?.voice_session_id === call.voice_session_id ? null : prev
            );
            void fetchCallHistory();
            void fetchActiveCalls();
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to delete call', 'error');
          }
        })();
      },
    });
  }

  // Bulk soft-delete finished calls older than the chosen window (owner-only).
  function handleDeleteOld() {
    confirmAction({
      title: `Delete calls older than ${deleteWindowDays} days?`,
      message:
        'All finished calls older than this will be removed from your history and analytics (active calls are kept). Records are hidden, not erased.',
      confirmLabel: 'Delete old calls',
      confirmVariant: 'danger',
      onConfirm: () => {
        void (async () => {
          try {
            const res = await Api.voice.deleteOldCalls(tenantId, deleteWindowDays);
            const n = res.result?.deleted ?? 0;
            showToast(
              n === 0 ? 'No calls were old enough to delete' : `Deleted ${n} old call(s)`,
              'success'
            );
            // The open call may have been one of the bulk-deleted rows — clear
            // the detail pane so it doesn't linger as a stale selection.
            if (n > 0) setSelectedCall(null);
            void fetchCallHistory();
            void fetchActiveCalls();
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to delete old calls', 'error');
          }
        })();
      },
    });
  }

  const customerContext = selectedCall?.customer_context;

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      <FolderTabBar size="sm" ariaLabel="Calls sections">
        <FolderTab
          label="Recent Calls"
          size="sm"
          isActive={activeSubTab === 'calls'}
          onClick={() => setActiveSubTab('calls')}
        />
        <FolderTab
          label="Analytics"
          size="sm"
          isActive={activeSubTab === 'analytics'}
          onClick={() => setActiveSubTab('analytics')}
        />
        <FolderTab
          label="Messages"
          size="sm"
          isActive={activeSubTab === 'messages'}
          onClick={() => setActiveSubTab('messages')}
        />
        <FolderTab
          label="Sent"
          size="sm"
          isActive={activeSubTab === 'sent'}
          onClick={() => setActiveSubTab('sent')}
        />
      </FolderTabBar>
      {activeSubTab === 'analytics' && (
        <div className="flex-1 overflow-y-auto">
          <AnalyticsView />
        </div>
      )}
      {activeSubTab === 'messages' && (
        <div className="flex-1 overflow-hidden">
          <MessagesInbox tenantId={tenantId} />
        </div>
      )}
      {activeSubTab === 'sent' && (
        <div className="flex-1 overflow-hidden">
          <CommsSentView tenantId={tenantId} />
        </div>
      )}
      {activeSubTab === 'calls' && (
        <div className="flex h-full">
          {/* Left Panel: Call List */}
          <div
            className="w-80 border-r flex flex-col"
            style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}
          >
            {/* Header */}
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-soft)' }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Voice Calls
                </h2>
                <button
                  onClick={handleRefresh}
                  className="p-2 rounded-lg transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Active Calls Section */}
            {activeCalls.length > 0 && (
              <div className="border-b" style={{ borderColor: 'var(--border-soft)' }}>
                <div className="px-4 py-2" style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}>
                  <h3
                    className="text-sm font-medium flex items-center gap-2"
                    style={{ color: 'var(--green, #22c55e)' }}
                  >
                    <Phone className="w-4 h-4 animate-pulse" />
                    Active Calls ({activeCalls.length})
                  </h3>
                </div>
                <div className="divide-y">
                  {activeCalls.map((call) => (
                    <ActiveCallRow
                      key={call.voice_session_id}
                      call={call}
                      tenantId={tenantId}
                      onSelect={setSelectedCall}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Call History */}
            <div className="flex-1 overflow-y-auto">
              <div
                className="px-4 py-2 sticky top-0 flex items-center justify-between gap-2"
                style={{ backgroundColor: 'var(--bg-raised)' }}
              >
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Call History ({total})
                </h3>
                <select
                  value={outcomeFilter}
                  onChange={(e) => setOutcomeFilter(e.target.value)}
                  className="text-xs border rounded px-1.5 py-1"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-soft)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="all">All outcomes</option>
                  <option value="appointment_booked">Booked</option>
                  <option value="info_provided">Info provided</option>
                  <option value="transferred">Transferred</option>
                  <option value="voicemail">Voicemail</option>
                  <option value="abandoned">Abandoned</option>
                </select>
                {isOwner && (
                  <div className="flex items-center gap-1">
                    <select
                      value={deleteWindowDays}
                      onChange={(e) => setDeleteWindowDays(Number(e.target.value))}
                      aria-label="Call deletion age window"
                      className="text-xs border rounded px-1.5 py-1"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-soft)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={180}>180 days</option>
                      <option value={365}>1 year</option>
                    </select>
                    <button
                      onClick={handleDeleteOld}
                      title={`Delete calls older than ${deleteWindowDays} days`}
                      aria-label={`Delete calls older than ${deleteWindowDays} days`}
                      className="p-1 rounded transition-colors"
                      style={{ color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                </div>
              ) : callHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <PhoneOff className="w-8 h-8 mb-2" />
                  <p className="text-sm font-medium">No call history yet</p>
                  <p
                    className="text-xs mt-1 text-center px-4"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Calls appear here once your AI phone line is active
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {(() => {
                    const filtered = callHistory.filter(
                      (c) => outcomeFilter === 'all' || c.outcome === outcomeFilter
                    );
                    if (filtered.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                          <Filter className="w-7 h-7 mb-2 opacity-40" aria-hidden="true" />
                          <p className="text-sm font-medium">No calls match this filter</p>
                          <button
                            onClick={() => setOutcomeFilter('all')}
                            className="text-xs mt-2 underline hover:no-underline"
                            style={{ color: 'var(--accent-soft)' }}
                          >
                            Clear filter
                          </button>
                        </div>
                      );
                    }
                    return filtered.map((call) => (
                      <HistoryCallRow
                        key={call.voice_session_id}
                        call={call}
                        isSelected={selectedCall?.voice_session_id === call.voice_session_id}
                        onSelect={setSelectedCall}
                      />
                    ));
                  })()}

                  {hasMore && (
                    <div className="p-3">
                      <button
                        onClick={handleLoadMore}
                        disabled={historyLoading}
                        className="w-full py-2 text-sm disabled:text-gray-400"
                        style={{ color: 'var(--accent-soft)' }}
                      >
                        {historyLoading
                          ? 'Loading...'
                          : `Load more (${callHistory.length} of ${total})`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Call Details */}
          <div
            className="flex-1 overflow-y-auto flex flex-col"
            style={{ backgroundColor: 'var(--bg-base)' }}
          >
            {selectedCall ? (
              <div className="p-6">
                {/* Call Header */}
                <div
                  className="rounded-lg shadow-sm p-6 mb-4"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                        {customerContext?.customer?.name || formatPhone(selectedCall.caller_phone)}
                      </h2>
                      <p className="text-gray-500">{formatPhone(selectedCall.caller_phone)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner && selectedCall.status !== 'active' && (
                        <button
                          onClick={() => handleDeleteCall(selectedCall)}
                          title="Delete this call"
                          aria-label="Delete this call"
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      {selectedCall.status === 'active' ? (
                        <span
                          className="px-3 py-1 rounded-full text-sm flex items-center gap-1"
                          style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}
                        >
                          <Phone className="w-4 h-4 animate-pulse" />
                          Active
                        </span>
                      ) : selectedCall.status === 'completed' ? (
                        <span
                          className="px-3 py-1 rounded-full text-sm flex items-center gap-1"
                          style={{
                            backgroundColor: 'var(--bg-raised)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <CheckCircle className="w-4 h-4" />
                          Completed
                        </span>
                      ) : (
                        <span
                          className="px-3 py-1 rounded-full text-sm flex items-center gap-1"
                          style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
                        >
                          <XCircle className="w-4 h-4" />
                          {selectedCall.status}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Started</span>
                      <p className="font-medium">
                        {new Date(selectedCall.started_at).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Duration</span>
                      <p className="font-medium">{formatDuration(selectedCall.duration_seconds)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Outcome</span>
                      <p className="font-medium">
                        <OutcomeBadge outcome={selectedCall.outcome} />
                      </p>
                    </div>
                  </div>
                </div>

                {/* Customer Context */}
                {customerContext && (
                  <div
                    className="rounded-lg shadow-sm p-6 mb-4"
                    style={{ backgroundColor: 'var(--bg-surface)' }}
                  >
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                      <User className="w-5 h-5" />
                      Customer Context
                    </h3>

                    {customerContext.is_known_customer ? (
                      <div className="space-y-4">
                        {/* Customer Info */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {customerContext.customer?.email && (
                            <div>
                              <span className="text-gray-500">Email</span>
                              <p className="font-medium">{customerContext.customer.email}</p>
                            </div>
                          )}
                          {customerContext.member_since && (
                            <div>
                              <span className="text-gray-500">Customer Since</span>
                              <p className="font-medium">
                                {new Date(customerContext.member_since).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Appointment History */}
                        <div className="border-t pt-4">
                          <h4 className="font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            Appointment History
                          </h4>
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="rounded p-3 text-center">
                              <p className="text-2xl font-bold text-[var(--text-primary)]">
                                {customerContext.appointment_history.total}
                              </p>
                              <p className="text-gray-500 text-xs">Total</p>
                            </div>
                            <div className="rounded p-3 text-center">
                              <p className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
                                {customerContext.appointment_history.completed}
                              </p>
                              <p className="text-gray-500 text-xs">Completed</p>
                            </div>
                            <div
                              className="rounded p-3 text-center"
                              style={{ backgroundColor: 'var(--danger-bg)' }}
                            >
                              <p className="text-2xl font-bold" style={{ color: 'var(--danger)' }}>
                                {customerContext.appointment_history.cancelled}
                              </p>
                              <p className="text-gray-500 text-xs">Cancelled</p>
                            </div>
                          </div>

                          {/* Upcoming Appointments */}
                          {customerContext.appointment_history.upcoming_appointments.length > 0 && (
                            <div className="mt-4">
                              <h5 className="text-sm font-medium text-gray-700 mb-2">Upcoming</h5>
                              <div className="space-y-2">
                                {customerContext.appointment_history.upcoming_appointments.map(
                                  (apt) => (
                                    <div
                                      key={apt.appointment_id}
                                      className="rounded p-2 text-sm"
                                      style={{ backgroundColor: 'var(--accent-muted)' }}
                                    >
                                      <p className="font-medium">
                                        {new Date(apt.start_time).toLocaleDateString()} at{' '}
                                        {new Date(apt.start_time).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </p>
                                      {apt.description && (
                                        <p className="text-gray-600">{apt.description}</p>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Notes */}
                        {customerContext.notes.length > 0 && (
                          <div className="border-t pt-4">
                            <h4 className="font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
                              <MessageSquare className="w-4 h-4" />
                              Notes
                            </h4>
                            <div className="space-y-2">
                              {customerContext.notes.slice(-5).map((note) => (
                                <div
                                  key={note.note_id}
                                  className="rounded p-2 text-sm"
                                  style={{ backgroundColor: 'var(--warning-bg)' }}
                                >
                                  <p>{note.text}</p>
                                  <p className="text-xs text-gray-500 mt-1">
                                    {new Date(note.created_at).toLocaleDateString()} · {note.type}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Tags */}
                        {customerContext.tags.length > 0 && (
                          <div className="border-t pt-4">
                            <h4 className="font-medium text-[var(--text-primary)] mb-2">Tags</h4>
                            <div className="flex flex-wrap gap-2">
                              {customerContext.tags.map((tag) => (
                                <span key={tag} className="px-2 py-1 rounded text-sm">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-500">
                        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                        <p>New caller - no previous history</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Transcript */}
                {selectedCall.transcript && (
                  <div
                    className="rounded-lg shadow-sm p-6 mb-4"
                    style={{ backgroundColor: 'var(--bg-surface)' }}
                  >
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                      Transcript
                    </h3>
                    <div className="rounded p-4 text-sm whitespace-pre-wrap">
                      {selectedCall.transcript}
                    </div>
                  </div>
                )}

                {/* Summary */}
                {selectedCall.summary && (
                  <div
                    className="rounded-lg shadow-sm p-6"
                    style={{ backgroundColor: 'var(--bg-surface)' }}
                  >
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                      Call Summary
                    </h3>
                    <p className="text-gray-700">{selectedCall.summary}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <PhoneIncoming className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>Select a call to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmModal {...confirmState} onClose={closeConfirm} />
    </div>
  );
}
