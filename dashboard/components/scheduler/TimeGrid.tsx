import React from 'react';

interface TimeGridProps {
  startHour?: number;
  endHour?: number;
}

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export const SCHEDULER_START_HOUR = 7;
export const SCHEDULER_END_HOUR = 20;

export const TimeGrid: React.FC<TimeGridProps> = ({
  startHour = SCHEDULER_START_HOUR,
  endHour = SCHEDULER_END_HOUR,
}) => {
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) {
    hours.push(h);
  }

  return (
    <div
      className="grid border-b border-gray-200 dark:border-gray-800"
      style={{ gridTemplateColumns: `180px repeat(${hours.length}, 1fr)` }}
      data-testid="time-grid"
    >
      <div className="p-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase border-r border-gray-200 dark:border-gray-800" />
      {hours.map((h) => (
        <div
          key={h}
          className="p-2 text-xs font-bold text-gray-400 dark:text-gray-500 text-center border-r border-gray-100 dark:border-gray-800 last:border-r-0"
        >
          {formatHourLabel(h)}
        </div>
      ))}
    </div>
  );
};

export { formatHourLabel };
