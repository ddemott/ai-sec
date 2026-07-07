'use client';

/**
 * The 12-card analytics metrics grid. Preserves the original visual order from
 * AnalyticsView.tsx (dense-view decomposition). Pure presentation — no state,
 * no data fetching; all data arrives via props.
 */

import React from 'react';
import type { AnalyticsCalls, AnalyticsCohorts } from '../../lib/types';
import type { AppointmentSummary } from './types';
import { CorePerformanceMetrics } from './CorePerformanceMetrics';
import { EngagementRetentionMetrics } from './EngagementRetentionMetrics';
import { ServiceCohortMetrics } from './ServiceCohortMetrics';

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
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <CorePerformanceMetrics
        hasCalls={calls.hasCalls}
        totalCalls={calls.totalCalls}
        bookedCalls={calls.bookedCalls}
        abandonedCalls={calls.abandonedCalls}
        conversionPct={calls.conversionPct}
        abandonmentPct={calls.abandonmentPct}
        callVolumeSubtitle={calls.callVolumeSubtitle}
        byDay={calls.byDay}
        maxDayVolume={calls.maxDayVolume}
        summary={appointments.summary}
        busiestHour={appointments.busiestHour}
        busiestDay={appointments.busiestDay}
      />
      <EngagementRetentionMetrics
        hasCalls={calls.hasCalls}
        totalCalls={calls.totalCalls}
        byOutcome={calls.byOutcome}
        summary={appointments.summary}
        cohorts={cohorts}
      />
      <ServiceCohortMetrics cohorts={cohorts} />
    </div>
  );
}
