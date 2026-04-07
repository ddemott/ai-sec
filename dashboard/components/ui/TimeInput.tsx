import React from 'react'

interface TimeInputProps {
  label?: string
  value: string
  onChange: (value: string) => void
  className?: string
}

export const TimeInput: React.FC<TimeInputProps> = ({
  label,
  value,
  onChange,
  className = '',
}) => (
  <div className={className}>
    {label && (
      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">
        {label}
      </label>
    )}
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border-none rounded-xl p-3 text-sm font-bold"
      style={{
        backgroundColor: 'var(--bg-raised)',
        color: 'var(--text-primary)',
        colorScheme: 'dark',
      }}
    />
  </div>
)
