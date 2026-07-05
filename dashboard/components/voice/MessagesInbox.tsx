/**
 * Messages inbox — the "callers who left a message" list + reader. A
 * self-contained sub-feature (its own fetch/filter/status state); extracted
 * from VoiceCallsView.tsx (dense-view decomposition) since it is a distinct
 * concern from the calls list it used to share a file with.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Mail, MailOpen, RefreshCw, CheckCircle } from 'lucide-react';
import { type CustomerMessage } from '@/lib/types';
import { Api } from '../../lib/api';
import { formatPhone } from '../../lib/phone';

export function MessagesInbox({ tenantId }: { tenantId: string | null }) {
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
              role="button"
              tabIndex={0}
              aria-pressed={selected?.message_id === msg.message_id}
              className="p-3 cursor-pointer hover:brightness-110 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
              style={
                selected?.message_id === msg.message_id
                  ? {
                      backgroundColor: 'var(--accent-muted)',
                      borderLeft: '2px solid var(--accent)',
                    }
                  : undefined
              }
              onClick={() => void handleSelect(msg)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleSelect(msg);
                }
              }}
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
