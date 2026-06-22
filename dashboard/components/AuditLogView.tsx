'use client';

/**
 * Owner-only change-history view. Renders GET /audit-log — every INSERT/UPDATE/
 * DELETE the audit trigger recorded on appointments / customers / resources —
 * so an owner can answer "who changed this, and when?" without DB access.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { LoadingState } from './ui/LoadingState';
import { EmptyState } from './ui/EmptyState';
import { Api } from '../lib/api';
import { useActiveTenantId } from '../lib/SessionContext';
import { showToast } from './ui/Toast';
import type { AuditLogEntry } from '../lib/types';

const PAGE_SIZE = 50;

// The audit trigger only fires on these tables (see fn_audit_trigger).
const TABLE_OPTIONS = [
  { label: 'All tables', value: '' },
  { label: 'Appointments', value: 'appointments' },
  { label: 'Customers', value: 'customers' },
  { label: 'Resources', value: 'resources' },
];

function actionVariant(action: string): 'success' | 'warning' | 'danger' | 'secondary' {
  switch (action.toUpperCase()) {
    case 'INSERT':
      return 'success';
    case 'UPDATE':
      return 'warning';
    case 'DELETE':
      return 'danger';
    default:
      return 'secondary';
  }
}

export default function AuditLogView() {
  const tenantId = useActiveTenantId();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [tableFilter, setTableFilter] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await Api.auditLog.list(tenantId, {
        limit: PAGE_SIZE,
        offset,
        table_name: tableFilter || undefined,
      });
      if (res.success) {
        setEntries(res.entries);
      } else {
        setError('Failed to load audit log');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load audit log';
      setError(msg);
      showToast('Failed to load audit log', 'error');
    } finally {
      setLoading(false);
    }
  }, [tenantId, offset, tableFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card title="Audit Log">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-56">
            <Select
              label="Filter by table"
              value={tableFilter}
              options={TABLE_OPTIONS}
              onChange={(e) => {
                setOffset(0);
                setTableFilter(e.target.value);
              }}
            />
          </div>
        </div>

        {loading ? (
          <LoadingState message="Loading audit log…" />
        ) : error ? (
          <EmptyState title="Couldn't load the audit log" description={error} />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No changes recorded yet"
            description="Edits to appointments, customers, and resources will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Table</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Record</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.audit_log_id} className="border-b last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">{e.table_name}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={actionVariant(e.action)}>{e.action}</Badge>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-600">{e.record_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </Button>
          <span className="text-xs text-gray-500">
            Showing {entries.length ? offset + 1 : 0}–{offset + entries.length}
          </span>
          <Button
            variant="secondary"
            size="sm"
            // A full page came back → there may be more.
            disabled={loading || entries.length < PAGE_SIZE}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </Card>
  );
}
