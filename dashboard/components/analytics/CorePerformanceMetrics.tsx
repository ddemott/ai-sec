'use client';

import React from 'react';
import { PhoneIncoming, CalendarCheck, Clock, PhoneOff } from 'lucide-react';
import { formatHour } from '../../lib/utils';
import type { AnalyticsCalls } from '../../lib/types';
import type { AppointmentSummary } from './types';
import { MetricCard } from './MetricCard';

interface CorePerformanceMetricsProps {
  hasCalls: boolean;
  totalCalls: number;
  bookedCalls: number;
  abandonedCalls: number;
  conversionPct: number;
  abandonmentPct: number;
  callVolumeSubtitle: string;
  byDay: AnalyticsCalls['by_day'];
  maxDayVolume: number;
  summary: AppointmentSummary | null;
  busiestHour: [string, number] | null;
  busiestDay: [string, number] | null;
}

export function CorePerformanceMetrics({
  hasCalls,
  totalCalls,
  bookedCalls,
  abandonedCalls,
  conversionPct,
  abandonmentPct,
  callVolumeSubtitle,
  byDay,
  maxDayVolume,
  summary,
  busiestHour,
  busiestDay,
}: CorePerformanceMetricsProps) {
  return (
    <>
      {/* 1. Call Volume Over Time — real, from voice_sessions */}
      <MetricCard icon={PhoneIncoming} title="Call Volume" subtitle={callVolumeSubtitle}>
        {hasCalls ? (
          <div>
            <div className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>
              {totalCalls}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {byDay.length > 0
                ? `Across ${byDay.length} active day${byDay.length === 1 ? '' : 's'}`
                : 'Total calls answered'}
            </p>
            {byDay.length > 0 && (
              <div className="flex items-end gap-1 mt-3 h-12">
                {byDay.slice(-21).map((d) => (
                  <div
                    key={d.day}
                    className="flex-1 rounded-sm"
                    title={`${d.day}: ${d.total} call${d.total === 1 ? '' : 's'}, ${d.booked} booked`}
                    style={{
                      height: `${Math.max(8, (d.total / maxDayVolume) * 100)}%`,
                      backgroundColor: 'var(--accent)',
                      opacity: 0.7,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No calls logged yet
          </p>
        )}
      </MetricCard>

      {/* 2. Call to Booking Conversion — real, booked = appointment_id IS NOT NULL */}
      <MetricCard
        icon={CalendarCheck}
        title="Booking Conversion"
        subtitle="Calls that ended in a booking"
      >
        {hasCalls ? (
          <div>
            <div className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>
              {conversionPct}%
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {bookedCalls} of {totalCalls} call{totalCalls === 1 ? '' : 's'} booked
            </p>
            <div
              className="h-1.5 rounded-full mt-3"
              style={{ backgroundColor: 'var(--border-soft)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${conversionPct}%`,
                  backgroundColor: 'var(--accent)',
                  opacity: 0.8,
                }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No calls logged yet
          </p>
        )}
      </MetricCard>

      {/* 3. Busiest Hours — from appointments */}
      <MetricCard icon={Clock} title="Busiest Hours" subtitle="When bookings happen">
        {summary && busiestHour ? (
          <div>
            <div className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>
              {formatHour(Number(busiestHour[0]))}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Peak hour ({busiestHour[1]} bookings)
              {busiestDay && ` · ${busiestDay[0]}s busiest (${busiestDay[1]})`}
            </p>
            <div className="flex gap-1 mt-3">
              {Array.from({ length: 12 }, (_, i) => i + 6).map((h) => {
                const count = summary.byHour[h] || 0;
                const max = Math.max(...Object.values(summary.byHour), 1);
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-sm"
                      style={{
                        height: `${Math.max(4, (count / max) * 40)}px`,
                        backgroundColor: count > 0 ? 'var(--accent)' : 'var(--border-soft)',
                        opacity: count > 0 ? 0.7 : 0.3,
                      }}
                    />
                    <span className="text-[8px]" style={{ color: 'var(--text-muted)' }}>
                      {h > 12 ? h - 12 : h}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No booking data yet
          </p>
        )}
      </MetricCard>

      {/* 4. Caller Abandonment — real, from voice_sessions (no booking + no outcome) */}
      <MetricCard
        icon={PhoneOff}
        title="Caller Abandonment"
        subtitle="Calls that ended with no booking and no outcome"
      >
        {hasCalls ? (
          <div>
            <div className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>
              {abandonmentPct}%
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {abandonedCalls} of {totalCalls} call{totalCalls === 1 ? '' : 's'} ended unresolved
            </p>
            <div
              className="h-1.5 rounded-full mt-3"
              style={{ backgroundColor: 'var(--border-soft)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${abandonmentPct}%`,
                  backgroundColor: 'var(--danger, #e57373)',
                  opacity: 0.7,
                }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No calls logged yet
          </p>
        )}
      </MetricCard>
    </>
  );
}
