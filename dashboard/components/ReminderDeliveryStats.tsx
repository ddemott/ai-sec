'use client';

import React, { useState, useEffect } from 'react';
import { Api } from '../lib/api';
import { useActiveTenantId } from '../lib/SessionContext';
import { Card } from './ui/Card';
import { Mail, AlertTriangle, Clock } from 'lucide-react';

interface DeliveryStats {
  sent_total: number;
  sent_7d: number;
  sent_30d: number;
  failed_total: number;
  failed_7d: number;
  scheduled: number;
  cancelled: number;
}

export default function ReminderDeliveryStats() {
  const tenantId = useActiveTenantId();
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    void loadStats();
  }, [tenantId]);

  async function loadStats() {
    setLoading(true);
    setError(null);
    try {
      const data = await Api.reminders.deliveryStats(tenantId);
      setStats(data);
    } catch (e) {
      setError('Failed to load reminder delivery stats');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted">Loading reminder stats...</div>;
  }

  if (error || !stats) {
    return <div className="text-sm text-muted">{error || 'No reminder data yet'}</div>;
  }

  const successRate7d =
    stats.sent_7d + stats.failed_7d > 0
      ? Math.round((stats.sent_7d / (stats.sent_7d + stats.failed_7d)) * 100)
      : null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
        <h3 className="font-semibold text-sm">Reminder Delivery (last 7/30 days)</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-muted" />
          <div>
            <div className="font-medium">Sent (7d / 30d)</div>
            <div>
              {stats.sent_7d} / {stats.sent_30d}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-muted" />
          <div>
            <div className="font-medium">Failed (7d)</div>
            <div>{stats.failed_7d}</div>
          </div>
        </div>

        <div>
          <div className="font-medium">Success rate (7d)</div>
          <div>{successRate7d !== null ? `${successRate7d}%` : '—'}</div>
        </div>

        <div>
          <div className="font-medium">Current scheduled</div>
          <div>{stats.scheduled}</div>
        </div>
      </div>

      <div className="mt-2 text-[10px] text-muted">
        Totals: {stats.sent_total} sent • {stats.failed_total} failed • {stats.cancelled} cancelled
      </div>

      <button onClick={loadStats} className="text-xs mt-2 underline text-accent">
        Refresh
      </button>
    </Card>
  );
}
