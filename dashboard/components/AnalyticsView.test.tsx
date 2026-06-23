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
    analytics: { getCalls: vi.fn(), getStats: vi.fn(), getAiCost: vi.fn(), getCohorts: vi.fn() },
  },
}));

vi.mock('../lib/api', () => ({ Api: mockApi }));

import AnalyticsView from './AnalyticsView';

beforeEach(() => {
  mockApi.appointments.list.mockReset().mockResolvedValue([]);
  mockApi.analytics.getCalls.mockReset().mockResolvedValue(null);
  mockApi.analytics.getStats.mockReset().mockResolvedValue(null);
  mockApi.analytics.getAiCost.mockReset().mockResolvedValue(null);
  mockApi.analytics.getCohorts.mockReset().mockResolvedValue(null);
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
        { outcome: 'no_availability', count: 2, booked: 0 },
        { outcome: 'no_outcome', count: 1, booked: 0 },
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

    // WHY breakdown shows human-friendly outcome labels — incl. the agent's
    // richer WHY categories (no_availability → "Wanted a time we couldn't offer").
    expect(screen.getByText('Left a message')).toBeInTheDocument();
    expect(screen.getByText('No clear outcome')).toBeInTheDocument();
    expect(screen.getByText("Wanted a time we couldn't offer")).toBeInTheDocument();
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

  test('HAPPY: renders Repeat Callers + Bookings by Service from getCohorts', async () => {
    // WHO: an owner viewing the analytics-depth panels.
    // WHAT: the cohort endpoint drives a "Repeat Callers" panel (count + share +
    //        top callers) and a "Bookings by Service" panel.
    // WHEN: getCohorts returns 1 repeat caller + 2 services.
    // WHERE: the two new MetricCards in AnalyticsView.
    // WHY: pins that the depth panels render real data, not a stub/empty state.
    // Minimal call data so the analytics grid renders (the panels live in it).
    mockApi.analytics.getCalls.mockResolvedValue({
      totals: { total: 12, booked: 4, abandoned: 2 },
      by_outcome: [{ outcome: 'booked', count: 4, booked: 4 }],
      by_day: [{ day: '2026-06-20', total: 12, booked: 4 }],
    });
    mockApi.analytics.getCohorts.mockResolvedValue({
      repeat_callers: [
        {
          phone: '6305550000',
          call_count: 3,
          booked_count: 2,
          first_call: '2026-06-01T10:00:00Z',
          last_call: '2026-06-20T10:00:00Z',
        },
      ],
      by_service: [
        { service: 'Oil Change', booked_count: 5 },
        { service: 'Tire Rotation', booked_count: 2 },
      ],
      top_customers: [
        { customer_id: 'cust-1', name: 'Jane Doe', visits: 4, revenue: 320 },
        { customer_id: 'cust-2', name: 'Bob Smith', visits: 2, revenue: 90 },
      ],
      abandonment_by_service: [{ service: 'Detailing', abandoned_count: 4 }],
      summary: {
        distinct_callers: 10,
        repeat_callers: 1,
        repeat_call_volume: 3,
        total_calls: 12,
      },
    });

    render(<AnalyticsView />);

    expect(await screen.findByText('Repeat Callers')).toBeInTheDocument();
    expect(screen.getByText('Bookings by Service')).toBeInTheDocument();
    // repeat-caller share = 3/12 = 25%
    expect(screen.getByText(/25% of all calls come from repeat callers/i)).toBeInTheDocument();
    expect(screen.getByText('6305550000')).toBeInTheDocument();
    expect(screen.getByText(/3 calls · 2 booked/i)).toBeInTheDocument();
    expect(screen.getByText('Oil Change')).toBeInTheDocument();

    // Abandonment-by-service panel.
    expect(screen.getByText('Abandoned by Service')).toBeInTheDocument();
    expect(screen.getByText('Detailing')).toBeInTheDocument();

    // CLV panel — top customers by lifetime booked revenue.
    expect(screen.getByText('Top Customers')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/\$320 · 4 visits/i)).toBeInTheDocument();
  });

  test('HAPPY: picking a From date refetches calls + cohorts with that bound', async () => {
    // WHO: an owner narrowing the Analytics view to a date window.
    // WHAT: changing the From control re-runs getCalls + getCohorts, this time
    //        with { start_date } in the range arg — so the backend filters.
    // WHEN: user types a date into the From input.
    // WHERE: AnalyticsView startDate state + the [tenantId,startDate,endDate] effect.
    // WHY: without the refetch the header would say "from May 1" while the numbers
    //        stayed all-time — a silent lie. This pins the bound reaches the API.
    const { fireEvent } = await import('@testing-library/react');
    // total>0 so the main view (which hosts the From/To controls) renders.
    mockApi.analytics.getCalls.mockResolvedValue({
      totals: { total: 5, booked: 2, abandoned: 1 },
      by_outcome: [],
      by_day: [],
    });

    render(<AnalyticsView />);

    // Initial load: all-time (no range bound).
    expect(await screen.findByLabelText('From date')).toBeInTheDocument();
    expect(mockApi.analytics.getCalls).toHaveBeenLastCalledWith('tenant-123', {
      start_date: undefined,
      end_date: undefined,
    });

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-05-01' } });

    // Refetch carries the new lower bound to both call + cohort endpoints.
    await vi.waitFor(() => {
      expect(mockApi.analytics.getCalls).toHaveBeenLastCalledWith('tenant-123', {
        start_date: '2026-05-01',
        end_date: undefined,
      });
    });
    expect(mockApi.analytics.getCohorts).toHaveBeenLastCalledWith('tenant-123', {
      start_date: '2026-05-01',
      end_date: undefined,
    });
  });
});
