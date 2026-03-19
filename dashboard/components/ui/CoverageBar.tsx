import React from 'react';

type SlotStatus = 'covered' | 'gap' | 'closed';

interface SlotEmployee {
  id: string;
  name: string;
}

interface HourSlot {
  hour: number;
  status: SlotStatus;
  employees?: SlotEmployee[];
}

interface CoverageBarProps {
  slots: HourSlot[];
  height?: number;
  showHourLabels?: boolean;
  className?: string;
}

const slotColors: Record<SlotStatus, string> = {
  covered: 'bg-green-400 dark:bg-green-500/70',
  gap: 'bg-red-200 dark:bg-red-900/40',
  closed: 'bg-gray-100 dark:bg-gray-800',
};

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export type { HourSlot, SlotStatus, SlotEmployee };

export const CoverageBar: React.FC<CoverageBarProps> = ({
  slots,
  height = 24,
  showHourLabels = true,
  className = '',
}) => {
  if (slots.length === 0) {
    return (
      <div className={className}>
        <div
          className="w-full rounded bg-gray-200 dark:bg-gray-700"
          style={{ height }}
        />
        {showHourLabels && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No scheduled hours</p>
        )}
      </div>
    );
  }

  const sorted = [...slots].sort((a, b) => a.hour - b.hour);
  const skipEveryOther = sorted.length > 12;

  return (
    <div className={className}>
      <div className="flex w-full rounded overflow-hidden" style={{ height }}>
        {sorted.map((slot, i) => (
          <div
            key={slot.hour}
            className={`flex-1 ${slotColors[slot.status]} ${i > 0 ? 'border-l border-white/20 dark:border-gray-900/40' : ''}`}
            title={`${formatHour(slot.hour)}–${formatHour(slot.hour + 1)}: ${slot.status}${slot.employees?.length ? ` (${slot.employees.map(e => e.name).join(', ')})` : ''}`}
          />
        ))}
      </div>
      {showHourLabels && (
        <div className="flex w-full mt-0.5">
          {sorted.map((slot, i) => (
            <span
              key={slot.hour}
              className="flex-1 text-[9px] text-gray-400 dark:text-gray-500 text-center"
            >
              {skipEveryOther && i % 2 !== 0 ? '' : formatHour(slot.hour)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
