'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  History,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Check,
  Clock,
  RefreshCw,
  Trash2,
  Plus,
  Edit,
  Merge,
} from 'lucide-react';
import { Api } from '../lib/api';
import type {
  RecordHistoryResponse,
  VersionedTable,
  ChangeType,
  ChangeSource,
  RecordRestorePreview,
} from '../lib/types';
import { excludedSystemFields } from '../../shared/versionHistoryFields';

interface RecordHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: VersionedTable;
  recordId: string;
  recordName?: string;
  tenantId: string | null;
  onRestored?: () => void; // Callback when a restore is performed
}

// Format helpers
function formatChangeSource(source: ChangeSource): string {
  const labels: Record<ChangeSource, string> = {
    local: 'Manual Edit',
    square: 'Square Sync',
    voice_call: 'Voice Call',
    system: 'System',
    api: 'API',
  };
  return labels[source] || source;
}

function formatChangeType(type: ChangeType): string {
  const labels: Record<ChangeType, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    restore: 'Restored',
    sync: 'Synced',
    merge: 'Merged',
  };
  return labels[type] || type;
}

function getChangeTypeIcon(type: ChangeType) {
  const icons: Record<ChangeType, React.ReactNode> = {
    create: <Plus className="w-3 h-3" />,
    update: <Edit className="w-3 h-3" />,
    delete: <Trash2 className="w-3 h-3" />,
    restore: <RotateCcw className="w-3 h-3" />,
    sync: <RefreshCw className="w-3 h-3" />,
    merge: <Merge className="w-3 h-3" />,
  };
  return icons[type] || <Clock className="w-3 h-3" />;
}

type ChangeTypeStyle = { backgroundColor: string; color: string };

/**
 * Theme-token-driven change-type badge colors. Each ChangeType maps to
 * a semantic CSS var defined per-theme in globals.css so the badge
 * reads correctly on every theme. Mapping rationale:
 * - create → success (new thing added)
 * - update → accent  (informational, neutral)
 * - delete → danger  (destructive)
 * - restore → success (undo of destructive — "back to good state")
 * - sync   → warning (procedural, system-initiated)
 * - merge  → accent  (informational)
 */
function getChangeTypeStyle(type: ChangeType): ChangeTypeStyle {
  switch (type) {
    case 'create':
    case 'restore':
      return { backgroundColor: 'var(--success-bg)', color: 'var(--success)' };
    case 'update':
    case 'merge':
      return { backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' };
    case 'delete':
      return { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' };
    case 'sync':
      return { backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' };
    default:
      return { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' };
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else if (days === 1) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') {
    return value.length > 100 ? value.substring(0, 100) + '...' : value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    const str = String(value);
    return str.length > 100 ? str.substring(0, 100) + '...' : str;
  }
  return '(invalid)';
}

export function RecordHistoryModal({
  isOpen,
  onClose,
  table,
  recordId,
  recordName,
  tenantId,
  onRestored,
}: RecordHistoryModalProps) {
  const [history, setHistory] = useState<RecordHistoryResponse | null>(null);
  const [restorePreview, setRestorePreview] = useState<RecordRestorePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<'history' | 'restore'>('history');
  const [selectedFields, setSelectedFields] = useState<Record<string, number>>({}); // field -> version_number
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (isOpen && recordId) {
      void loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, recordId, table, tenantId]);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const data = await Api.versionHistory.getHistory(tenantId, table, recordId);
      setHistory(data);
    } catch (err) {
      setError((err as Error).message || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }

  async function loadRestorePreview() {
    setLoading(true);
    setError(null);
    try {
      const data = await Api.versionHistory.getRestorePreview(tenantId, table, recordId);
      setRestorePreview(data);
      setMode('restore');
      // Initialize selected fields to current version
      const initial: Record<string, number> = {};
      data.fields.forEach((f) => {
        if (f.versions.length > 0) {
          initial[f.field] = f.versions[0].version_number;
        }
      });
      setSelectedFields(initial);
    } catch (err) {
      setError((err as Error).message || 'Failed to load restore preview');
    } finally {
      setLoading(false);
    }
  }

  function toggleVersion(versionNumber: number) {
    const next = new Set(expandedVersions);
    if (next.has(versionNumber)) {
      next.delete(versionNumber);
    } else {
      next.add(versionNumber);
    }
    setExpandedVersions(next);
  }

  function selectFieldVersion(field: string, versionNumber: number) {
    setSelectedFields((prev) => ({ ...prev, [field]: versionNumber }));
  }

  async function handleRestore() {
    if (!history || !restorePreview) return;

    // Find fields that are being restored from non-current versions
    const currentVersion = history.current_version;
    const fieldsToRestore: { field: string; sourceVersion: number }[] = [];

    for (const [field, version] of Object.entries(selectedFields)) {
      if (version !== currentVersion) {
        fieldsToRestore.push({ field, sourceVersion: version });
      }
    }

    if (fieldsToRestore.length === 0) {
      setError('No fields selected for restoration');
      return;
    }

    // Group by source version
    const byVersion: Record<number, string[]> = {};
    fieldsToRestore.forEach(({ field, sourceVersion }) => {
      if (!byVersion[sourceVersion]) byVersion[sourceVersion] = [];
      byVersion[sourceVersion].push(field);
    });

    setRestoring(true);
    setError(null);

    try {
      // Restore from each version
      for (const [versionStr, fields] of Object.entries(byVersion)) {
        await Api.versionHistory.restoreFields(tenantId, table, recordId, {
          source_version: parseInt(versionStr),
          fields,
        });
      }

      // Reload history and go back to history view
      await loadHistory();
      setMode('history');
      setRestorePreview(null);
      onRestored?.();
    } catch (err) {
      setError((err as Error).message || 'Failed to restore fields');
    } finally {
      setRestoring(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5" style={{ color: 'var(--accent-soft)' }} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {mode === 'history' ? 'Version History' : 'Restore Fields'}
              </h2>
              <p className="text-sm text-gray-500">{recordName || recordId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div
                className="animate-spin rounded-full h-8 w-8 border-b-2"
                style={{ borderColor: 'var(--accent)' }}
              />
            </div>
          ) : error ? (
            <div className="text-center py-8" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          ) : mode === 'history' && history ? (
            <div className="space-y-4">
              {/* Deleted banner */}
              {history.is_deleted && (
                <div
                  className="rounded-lg p-4 flex items-center justify-between"
                  style={{ backgroundColor: 'var(--danger-bg)', border: '1px solid var(--danger)' }}
                >
                  <div>
                    <p className="font-medium" style={{ color: 'var(--danger)' }}>
                      This record is deleted
                    </p>
                    <p className="text-sm" style={{ color: 'var(--danger)' }}>
                      Deleted {history.deleted_at ? formatDate(history.deleted_at) : 'unknown'} by{' '}
                      {history.deleted_by || 'unknown'}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await Api.versionHistory.restoreDeleted(tenantId, table, recordId);
                        await loadHistory();
                        onRestored?.();
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                    className="px-4 py-2 rounded-lg flex items-center gap-2 hover:brightness-110"
                    style={{ backgroundColor: 'var(--danger)', color: '#ffffff' }}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Restore Record
                  </button>
                </div>
              )}

              {/* Action buttons */}
              {!history.is_deleted && history.versions.length > 1 && (
                <div className="flex justify-end">
                  <button
                    onClick={loadRestorePreview}
                    className="px-4 py-2 text-white rounded-lg flex items-center gap-2"
                    style={{ backgroundColor: 'var(--accent)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.9';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '';
                    }}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Restore Fields from History
                  </button>
                </div>
              )}

              {/* Version timeline */}
              <div className="space-y-3">
                {history.versions.map((version, idx) => (
                  <div key={version.record_version_id} className="relative">
                    {/* Timeline line */}
                    {idx < history.versions.length - 1 && (
                      <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />
                    )}

                    <div className="flex gap-4">
                      {/* Icon */}
                      <div
                        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                        style={getChangeTypeStyle(version.change_type)}
                      >
                        {getChangeTypeIcon(version.change_type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-white">
                                v{version.version_number} - {formatChangeType(version.change_type)}
                              </span>
                              <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400">
                                {formatChangeSource(version.change_source)}
                              </span>
                              {idx === 0 && (
                                <span
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{
                                    backgroundColor: 'var(--success-bg)',
                                    color: 'var(--success)',
                                  }}
                                >
                                  Current
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                              {formatDate(version.changed_at)}
                              {version.changed_by && ` by ${version.changed_by}`}
                            </p>
                            {version.change_summary && (
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                                {version.change_summary}
                              </p>
                            )}
                          </div>

                          <button
                            onClick={() => toggleVersion(version.version_number)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                          >
                            {expandedVersions.has(version.version_number) ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        </div>

                        {/* Expanded details */}
                        {expandedVersions.has(version.version_number) && (
                          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                              Record Data
                            </h4>
                            <div className="space-y-1 text-sm">
                              {Object.entries(version.data)
                                .filter(([key]) => !excludedSystemFields(table).has(key))
                                .map(([key, value]) => (
                                  <div key={key} className="flex">
                                    <span className="w-32 text-gray-500 flex-shrink-0">{key}:</span>
                                    <span
                                      className={`text-gray-900 dark:text-gray-100 ${version.changed_fields?.includes(key) ? 'bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded' : ''}`}
                                    >
                                      {formatValue(value)}
                                    </span>
                                  </div>
                                ))}
                            </div>

                            {version.previous_values &&
                              Object.keys(version.previous_values).length > 0 && (
                                <div className="mt-4">
                                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                    Previous Values
                                  </h4>
                                  <div className="space-y-1 text-sm">
                                    {Object.entries(version.previous_values).map(([key, value]) => (
                                      <div key={key} className="flex">
                                        <span className="w-32 text-gray-500 flex-shrink-0">
                                          {key}:
                                        </span>
                                        <span
                                          className="line-through"
                                          style={{ color: 'var(--danger)' }}
                                        >
                                          {formatValue(value)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {history.versions.length === 0 && (
                <p className="text-center text-gray-500 py-8">No version history available</p>
              )}
            </div>
          ) : mode === 'restore' && restorePreview ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Select which version to use for each field. Fields with a different version selected
                will be restored.
              </p>

              <div className="space-y-4">
                {restorePreview.fields.map((fieldOption) => (
                  <div
                    key={fieldOption.field}
                    className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {fieldOption.field}
                      </span>
                      <span className="text-sm text-gray-500">
                        Current: {formatValue(fieldOption.current_value)}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {fieldOption.versions.map((v, idx) => (
                        <label
                          key={v.version_number}
                          className={`flex items-center gap-3 p-2 rounded cursor-pointer ${
                            selectedFields[fieldOption.field] === v.version_number
                              ? 'border'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                          style={
                            selectedFields[fieldOption.field] === v.version_number
                              ? {
                                  backgroundColor: 'var(--accent-muted)',
                                  borderColor: 'var(--accent-soft)',
                                }
                              : undefined
                          }
                        >
                          <input
                            type="radio"
                            name={`field-${fieldOption.field}`}
                            checked={selectedFields[fieldOption.field] === v.version_number}
                            onChange={() => selectFieldVersion(fieldOption.field, v.version_number)}
                            style={{ accentColor: 'var(--accent)' }}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">v{v.version_number}</span>
                              {idx === 0 && (
                                <span
                                  className="text-xs px-1.5 py-0.5 rounded"
                                  style={{
                                    backgroundColor: 'var(--success-bg)',
                                    color: 'var(--success)',
                                  }}
                                >
                                  Current
                                </span>
                              )}
                              <span className="text-xs text-gray-500">
                                {formatChangeSource(v.change_source)}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              {formatValue(v.value)}
                            </div>
                          </div>
                          <span className="text-xs text-gray-400">{formatDate(v.changed_at)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          {mode === 'restore' ? (
            <>
              <button
                onClick={() => {
                  setMode('history');
                  setRestorePreview(null);
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                Back to History
              </button>
              <button
                onClick={handleRestore}
                disabled={restoring}
                className="px-4 py-2 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--accent)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '';
                }}
              >
                {restoring ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Apply Changes
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={loadHistory}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
