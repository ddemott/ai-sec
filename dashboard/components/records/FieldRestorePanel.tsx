'use client';

import React from 'react';
import type { RecordRestorePreview } from '../../lib/types';
import { formatValue, formatChangeSource, formatDate } from './recordHistoryHelpers';

interface FieldRestorePanelProps {
  restorePreview: RecordRestorePreview;
  selectedFields: Record<string, number>;
  onSelectFieldVersion: (field: string, versionNumber: number) => void;
}

export function FieldRestorePanel({
  restorePreview,
  selectedFields,
  onSelectFieldVersion,
}: FieldRestorePanelProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Select which version to use for each field. Fields with a different version selected will be
        restored.
      </p>

      <div className="space-y-4">
        {restorePreview.fields.map((fieldOption) => (
          <div key={fieldOption.field} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-900 dark:text-white">{fieldOption.field}</span>
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
                    onChange={() => onSelectFieldVersion(fieldOption.field, v.version_number)}
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
  );
}
