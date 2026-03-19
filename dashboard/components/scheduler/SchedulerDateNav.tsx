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

export const SchedulerDateNav: React.FC<SchedulerDateNavProps> = ({ selectedDate, onDateChange }) => {
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

  const goToToday = () => {
    onDateChange(new Date());
  };

  const isToday = isSameDay(selectedDate, new Date());

  return (
    <div className="flex items-center gap-3" data-testid="scheduler-date-nav">
      <Button variant="ghost" size="sm" onClick={goToPrev} aria-label="Previous day">
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <Button variant={isToday ? 'primary' : 'secondary'} size="sm" onClick={goToToday}>
        Today
      </Button>
      <Button variant="ghost" size="sm" onClick={goToNext} aria-label="Next day">
        <ChevronRight className="w-4 h-4" />
      </Button>
      <span className="text-sm font-bold text-gray-900 dark:text-gray-100" data-testid="scheduler-date-display">
        {formatDate(selectedDate)}
      </span>
    </div>
  );
};
