/**
 * AnalyticsView tests — the call-analytics panels that gap #2 made real
 * (Call Volume, Booking Conversion, Caller Abandonment, and the "Why callers
 * reached out" WHY breakdown). Before gap #2 these were hardcoded "Phase 2"
 * stubs; this pins that they now render REAL numbers from Api.analytics.getCalls
 * and degrade to an honest empty state when there are no calls.
 *
 * Each test carries 5W diagnostic context.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('../lib/SessionContext', () => ({
  useActiveTenantId: () => 'tenant-123',
}));

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    appointments: { list: vi.fn() },
    analytics: { getCalls: vi.fn() },
  },
}));

vi.mock('../lib/api', () => ({ Api: mockApi }));

import AnalyticsView from './AnalyticsView';

beforeEach(() => {
  mockApi.appointments.list.mockReset().mockResolvedValue([]);
  mockApi.analytics.getCalls.mockReset().mockResolvedValue(null);
});

describe('AnalyticsView — call analytics panels (gap #2)', () => {
  test('HAPPY: renders conversion %, abandonment %, and the WHY outcome breakdown from getCalls', async () => {
    // WHO: an owner opening the Analytics tab after real calls have been logged.
    // WHAT: the panels compute conversion = booked/total and abandonment =
    //        abandoned/total from voice_sessions-derived totals, and list the
    //        outcome breakdown ("why callers reached out").
    // WHEN: getCalls returns 10 calls, 4 booked, 3 abandoned + an outcome mix.
    // WHERE: AnalyticsView call-analytics derivations + the 3 + WHY panels.
    // WHY: these were "Phase 2" stubs; this proves real data drives them and the
    //       math (40% conversion, 30% abandonment) is wired to the totals.
    mockApi.analytics.getCalls.mockResolvedValue({
      totals: { total: 10, booked: 4, abandoned: 3 },
      by_outcome: [
        { outcome: 'booked', count: 4, booked: 4 },
        { outcome: 'message', count: 3, booked: 0 },
        { outcome: 'no_outcome', count: 3, booked: 0 },
      ],
      by_day: [
        { day: '2026-06-10', total: 5, booked: 2 },
        { day: '2026-06-11', total: 5, booked: 2 },
      ],
    });

    render(<AnalyticsView />);

    expect(await screen.findByText('Call Volume')).toBeInTheDocument();
    expect(screen.getByText('Booking Conversion')).toBeInTheDocument();
    expect(screen.getByText('Caller Abandonment')).toBeInTheDocument();
    expect(screen.getByText('Why Callers Reached Out')).toBeInTheDocument();

    // 4/10 = 40% conversion, 3/10 = 30% abandonment.
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();

    // WHY breakdown shows human-friendly outcome labels.
    expect(screen.getByText('Left a message')).toBeInTheDocument();
    expect(screen.getByText('No clear outcome')).toBeInTheDocument();
  });

  // A single booked appointment so the view renders its panels (the global
  // "No data yet" state only shows when there are NEITHER calls NOR appointments).
  const ONE_APPT = [
    {
      start_time: '2026-06-11T10:00:00',
      status: 'confirmed',
      customer_id: 'c1',
      description: 'Oil Change',
    },
  ];

  test('SAD: appointments but zero calls → call panels show "No calls logged yet" (no fabricated data)', async () => {
    // WHO: a tenant with bookings but no logged calls yet.
    // WHAT: with call total=0 the call panels must show an empty state, never a fake 0%/chart.
    // WHEN: getCalls returns all-zero totals; appointments exist so the grid renders.
    // WHERE: the call-panel empty-state branches keyed on totalCalls/byDay.length.
    // WHY: honesty — the old stub claimed "Phase 2"; the new one must not invent numbers.
    mockApi.appointments.list.mockResolvedValue(ONE_APPT);
    mockApi.analytics.getCalls.mockResolvedValue({
      totals: { total: 0, booked: 0, abandoned: 0 },
      by_outcome: [],
      by_day: [],
    });

    render(<AnalyticsView />);

    expect(await screen.findByText('Call Volume')).toBeInTheDocument();
    expect(screen.getAllByText('No calls logged yet').length).toBeGreaterThan(0);
  });

  test('SAD: getCalls failing does not crash the view (degrades to call-empty)', async () => {
    // WHO: a transient backend hiccup on /analytics/calls.
    // WHAT: loadData catches the getCalls rejection (.catch(()=>null)); the view
    //        still renders the appointment-derived panels + call-empty state.
    // WHEN: getCalls rejects; appointments exist so the grid renders.
    // WHERE: loadData's Promise.all with .catch on getCalls.
    // WHY: a flaky call-analytics fetch must never blank the whole Analytics tab.
    mockApi.appointments.list.mockResolvedValue(ONE_APPT);
    mockApi.analytics.getCalls.mockRejectedValue(new Error('boom'));

    render(<AnalyticsView />);

    expect(await screen.findByText('Call Volume')).toBeInTheDocument();
    expect(screen.getAllByText('No calls logged yet').length).toBeGreaterThan(0);
  });
});
