import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';

interface SchedulerDateNavProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
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

export const SchedulerDateNav: React.FC<SchedulerDateNavProps> = ({ selectedDate, onDateChange }) => {
  const today = startOfDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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

  const isYesterday = isSameDay(selectedDate, yesterday);
  const isToday = isSameDay(selectedDate, today);
  const isTomorrow = isSameDay(selectedDate, tomorrow);

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
        {formatDate(selectedDate)}
      </span>
    </div>
  );
};
