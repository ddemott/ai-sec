'use client'

import React, { useEffect, useState } from 'react'
import { VoiceSession, VoiceSessionDisplay } from '@/lib/types'
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
} from 'lucide-react'
import { Api } from '../lib/api'
import { formatPhone } from '../lib/phone'
import { useActiveTenantId } from '../lib/SessionContext'

function formatDuration(seconds: number | null): string {
  if (!seconds) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
  return date.toLocaleDateString()
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
  }
  return outcome ? labels[outcome] || outcome : 'Unknown'
}

function getOutcomeColor(outcome: string | null): string {
  const colors: Record<string, string> = {
    appointment_booked: 'bg-green-100 text-green-800',
    appointment_rescheduled: 'bg-sky-100 text-sky-800',
    appointment_cancelled: 'bg-red-100 text-red-800',
    info_provided: 'bg-gray-100 text-gray-800',
    transferred: 'bg-yellow-100 text-yellow-800',
    voicemail: 'bg-purple-100 text-purple-800',
    abandoned: 'bg-red-100 text-red-800',
    other: 'bg-gray-100 text-gray-800',
  }
  return outcome ? colors[outcome] || 'bg-gray-100 text-gray-800' : 'bg-gray-100 text-gray-800'
}

export default function VoiceCallsView() {
  const tenantId = useActiveTenantId()
  const [activeCalls, setActiveCalls] = useState<VoiceSessionDisplay[]>([])
  const [callHistory, setCallHistory] = useState<VoiceSession[]>([])
  const [selectedCall, setSelectedCall] = useState<VoiceSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all')

  useEffect(() => {
    if (tenantId) {
      fetchActiveCalls()
      fetchCallHistory()
    }
    // Set up polling for active calls
    const interval = setInterval(() => {
      if (tenantId) fetchActiveCalls()
    }, 10000) // Poll every 10 seconds
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function fetchActiveCalls() {
    try {
      const data = await Api.voice.getActiveCalls(tenantId)
      setActiveCalls(data.calls || [])
    } catch (err) {
      console.error('Failed to fetch active calls:', err)
      setActiveCalls([])
    }
  }

  async function fetchCallHistory(offset = 0) {
    if (offset === 0) setLoading(true)
    else setHistoryLoading(true)

    try {
      const data = await Api.voice.getHistory(tenantId, { limit: 20, offset })
      if (offset === 0) {
        setCallHistory(data.calls || [])
        if (!selectedCall && data.calls?.length > 0) {
          setSelectedCall(data.calls[0])
        }
      } else {
        setCallHistory(prev => [...prev, ...(data.calls || [])])
      }
      setTotal(data.total || 0)
      setHasMore(data.has_more || false)
    } catch (err) {
      console.error('Failed to fetch call history:', err)
      setCallHistory([])
    } finally {
      setLoading(false)
      setHistoryLoading(false)
    }
  }

  function handleRefresh() {
    fetchActiveCalls()
    fetchCallHistory()
  }

  function handleLoadMore() {
    if (!historyLoading && hasMore) {
      fetchCallHistory(callHistory.length)
    }
  }

  const customerContext = selectedCall?.customer_context

  return (
    <div className="flex h-full">
      {/* Left Panel: Call List */}
      <div className="w-80 border-r flex flex-col" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
        {/* Header */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Voice Calls</h2>
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
              <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--green, #22c55e)' }}>
                <Phone className="w-4 h-4 animate-pulse" />
                Active Calls ({activeCalls.length})
              </h3>
            </div>
            <div className="divide-y">
              {activeCalls.map(call => (
                <div
                  key={call.voice_session_id}
                  className="p-3 hover:brightness-110 cursor-pointer transition-colors"
                  onClick={() => {
                    // Fetch full session details
                    Api.voice.getSession(tenantId, call.call_id).then(session => {
                      setSelectedCall(session)
                    })
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="font-medium text-[var(--text-primary)]">
                        {call.customer_name || formatPhone(call.caller_phone)}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatRelativeTime(call.started_at)}
                    </span>
                  </div>
                  {call.is_known_customer && (
                    <span className="text-xs text-green-600 ml-4">Returning customer</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Call History */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 sticky top-0 flex items-center justify-between gap-2" style={{ backgroundColor: 'var(--bg-raised)' }}>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Call History ({total})
            </h3>
            <select
              value={outcomeFilter}
              onChange={e => setOutcomeFilter(e.target.value)}
              className="text-xs border rounded px-1.5 py-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
            >
              <option value="all">All outcomes</option>
              <option value="appointment_booked">Booked</option>
              <option value="info_provided">Info provided</option>
              <option value="transferred">Transferred</option>
              <option value="voicemail">Voicemail</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : callHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <PhoneOff className="w-8 h-8 mb-2" />
              <p className="text-sm">No call history</p>
            </div>
          ) : (
            <div className="divide-y">
              {callHistory.filter(c => outcomeFilter === 'all' || c.outcome === outcomeFilter).map(call => (
                <div
                  key={call.voice_session_id}
                  className={`p-3 hover:brightness-110 cursor-pointer transition-colors ${
                    selectedCall?.voice_session_id === call.voice_session_id ? 'border-l-2' : ''
                  }`}
                  style={selectedCall?.voice_session_id === call.voice_session_id ? { backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent)' } : undefined}
                  onClick={() => setSelectedCall(call)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-[var(--text-primary)] text-sm">
                      {call.customer_name || call.customer_context?.customer?.name || formatPhone(call.caller_phone)}
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
                        <span className={`px-1.5 py-0.5 rounded text-xs ${getOutcomeColor(call.outcome)}`}>
                          {getOutcomeLabel(call.outcome)}
                        </span>
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
              ))}

              {hasMore && (
                <div className="p-3">
                  <button
                    onClick={handleLoadMore}
                    disabled={historyLoading}
                    className="w-full py-2 text-sm disabled:text-gray-400"
                    style={{ color: 'var(--accent-soft)' }}
                  >
                    {historyLoading ? 'Loading...' : `Load more (${callHistory.length} of ${total})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Call Details */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-base)' }}>
        {selectedCall ? (
          <div className="p-6">
            {/* Call Header */}
            <div className="rounded-lg shadow-sm p-6 mb-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                    {customerContext?.customer?.name || formatPhone(selectedCall.caller_phone)}
                  </h2>
                  <p className="text-gray-500">{formatPhone(selectedCall.caller_phone)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCall.status === 'active' ? (
                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm flex items-center gap-1">
                      <Phone className="w-4 h-4 animate-pulse" />
                      Active
                    </span>
                  ) : selectedCall.status === 'completed' ? (
                    <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      Completed
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm flex items-center gap-1">
                      <XCircle className="w-4 h-4" />
                      {selectedCall.status}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Started</span>
                  <p className="font-medium">{new Date(selectedCall.started_at).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-gray-500">Duration</span>
                  <p className="font-medium">{formatDuration(selectedCall.duration_seconds)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Outcome</span>
                  <p className="font-medium">
                    <span className={`px-2 py-1 rounded ${getOutcomeColor(selectedCall.outcome)}`}>
                      {getOutcomeLabel(selectedCall.outcome)}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Customer Context */}
            {customerContext && (
              <div className="rounded-lg shadow-sm p-6 mb-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
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
                          <p className="font-medium">{new Date(customerContext.member_since).toLocaleDateString()}</p>
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
                          <p className="text-2xl font-bold text-[var(--text-primary)]">{customerContext.appointment_history.total}</p>
                          <p className="text-gray-500 text-xs">Total</p>
                        </div>
                        <div className="rounded p-3 text-center">
                          <p className="text-2xl font-bold text-green-700">{customerContext.appointment_history.completed}</p>
                          <p className="text-gray-500 text-xs">Completed</p>
                        </div>
                        <div className="bg-red-50 rounded p-3 text-center">
                          <p className="text-2xl font-bold text-red-700">{customerContext.appointment_history.cancelled}</p>
                          <p className="text-gray-500 text-xs">Cancelled</p>
                        </div>
                      </div>

                      {/* Upcoming Appointments */}
                      {customerContext.appointment_history.upcoming_appointments.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">Upcoming</h5>
                          <div className="space-y-2">
                            {customerContext.appointment_history.upcoming_appointments.map(apt => (
                              <div key={apt.id} className="rounded p-2 text-sm" style={{ backgroundColor: 'var(--accent-muted)' }}>
                                <p className="font-medium">
                                  {new Date(apt.start_time).toLocaleDateString()} at{' '}
                                  {new Date(apt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                                {apt.description && <p className="text-gray-600">{apt.description}</p>}
                              </div>
                            ))}
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
                          {customerContext.notes.slice(-5).map(note => (
                            <div key={note.id} className="bg-yellow-50 rounded p-2 text-sm">
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
                          {customerContext.tags.map(tag => (
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
              <div className="rounded-lg shadow-sm p-6 mb-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Transcript</h3>
                <div className="rounded p-4 text-sm whitespace-pre-wrap">
                  {selectedCall.transcript}
                </div>
              </div>
            )}

            {/* Summary */}
            {selectedCall.summary && (
              <div className="rounded-lg shadow-sm p-6" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Call Summary</h3>
                <p className="text-gray-700">{selectedCall.summary}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <PhoneIncoming className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>Select a call to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
