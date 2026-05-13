import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  isSameDayInTimeZone,
  makeNoonUtcDateFromCalendar,
  relativeCalendarDays,
} from '../../lib/dateInTimeZone';

interface SchedulerDateNavProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  /**
   * Optional tenant IANA timezone (e.g., `America/Chicago`). When provided,
   * today/yesterday/tomorrow are computed in that timezone — so a Los
   * Angeles admin reviewing a Chicago tenant at 11pm PST sees the chips
   * track Chicago's calendar, not LA's. Falls back to browser local time
   * when unset (the SchedulerView passes `undefined` while
   * `useTenantTimezone()` is still loading; we don't want to flash empty
   * state on initial render).
   */
  tenantTimezone?: string;
}

function formatDate(date: Date, timeZone?: string): string {
  return date.toLocaleDateString('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// WCAG 2.1 AA Success Criterion 2.5.5 (Target Size) requires touch targets
// to be at least 44×44 CSS pixels. The audit's R2.2 specified 48×48 — round
// up so chip taps are reliable on phones (mobile front-desk use was an
// audit theme).
const TOUCH_TARGET = 'min-w-[48px] min-h-[48px]';

export const SchedulerDateNav: React.FC<SchedulerDateNavProps> = ({ selectedDate, onDateChange, tenantTimezone }) => {
  // Two branches: tenant-TZ-aware (preferred) vs the legacy browser-TZ
  // computation. The legacy branch is preserved so a tenant whose config
  // hasn't loaded yet (or whose timezone column is somehow NULL) still
  // sees a working date-nav. Switching on `tenantTimezone` truthiness keeps
  // the prop optional + backwards-compatible with the 500+ existing
  // scheduler tests.
  let yesterday: Date;
  let today: Date;
  let tomorrow: Date;
  let isYesterday: boolean;
  let isToday: boolean;
  let isTomorrow: boolean;

  if (tenantTimezone) {
    const rels = relativeCalendarDays(new Date(), tenantTimezone);
    yesterday = makeNoonUtcDateFromCalendar(rels.yesterday);
    today = makeNoonUtcDateFromCalendar(rels.today);
    tomorrow = makeNoonUtcDateFromCalendar(rels.tomorrow);
    isYesterday = isSameDayInTimeZone(selectedDate, yesterday, tenantTimezone);
    isToday = isSameDayInTimeZone(selectedDate, today, tenantTimezone);
    isTomorrow = isSameDayInTimeZone(selectedDate, tomorrow, tenantTimezone);
  } else {
    today = startOfDay(new Date());
    yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    isYesterday = isSameDay(selectedDate, yesterday);
    isToday = isSameDay(selectedDate, today);
    isTomorrow = isSameDay(selectedDate, tomorrow);
  }

  const goToPrev = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    onDateChange(prev);
  };

  const goToNext = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    onDateChange(next);
  };

  return (
    <div className="flex items-center gap-3" data-testid="scheduler-date-nav">
      <Button variant="ghost" size="sm" onClick={goToPrev} aria-label="Previous day" className={TOUCH_TARGET}>
        <ChevronLeft className="w-4 h-4" />
      </Button>

      {/* Yesterday | Today | Tomorrow chips (audit P2 #6, 2026-05-07).
          Three of the most common date jumps for a front-desk operator —
          direct affordances eliminate the < arrow tap-tap-tap or the
          mental math of "what was yesterday's date." Each meets WCAG
          2.5.5 with a 48×48 minimum touch target. */}
      <Button
        variant={isYesterday ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => onDateChange(yesterday)}
        className={TOUCH_TARGET}
        aria-pressed={isYesterday}
        data-testid="date-chip-yesterday"
      >
        Yesterday
      </Button>
      <Button
        variant={isToday ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => onDateChange(today)}
        className={TOUCH_TARGET}
        aria-pressed={isToday}
        data-testid="date-chip-today"
      >
        Today
      </Button>
      <Button
        variant={isTomorrow ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => onDateChange(tomorrow)}
        className={TOUCH_TARGET}
        aria-pressed={isTomorrow}
        data-testid="date-chip-tomorrow"
      >
        Tomorrow
      </Button>

      <Button variant="ghost" size="sm" onClick={goToNext} aria-label="Next day" className={TOUCH_TARGET}>
        <ChevronRight className="w-4 h-4" />
      </Button>
      <span className="text-sm font-bold text-gray-900 dark:text-gray-100" data-testid="scheduler-date-display">
        {formatDate(selectedDate, tenantTimezone)}
      </span>
    </div>
  );
};
