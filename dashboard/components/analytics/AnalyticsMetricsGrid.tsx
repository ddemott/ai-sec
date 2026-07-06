'use client';

/**
 * The 12-card analytics metrics grid. Preserves the original visual order from
 * AnalyticsView.tsx (dense-view decomposition). Pure presentation — no state,
 * no data fetching; all data arrives via props.
 */

import React from 'react';
import {
  PhoneIncoming,
  CalendarCheck,
  Clock,
  PhoneOff,
  Repeat,
  UserX,
  TrendingUp,
  ListChecks,
  CheckCircle2,
} from 'lucide-react';
import { formatHour } from '../../lib/utils';
import type { AnalyticsCalls, AnalyticsCohorts } from '../../lib/types';
import type { AppointmentSummary } from './types';
import { MetricCard } from './MetricCard';
import { DAY_NAMES, labelForOutcome } from './callOutcomeLabels';

interface CallProps {
  hasCalls: boolean;
  totalCalls: number;
  bookedCalls: number;
  abandonedCalls: number;
  conversionPct: number;
  abandonmentPct: number;
  callVolumeSubtitle: string;
  byDay: AnalyticsCalls['by_day'];
  maxDayVolume: number;
  byOutcome: AnalyticsCalls['by_outcome'];
}

interface AppointmentProps {
  summary: AppointmentSummary | null;
  hasAppointments: boolean;
  busiestHour: [string, number] | null;
  busiestDay: [string, number] | null;
}

interface AnalyticsMetricsGridProps {
  calls: CallProps;
  appointments: AppointmentProps;
  cohorts: AnalyticsCohorts | null;
}

export function AnalyticsMetricsGrid({ calls, appointments, cohorts }: AnalyticsMetricsGridProps) {
  const { hasCalls, totalCalls, bookedCalls, abandonedCalls, conversionPct, abandonmentPct,
    callVolumeSubtitle, byDay, maxDayVolume, byOutcome } = calls;
  const { summary, busiestHour, busiestDay } = appointments;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              {abandonedCalls} of {totalCalls} call{totalCalls === 1 ? '' : 's'} ended
              unresolved
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

      {/* 5. Why callers reached out — outcome breakdown (the WHY cut) */}
      <MetricCard
        icon={ListChecks}
        title="Why Callers Reached Out"
        subtitle="What each call resulted in"
      >
        {hasCalls && byOutcome.length > 0 ? (
          <div className="space-y-2">
            {byOutcome.slice(0, 5).map((o) => {
              const pct = totalCalls > 0 ? Math.round((o.count / totalCalls) * 100) : 0;
              return (
                <div key={o.outcome}>
                  <div className="flex justify-between text-xs mb-1">
                    <span
                      style={{ color: 'var(--text-secondary)' }}
                      className="truncate mr-2"
                    >
                      {labelForOutcome(o.outcome)}
                    </span>
                    <span
                      style={{ color: 'var(--text-primary)' }}
                      className="font-medium shrink-0"
                    >
                      {o.count} ({pct}%)
                    </span>
                  </div>
                  <div
                    className="h-1 rounded-full"
                    style={{ backgroundColor: 'var(--border-soft)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: 'var(--accent-soft)',
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No calls logged yet
          </p>
        )}
      </MetricCard>

      {/* 6. Return Rate by First Service — from appointments */}
      <MetricCard
        icon={Repeat}
        title="Return Rate by First Service"
        subtitle="Of first-time customers, how many came back?"
      >
        {summary && Object.keys(summary.returnRate).length > 0 ? (
          <div className="space-y-2">
            {Object.entries(summary.returnRate)
              .sort(([, a], [, b]) => b.first - a.first)
              .slice(0, 5)
              .map(([svc, data]) => {
                const rate =
                  data.first > 0 ? Math.round((data.returned / data.first) * 100) : 0;
                return (
                  <div key={svc}>
                    <div className="flex justify-between text-xs mb-1">
                      <span
                        style={{ color: 'var(--text-secondary)' }}
                        className="truncate mr-2"
                      >
                        {svc}
                      </span>
                      <span
                        style={{ color: 'var(--text-primary)' }}
                        className="font-medium shrink-0"
                      >
                        {rate}% ({data.returned}/{data.first})
                      </span>
                    </div>
                    <div
                      className="h-1 rounded-full"
                      style={{ backgroundColor: 'var(--border-soft)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${rate}%`,
                          backgroundColor: 'var(--accent-soft)',
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No repeat customer data yet
          </p>
        )}
      </MetricCard>

      {/* 7. Cancellation Pattern — from appointments (status === 'canceled') */}
      <MetricCard
        icon={UserX}
        title="Cancellation Pattern"
        subtitle="Canceled appointments by day of week"
      >
        {summary ? (
          <div>
            <div className="flex gap-2 mt-1">
              {DAY_NAMES.map((day) => {
                const count = summary.noShowsByDay[day] || 0;
                return (
                  <div key={day} className="flex-1 text-center">
                    <div
                      className="text-xs font-bold rounded-md py-1 mb-1"
                      style={{
                        backgroundColor: 'var(--bg-raised)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {count}
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {day}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No data yet
          </p>
        )}
      </MetricCard>

      {/* 8. Repeat callers — who reaches out more than once + how often they book */}
      <MetricCard
        icon={Repeat}
        title="Repeat Callers"
        subtitle="Callers who reached out more than once"
      >
        {cohorts && cohorts.summary.repeat_callers > 0 ? (
          <div className="space-y-2">
            <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {cohorts.summary.repeat_callers}
              <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                {' '}
                of {cohorts.summary.distinct_callers} callers
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {cohorts.summary.total_calls > 0
                ? Math.round(
                    (cohorts.summary.repeat_call_volume / cohorts.summary.total_calls) * 100
                  )
                : 0}
              % of all calls come from repeat callers
            </p>
            <div className="space-y-1 pt-1">
              {cohorts.repeat_callers.slice(0, 5).map((c) => (
                <div key={c.phone} className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>{c.phone}</span>
                  <span style={{ color: 'var(--text-primary)' }} className="font-medium">
                    {c.call_count} calls · {c.booked_count} booked
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No repeat callers yet
          </p>
        )}
      </MetricCard>

      {/* 9. Bookings by service — which services the booked calls actually booked */}
      <MetricCard
        icon={ListChecks}
        title="Bookings by Service"
        subtitle="What booked calls scheduled"
      >
        {cohorts && cohorts.by_service.length > 0 ? (
          (() => {
            const maxBooked = Math.max(...cohorts.by_service.map((s) => s.booked_count), 1);
            return (
              <div className="space-y-2">
                {cohorts.by_service.slice(0, 6).map((s) => (
                  <div key={s.service}>
                    <div className="flex justify-between text-xs mb-1">
                      <span
                        style={{ color: 'var(--text-secondary)' }}
                        className="truncate mr-2"
                      >
                        {s.service}
                      </span>
                      <span
                        style={{ color: 'var(--text-primary)' }}
                        className="font-medium shrink-0"
                      >
                        {s.booked_count}
                      </span>
                    </div>
                    <div
                      className="h-1 rounded-full"
                      style={{ backgroundColor: 'var(--border-soft)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((s.booked_count / maxBooked) * 100)}%`,
                          backgroundColor: 'var(--accent-soft)',
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No bookings yet
          </p>
        )}
      </MetricCard>

      {/* 10. Top customers (CLV) — lifetime booked revenue per customer */}
      <MetricCard
        icon={TrendingUp}
        title="Top Customers"
        subtitle="By lifetime booked revenue"
      >
        {cohorts && cohorts.top_customers.length > 0 ? (
          <div className="space-y-1">
            {cohorts.top_customers.slice(0, 6).map((c) => (
              <div key={c.customer_id} className="flex justify-between text-xs">
                <span
                  style={{ color: 'var(--text-secondary)' }}
                  className="truncate mr-2"
                >
                  {c.name}
                </span>
                <span
                  style={{ color: 'var(--text-primary)' }}
                  className="font-medium shrink-0"
                >
                  ${c.revenue.toFixed(0)} · {c.visits} visit{c.visits === 1 ? '' : 's'}
                </span>
              </div>
            ))}
            <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>
              Revenue uses each service&apos;s price — set prices under My Business for accuracy.
            </p>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No bookings yet
          </p>
        )}
      </MetricCard>

      {/* 11. Abandoned by service — callers who tried to book a service but didn't */}
      <MetricCard
        icon={PhoneOff}
        title="Abandoned by Service"
        subtitle="Callers who tried to book but didn't"
      >
        {cohorts && cohorts.abandonment_by_service.length > 0 ? (
          (() => {
            const maxAb = Math.max(
              ...cohorts.abandonment_by_service.map((s) => s.abandoned_count),
              1
            );
            return (
              <div className="space-y-2">
                {cohorts.abandonment_by_service.slice(0, 6).map((s) => (
                  <div key={s.service}>
                    <div className="flex justify-between text-xs mb-1">
                      <span
                        style={{ color: 'var(--text-secondary)' }}
                        className="truncate mr-2"
                      >
                        {s.service}
                      </span>
                      <span
                        style={{ color: 'var(--text-primary)' }}
                        className="font-medium shrink-0"
                      >
                        {s.abandoned_count}
                      </span>
                    </div>
                    <div
                      className="h-1 rounded-full"
                      style={{ backgroundColor: 'var(--border-soft)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((s.abandoned_count / maxAb) * 100)}%`,
                          backgroundColor: 'var(--danger-soft, #ef4444)',
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>
                  Callers who attempted to book these services but left without an appointment.
                </p>
              </div>
            );
          })()
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No abandoned bookings recorded yet
          </p>
        )}
      </MetricCard>

      {/* 12. First-time fix — callers resolved on first contact. Optional
          access on first_time_fix so an older backend (field absent)
          degrades to the empty state instead of crashing the grid. */}
      <MetricCard
        icon={CheckCircle2}
        title="First-Time Fix"
        subtitle="Callers whose first call ended in a booking"
      >
        {cohorts?.first_time_fix && cohorts.first_time_fix.rate !== null ? (
          <div>
            <div className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>
              {Math.round(cohorts.first_time_fix.rate * 100)}%
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {cohorts.first_time_fix.first_call_booked} of{' '}
              {cohorts.first_time_fix.distinct_callers} caller
              {cohorts.first_time_fix.distinct_callers === 1 ? '' : 's'} booked on their first
              call
            </p>
            <div
              className="h-1.5 rounded-full mt-3"
              style={{ backgroundColor: 'var(--border-soft)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(cohorts.first_time_fix.rate * 100)}%`,
                  backgroundColor: 'var(--accent)',
                  opacity: 0.8,
                }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No callers logged yet
          </p>
        )}
      </MetricCard>
    </div>
  );
}
