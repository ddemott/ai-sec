'use client'

import React, { useState, useEffect } from 'react'
import { Trash2, RotateCcw, History, Copy, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { Api } from '../lib/api'
import type { DeletedRecord, DeletedRecordsResponse, VersionedTable, Customer } from '../lib/types'

interface DeletedRecordsPanelProps {
  table: VersionedTable
  tenantId: string | null
  onRecordRestored?: () => void
  onViewHistory?: (recordId: string, recordName: string) => void
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return '(invalid)'
}

export function DeletedRecordsPanel({
  table,
  tenantId,
  onRecordRestored,
  onViewHistory,
}: DeletedRecordsPanelProps) {
  const [deleted, setDeleted] = useState<DeletedRecordsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)
  const [copyModal, setCopyModal] = useState<{ sourceId: string; sourceData: Record<string, unknown> } | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedTarget, setSelectedTarget] = useState<string>('')
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    void loadDeletedRecords()
    if (table === 'customers') {
      void loadCustomers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, tenantId])

  async function loadDeletedRecords() {
    setLoading(true)
    setError(null)
    try {
      const data = await Api.versionHistory.getDeleted(tenantId, table, { limit: 100 })
      setDeleted(data)
    } catch (err) {
      setError((err as Error).message || 'Failed to load deleted records')
    } finally {
      setLoading(false)
    }
  }

  async function loadCustomers() {
    try {
      const data = await Api.customers.list(tenantId)
      setCustomers(data)
    } catch (err) {
      console.error('Failed to load customers for copy target', err)
    }
  }

  async function handleRestore(recordId: string) {
    setRestoring(recordId)
    setError(null)
    try {
      await Api.versionHistory.restoreDeleted(tenantId, table, recordId)
      await loadDeletedRecords()
      onRecordRestored?.()
    } catch (err) {
      setError((err as Error).message || 'Failed to restore record')
    } finally {
      setRestoring(null)
    }
  }

  function toggleRecord(recordId: string) {
    const next = new Set(expandedRecords)
    if (next.has(recordId)) {
      next.delete(recordId)
    } else {
      next.add(recordId)
    }
    setExpandedRecords(next)
  }

  function openCopyModal(record: DeletedRecord) {
    setCopyModal({ sourceId: record.record_id, sourceData: record.last_data || {} })
    setSelectedFields(new Set())
    setSelectedTarget('')
  }

  function toggleField(field: string) {
    const next = new Set(selectedFields)
    if (next.has(field)) {
      next.delete(field)
    } else {
      next.add(field)
    }
    setSelectedFields(next)
  }

  async function handleCopyFields() {
    if (!copyModal || !selectedTarget || selectedFields.size === 0) return

    setCopying(true)
    setError(null)
    try {
      await Api.versionHistory.copyFields(tenantId, table, {
        source_record_id: copyModal.sourceId,
        target_record_id: selectedTarget,
        fields: Array.from(selectedFields),
      })
      setCopyModal(null)
      onRecordRestored?.()
    } catch (err) {
      setError((err as Error).message || 'Failed to copy fields')
    } finally {
      setCopying(false)
    }
  }

  const filteredRecords = deleted?.records.filter(r => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      r.name?.toLowerCase().includes(term) ||
      r.phone?.toLowerCase().includes(term) ||
      r.email?.toLowerCase().includes(term)
    )
  }) || []

  const excludeFields = ['id', 'tenant_id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by']

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trash2 className="w-5 h-5" style={{ color: 'var(--danger)' }} />
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Deleted Records
            </h3>
            {deleted && (
              <span className="text-sm text-gray-500">({deleted.total} total)</span>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="mt-4 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search deleted records..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
          </div>
        ) : error ? (
          <div className="text-center py-8" style={{ color: 'var(--danger)' }}>{error}</div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Trash2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No deleted records</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecords.map(record => (
              <div
                key={record.record_id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                {/* Record header */}
                <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800">
                  <button
                    onClick={() => toggleRecord(record.record_id)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  >
                    {expandedRecords.has(record.record_id) ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>

                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {record.name || 'Unnamed'}
                    </div>
                    <div className="text-sm text-gray-500">
                      {record.phone && <span className="mr-4">{record.phone}</span>}
                      {record.email && <span>{record.email}</span>}
                    </div>
                  </div>

                  <div className="text-right text-sm">
                    <div className="text-gray-500">Deleted {formatDate(record.deleted_at)}</div>
                    <div className="text-gray-400">by {record.deleted_by || 'unknown'}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => onViewHistory?.(record.record_id, record.name || 'Record')}
                      className="p-2 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                      title="View history"
                    >
                      <History className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openCopyModal(record)}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: 'var(--accent-soft)' }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-muted)' }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = '' }}
                      title="Copy fields to another record"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRestore(record.record_id)}
                      disabled={restoring === record.record_id}
                      className="px-3 py-1.5 rounded-lg disabled:opacity-50 flex items-center gap-2 hover:brightness-110"
                      style={{ backgroundColor: 'var(--success)', color: '#ffffff' }}
                    >
                      {restoring === record.record_id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      Restore
                    </button>
                  </div>
                </div>

                {/* Expanded data */}
                {expandedRecords.has(record.record_id) && record.last_data && (
                  <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Last Known Data</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(record.last_data)
                        .filter(([key]) => !excludeFields.includes(key))
                        .map(([key, value]) => (
                          <div key={key} className="flex">
                            <span className="w-32 text-gray-500 flex-shrink-0">{key}:</span>
                            <span className="text-gray-900 dark:text-gray-100">
                              {formatFieldValue(value)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Copy Fields Modal */}
      {copyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCopyModal(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">Copy Fields to Another Record</h3>
              <button onClick={() => setCopyModal(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Target selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Copy to:
                </label>
                <select
                  value={selectedTarget}
                  onChange={e => setSelectedTarget(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                >
                  <option value="">Select a record...</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>
                      {c.name} {c.phone && `(${c.phone})`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Field selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select fields to copy:
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  {Object.entries(copyModal.sourceData)
                    .filter(([key]) => !excludeFields.includes(key))
                    .map(([key, value]) => (
                      <label key={key} className="flex items-center gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedFields.has(key)}
                          onChange={() => toggleField(key)}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-900 dark:text-white">{key}</div>
                          <div className="text-xs text-gray-500">
                            {formatFieldValue(value)}
                          </div>
                        </div>
                      </label>
                    ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setCopyModal(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCopyFields}
                disabled={!selectedTarget || selectedFields.size === 0 || copying}
                className="px-4 py-2 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--accent)' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.9' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '' }}
              >
                {copying ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy {selectedFields.size} Field{selectedFields.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
