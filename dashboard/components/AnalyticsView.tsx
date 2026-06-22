'use client';

import React, { useState, useEffect } from 'react';
import {
  PhoneIncoming,
  CalendarCheck,
  Clock,
  PhoneOff,
  Repeat,
  UserX,
  TrendingUp,
  ListChecks,
} from 'lucide-react';
import { Api } from '../lib/api';
import type { AnalyticsCalls, AiCostSummary, AnalyticsCohorts } from '../lib/types';
import { useActiveTenantId } from '../lib/SessionContext';
import { formatHour } from '../lib/utils';
import { EmptyState } from './ui/EmptyState';
import ReminderDeliveryStats from './ReminderDeliveryStats';

/**
 * Analytics — call + booking patterns.
 *
 * Six metrics that answer real business questions:
 * 1. Call Volume Over Time — marketing effectiveness signal (from voice_sessions)
 * 2. Call to Booking Conversion — booked calls / total calls (from voice_sessions)
 * 3. Busiest Hours — when bookings are made (from appointments)
 * 4. Caller Abandonment — calls that ended with no outcome + no booking (from voice_sessions)
 * 5. Return Rate by First Service — which services drive loyalty (from appointments)
 * 6. No-Show Pattern — which days have the most cancellations (from appointments)
 *
 * Plus a "Why callers reached out" outcome breakdown — the first WHY cut we can
 * surface from the call-level outcome data competitors don't capture. Richer WHY
 * (price / no-availability / wrong-service reasons) needs structured outcome
 * classification that isn't built yet — tracked as a follow-up.
 *
 * Call metrics come from voice_sessions via Api.analytics.getCalls; "booked" is
 * keyed on appointment_id (the hard signal), not the freeform `outcome` text.
 */

interface AppointmentSummary {
  total: number;
  byDay: Record<string, number>;
  byHour: Record<number, number>;
  noShowsByDay: Record<string, number>;
  returnRate: Record<string, { first: number; returned: number }>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Human-friendly labels for the freeform voice_sessions.outcome values the agent writes.
const OUTCOME_LABELS: Record<string, string> = {
  booked: 'Booked an appointment',
  appointment_booked: 'Booked an appointment',
  info_provided: 'Got information',
  transferred: 'Transferred to a person',
  message: 'Left a message',
  voicemail: 'Left a voicemail',
  no_outcome: 'No clear outcome',
  // WHY categories from the agent's post-call classifier (callClassify.ts)
  no_availability: "Wanted a time we couldn't offer",
  wrong_service: "Wanted a service we don't offer",
  price: 'Price concern',
  info: 'Asked a question',
};

function labelForOutcome(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, ' ');
}

export default function AnalyticsView() {
  const tenantId = useActiveTenantId();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AppointmentSummary | null>(null);
  const [calls, setCalls] = useState<AnalyticsCalls | null>(null);
  const [aiCost, setAiCost] = useState<AiCostSummary | null>(null);
  const [cohorts, setCohorts] = useState<AnalyticsCohorts | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadData() {
    setLoading(true);
    try {
      // Load appointments (the hour/day/return patterns) and call analytics
      // (volume/conversion/abandonment/outcome) in parallel.
      const [appointments, callStats, aiCostRes, cohortRes] = await Promise.all([
        Api.appointments.list(tenantId),
        Api.analytics.getCalls(tenantId).catch(() => null),
        Api.analytics.getAiCost(tenantId).catch(() => null),
        Api.analytics.getCohorts(tenantId).catch(() => null),
      ]);

      if (callStats) setCalls(callStats);
      if (aiCostRes) setAiCost(aiCostRes);
      if (cohortRes) setCohorts(cohortRes);

      if (Array.isArray(appointments)) {
        const byDay: Record<string, number> = {};
        const byHour: Record<number, number> = {};
        const noShowsByDay: Record<string, number> = {};
        const allCustomerServices: Record<string, string[]> = {};

        for (const apt of appointments) {
          // By day of week
          const d = new Date(apt.start_time);
          const dayName = DAY_NAMES[d.getDay()];
          byDay[dayName] = (byDay[dayName] || 0) + 1;

          // By hour
          const hour = d.getHours();
          byHour[hour] = (byHour[hour] || 0) + 1;

          // No-shows by day
          if (apt.status === 'canceled') {
            noShowsByDay[dayName] = (noShowsByDay[dayName] || 0) + 1;
          }

          // Track services per customer for return rate
          const custId = apt.customer_id;
          if (custId) {
            if (!allCustomerServices[custId]) allCustomerServices[custId] = [];
            allCustomerServices[custId].push(apt.description || 'Unknown');
          }
        }

        // Return rate by first service
        const returnRate: Record<string, { first: number; returned: number }> = {};
        for (const services of Object.values(allCustomerServices)) {
          const firstSvc = services[0];
          if (!returnRate[firstSvc]) returnRate[firstSvc] = { first: 0, returned: 0 };
          returnRate[firstSvc].first++;
          if (services.length > 1) returnRate[firstSvc].returned++;
        }

        setSummary({
          total: appointments.length,
          byDay,
          byHour,
          noShowsByDay,
          returnRate,
        });
      }
    } catch (err) {
      console.error('Failed to load analytics', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg-base)' }}>
        <div className="max-w-5xl mx-auto">
          <div
            className="h-8 w-32 rounded-lg mb-1 animate-pulse"
            style={{ backgroundColor: 'var(--bg-raised)' }}
          />
          <div
            className="h-4 w-64 rounded mb-6 animate-pulse"
            style={{ backgroundColor: 'var(--bg-raised)' }}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl p-5"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-soft)',
                }}
              >
                <div
                  className="h-4 w-24 rounded mb-2 animate-pulse"
                  style={{ backgroundColor: 'var(--bg-raised)' }}
                />
                <div
                  className="h-3 w-40 rounded mb-3 animate-pulse"
                  style={{ backgroundColor: 'var(--bg-raised)' }}
                />
                <div
                  className="h-16 rounded-lg animate-pulse"
                  style={{ backgroundColor: 'var(--bg-raised)' }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const hasCalls = !!calls && calls.totals.total > 0;
  const hasAppointments = !!summary && summary.total > 0;

  if (!hasCalls && !hasAppointments) {
    return (
      <div className="flex-1 flex" style={{ backgroundColor: 'var(--bg-base)' }}>
        <EmptyState
          icon={CalendarCheck}
          title="No data yet"
          description="Analytics will appear once calls come in and appointments are booked."
        />
      </div>
    );
  }

  // Find busiest hour / day from appointments
  const busiestHour =
    summary && hasAppointments
      ? Object.entries(summary.byHour).sort(([, a], [, b]) => b - a)[0]
      : null;
  const busiestDay =
    summary && hasAppointments
      ? Object.entries(summary.byDay).sort(([, a], [, b]) => b - a)[0]
      : null;

  // Call analytics derivations (all keyed on appointment_id, never the outcome string).
  const totalCalls = calls?.totals.total ?? 0;
  const bookedCalls = calls?.totals.booked ?? 0;
  const abandonedCalls = calls?.totals.abandoned ?? 0;
  const conversionPct = totalCalls > 0 ? Math.round((bookedCalls / totalCalls) * 100) : 0;
  const abandonmentPct = totalCalls > 0 ? Math.round((abandonedCalls / totalCalls) * 100) : 0;
  const byDay = calls?.by_day ?? [];
  const maxDayVolume = Math.max(...byDay.map((d) => d.total), 1);
  const byOutcome = calls?.by_outcome ?? [];

  return (
    <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="max-w-5xl mx-auto">
        <h1
          className="font-display text-2xl tracking-wide mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          Analytics
        </h1>
        <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>
          Patterns from your calls and bookings. You know your business — these numbers help you see
          it.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* 1. Call Volume Over Time — real, from voice_sessions */}
          <MetricCard
            icon={PhoneIncoming}
            title="Call Volume"
            subtitle="Calls over the last 30 days"
          >
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
                        <span style={{ color: 'var(--text-secondary)' }} className="truncate mr-2">
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

          {/* 7. No-Show Pattern — from appointments */}
          <MetricCard
            icon={UserX}
            title="No-Show Pattern"
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
        </div>

        {/* Reminder delivery monitoring */}
        <div className="mt-6">
          <ReminderDeliveryStats />
        </div>

        {/* AI Usage (this month) */}
        <div
          className="mt-6 p-4 rounded-xl"
          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              AI Usage — this month (estimated)
            </span>
          </div>
          {aiCost && aiCost.breakdown.length > 0 ? (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ color: 'var(--text-primary)' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th className="text-left pb-2 pr-4">Provider / Model</th>
                      <th className="text-left pb-2 pr-4">Source</th>
                      <th className="text-right pb-2 pr-4">Input tokens</th>
                      <th className="text-right pb-2 pr-4">Output tokens</th>
                      <th className="text-right pb-2 pr-4">STT audio</th>
                      <th className="text-right pb-2 pr-4">TTS chars</th>
                      <th className="text-right pb-2">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiCost.breakdown.map((row, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                        <td className="py-1 pr-4 font-mono">
                          {row.provider}/{row.model}
                        </td>
                        <td className="py-1 pr-4">{row.source.replace(/_/g, ' ')}</td>
                        <td className="py-1 pr-4 text-right">
                          {row.input_tokens.toLocaleString()}
                        </td>
                        <td className="py-1 pr-4 text-right">
                          {row.output_tokens.toLocaleString()}
                        </td>
                        <td className="py-1 pr-4 text-right">
                          {row.audio_duration_ms > 0
                            ? `${(row.audio_duration_ms / 60000).toFixed(1)} min`
                            : '—'}
                        </td>
                        <td className="py-1 pr-4 text-right">
                          {row.characters_count > 0 ? row.characters_count.toLocaleString() : '—'}
                        </td>
                        <td className="py-1 text-right font-mono">
                          {row.estimated_cost_usd > 0
                            ? `$${row.estimated_cost_usd.toFixed(4)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border-soft)' }}>
                      <td colSpan={6} className="pt-2 text-right font-semibold pr-4">
                        Total estimated
                      </td>
                      <td className="pt-2 text-right font-mono font-semibold">
                        ${aiCost.total_estimated_cost_usd.toFixed(4)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                Rates: GPT-4o-mini $0.15/$0.60 per 1M tokens · Deepgram $0.0043/min · xAI TTS cost
                TBD (chars tracked)
              </p>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              No AI usage recorded this month yet. Costs appear after live calls complete.
            </p>
          )}
        </div>

        {/* Roadmap: richer WHY analysis still ahead */}
        <div
          className="mt-4 p-4 rounded-xl"
          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Coming next
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Deeper &ldquo;why&rdquo; analysis — when a caller doesn&rsquo;t book, was it price, no
            availability, or the wrong service? — needs richer outcome tagging during the call.
            That&rsquo;s on the roadmap. Today&rsquo;s panels are built from your real call and
            booking history.
          </p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-soft)',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        {subtitle}
      </p>
      {children}
    </div>
  );
}
