import React, { useId } from 'react'

interface TimeInputProps {
  label?: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
  className?: string
}

export const TimeInput: React.FC<TimeInputProps> = ({
  label,
  value,
  onChange,
  error,
  disabled,
  className = '',
}) => {
  const autoId = useId()

  return (
    <div className={className}>
      {label && (
        <label htmlFor={autoId} className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">
          {label}
        </label>
      )}
      <input
        id={autoId}
        type="time"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={`w-full border-none rounded-xl p-3 text-sm font-bold ${error ? 'ring-2 ring-red-500/30' : ''}`}
        style={{
          backgroundColor: 'var(--bg-raised)',
          color: 'var(--text-primary)',
          colorScheme: 'var(--color-scheme, dark)',
        }}
      />
      {error && (
        <p className="text-xs mt-1" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
    </div>
  )
}
