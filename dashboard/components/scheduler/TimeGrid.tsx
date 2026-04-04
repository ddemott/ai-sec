import React from 'react';
import { formatHourLabel } from '../../lib/utils';

interface TimeGridProps {
  startHour?: number;
  endHour?: number;
  hourWidth?: number;
}

export const SCHEDULER_START_HOUR = 0;
export const SCHEDULER_END_HOUR = 24;
export const LABEL_WIDTH = 140;

export const TimeGrid: React.FC<TimeGridProps> = ({
  startHour = SCHEDULER_START_HOUR,
  endHour = SCHEDULER_END_HOUR,
  hourWidth = 60,
}) => {
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) {
    hours.push(h);
  }

  return (
    <div
      className="flex border-b border-gray-200 dark:border-gray-800"
      style={{ minWidth: LABEL_WIDTH + hours.length * hourWidth }}
      data-testid="time-grid"
    >
      <div
        className="p-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase border-r border-gray-200 dark:border-gray-800 shrink-0"
        style={{ width: LABEL_WIDTH }}
      />
      {hours.map((h) => (
        <div
          key={h}
          className="p-2 text-xs font-bold text-gray-400 dark:text-gray-500 text-center border-r border-gray-100 dark:border-gray-800 last:border-r-0 shrink-0"
          style={{ width: hourWidth }}
        >
          {formatHourLabel(h)}
        </div>
      ))}
    </div>
  );
};

export { formatHourLabel };
