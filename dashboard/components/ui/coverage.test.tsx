import { expect, test, describe } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { CoverageStatusBadge } from './CoverageStatusBadge';
import { CoverageBar } from './CoverageBar';
import type { HourSlot } from './CoverageBar';

// --- CoverageStatusBadge ---

describe('CoverageStatusBadge', () => {
  // Labels updated to neutral factual text per the no-grading product rule.
  // Old → new: "Full Coverage" → "Assigned", "Partial" → "Partly assigned",
  // "Uncovered" → "Not yet assigned", "No Staff" → "No staff assigned",
  // "No Resource" → "No resource assigned". 2026-05-28 UX audit #9.

  test('renders "Assigned" for full status', () => {
    render(<CoverageStatusBadge status="full" />);
    const badge = screen.getByText('Assigned');
    expect(badge).toBeInTheDocument();
    // WHO: business owner | WHAT: views full coverage badge | WHEN: all hours have assigned staff | WHERE: CoverageStatusBadge | WHY: confirms at a glance that all services are configured
  });

  test('renders "Partly assigned" for partial status', () => {
    render(<CoverageStatusBadge status="partial" />);
    const badge = screen.getByText('Partly assigned');
    expect(badge).toBeInTheDocument();
    // WHO: business owner | WHAT: views partial coverage badge | WHEN: some hours lack staff | WHERE: CoverageStatusBadge | WHY: neutral factual state — owner decides what to do with the info
  });

  test('renders "Not yet assigned" for uncovered status', () => {
    render(<CoverageStatusBadge status="uncovered" />);
    const badge = screen.getByText('Not yet assigned');
    expect(badge).toBeInTheDocument();
    // WHO: business owner | WHAT: views uncovered badge | WHEN: no staff assigned | WHERE: CoverageStatusBadge | WHY: factual state without red danger framing
  });

  test('renders "No staff assigned" for no_staff status', () => {
    render(<CoverageStatusBadge status="no_staff" />);
    const badge = screen.getByText('No staff assigned');
    expect(badge).toBeInTheDocument();
    // WHO: business owner | WHAT: views no-staff badge | WHEN: zero employees configured | WHERE: CoverageStatusBadge | WHY: actionable fact without grading the business
  });

  test('renders "No resource assigned" for no_resource status', () => {
    render(<CoverageStatusBadge status="no_resource" />);
    const badge = screen.getByText('No resource assigned');
    expect(badge).toBeInTheDocument();
    // WHO: business owner | WHAT: views no-resource badge | WHEN: no bays/stations configured | WHERE: CoverageStatusBadge | WHY: factual state the owner can act on
  });

  test('passes className to Badge', () => {
    render(<CoverageStatusBadge status="full" className="mt-2" />);
    const badge = screen.getByText('Assigned');
    expect(badge.className).toContain('mt-2');
    // WHO: developer | WHAT: passes custom className | WHEN: badge rendered with extra classes | WHERE: CoverageStatusBadge | WHY: layout integration requires custom spacing
  });
});

// --- CoverageBar ---

describe('CoverageBar', () => {
  test('renders empty state when no slots provided', () => {
    render(<CoverageBar slots={[]} />);
    expect(screen.getByText('No scheduled hours')).toBeInTheDocument();
    // WHO: business owner | WHAT: views empty coverage bar | WHEN: no hours are scheduled | WHERE: CoverageBar | WHY: empty state must communicate that shifts need to be created before coverage appears
  });

  test('renders one cell per slot', () => {
    const slots: HourSlot[] = [
      { hour: 8, status: 'covered' },
      { hour: 9, status: 'covered' },
      { hour: 10, status: 'gap' },
    ];
    const { container } = render(<CoverageBar slots={slots} />);
    // 3 slot cells in the bar row
    const barRow = container.querySelector('.flex.w-full.rounded');
    expect(barRow?.children.length).toBe(3);
    // WHO: business owner | WHAT: views coverage bar with 3 hour slots | WHEN: schedule has 3 hours defined | WHERE: CoverageBar | WHY: each hour must have its own visual cell so gaps are individually visible
  });

  test('sorts slots by hour regardless of input order', () => {
    const slots: HourSlot[] = [
      { hour: 12, status: 'gap' },
      { hour: 8, status: 'covered' },
      { hour: 10, status: 'covered' },
    ];
    const { container } = render(<CoverageBar slots={slots} />);
    const cells = container.querySelectorAll('.flex.w-full.rounded > div');
    expect(cells[0].getAttribute('title')).toContain('8a');
    expect(cells[1].getAttribute('title')).toContain('10a');
    expect(cells[2].getAttribute('title')).toContain('12p');
    // WHO: business owner | WHAT: views coverage bar with unordered input | WHEN: slots arrive in random order from API | WHERE: CoverageBar | WHY: hours must display chronologically or the timeline is misleading
  });

  test('applies green color for covered slots', () => {
    const slots: HourSlot[] = [{ hour: 9, status: 'covered' }];
    const { container } = render(<CoverageBar slots={slots} />);
    const cell = container.querySelector('.flex.w-full.rounded > div');
    expect(cell?.className).toContain('green');
    // WHO: business owner | WHAT: sees green cell for covered hour | WHEN: staff is assigned to that hour | WHERE: CoverageBar | WHY: green instantly signals the hour is staffed and bookable
  });

  test('applies red color for gap slots', () => {
    const slots: HourSlot[] = [{ hour: 9, status: 'gap' }];
    const { container } = render(<CoverageBar slots={slots} />);
    const cell = container.querySelector('.flex.w-full.rounded > div');
    expect(cell?.className).toContain('red');
    // WHO: business owner | WHAT: sees red cell for gap hour | WHEN: hour has no staff coverage | WHERE: CoverageBar | WHY: red highlights scheduling gaps that could cause lost revenue from rejected bookings
  });

  test('applies gray color for closed slots', () => {
    const slots: HourSlot[] = [{ hour: 9, status: 'closed' }];
    const { container } = render(<CoverageBar slots={slots} />);
    const cell = container.querySelector('.flex.w-full.rounded > div');
    expect(cell?.className).toContain('gray');
    // WHO: business owner | WHAT: sees gray cell for closed hour | WHEN: business is closed that hour | WHERE: CoverageBar | WHY: gray distinguishes intentionally closed hours from accidental gaps
  });

  test('shows hour labels by default', () => {
    const slots: HourSlot[] = [
      { hour: 8, status: 'covered' },
      { hour: 9, status: 'covered' },
    ];
    render(<CoverageBar slots={slots} />);
    expect(screen.getByText('8a')).toBeInTheDocument();
    expect(screen.getByText('9a')).toBeInTheDocument();
    // WHO: business owner | WHAT: sees hour labels below bar | WHEN: default rendering | WHERE: CoverageBar | WHY: labels let owners identify exactly which hours are covered or have gaps
  });

  test('hides hour labels when showHourLabels is false', () => {
    const slots: HourSlot[] = [{ hour: 8, status: 'covered' }];
    render(<CoverageBar slots={slots} showHourLabels={false} />);
    expect(screen.queryByText('8a')).toBeNull();
    // WHO: developer | WHAT: hides hour labels via prop | WHEN: compact layout needs no labels | WHERE: CoverageBar | WHY: embedded uses like SetupWizard need a slimmer bar without redundant labels
  });

  test('tooltip includes employee names when provided', () => {
    const slots: HourSlot[] = [
      {
        hour: 9,
        status: 'covered',
        employees: [
          { id: '1', name: 'Mike' },
          { id: '2', name: 'Steve' },
        ],
      },
    ];
    const { container } = render(<CoverageBar slots={slots} />);
    const cell = container.querySelector('.flex.w-full.rounded > div');
    expect(cell?.getAttribute('title')).toContain('Mike');
    expect(cell?.getAttribute('title')).toContain('Steve');
    // WHO: business owner | WHAT: hovers to see employee names in tooltip | WHEN: hour has assigned staff | WHERE: CoverageBar | WHY: owner needs to know which specific employees cover each hour for scheduling decisions
  });

  test('tooltip shows status only when no employees provided', () => {
    const slots: HourSlot[] = [{ hour: 14, status: 'gap' }];
    const { container } = render(<CoverageBar slots={slots} />);
    const cell = container.querySelector('.flex.w-full.rounded > div');
    const title = cell?.getAttribute('title') || '';
    expect(title).toContain('2p');
    expect(title).toContain('gap');
    expect(title).not.toContain('(');
    // WHO: business owner | WHAT: hovers gap slot with no employees | WHEN: hour is uncovered | WHERE: CoverageBar | WHY: tooltip must show gap status without empty employee list to avoid confusing display
  });

  test('formats noon and midnight correctly', () => {
    const slots: HourSlot[] = [
      { hour: 0, status: 'closed' },
      { hour: 12, status: 'covered' },
    ];
    const { container } = render(<CoverageBar slots={slots} />);
    const cells = container.querySelectorAll('.flex.w-full.rounded > div');
    expect(cells[0].getAttribute('title')).toContain('12a');
    expect(cells[1].getAttribute('title')).toContain('12p');
    // WHO: business owner | WHAT: views midnight and noon slots | WHEN: 24hr schedule includes edge hours | WHERE: CoverageBar | WHY: 12a/12p must display correctly or owners misread AM/PM boundaries
  });

  test('skips every other label when more than 12 slots', () => {
    const slots: HourSlot[] = Array.from({ length: 14 }, (_, i) => ({
      hour: 6 + i,
      status: 'covered' as const,
    }));
    render(<CoverageBar slots={slots} />);
    // Odd-indexed slots should have empty labels
    expect(screen.queryByText('7a')).toBeNull(); // index 1, skipped
    expect(screen.getByText('8a')).toBeInTheDocument(); // index 2, shown
    // WHO: business owner | WHAT: views bar with 14+ hour slots | WHEN: long business day schedule | WHERE: CoverageBar | WHY: skipping alternating labels prevents overlap and keeps the bar readable at narrow widths
  });

  test('applies custom className', () => {
    const slots: HourSlot[] = [{ hour: 8, status: 'covered' }];
    const { container } = render(<CoverageBar slots={slots} className="my-4" />);
    expect(container.firstChild).toHaveClass('my-4');
    // WHO: developer | WHAT: passes custom className to CoverageBar | WHEN: bar used in different layout contexts | WHERE: CoverageBar | WHY: parent containers need to control spacing without modifying internal component styles
  });
});
