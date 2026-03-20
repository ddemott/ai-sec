import React, { useCallback } from 'react';
import { Input } from './Input';

interface PhoneInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  className?: string;
  id?: string;
}

/**
 * Formats digits into +1 (XXX) XXX-XXXX as the user types.
 * Stores the raw digits internally, displays the formatted version.
 */
function formatAsYouType(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (!d) return ''

  // Stored value is always +1XXXXXXXXXX. Strip the leading country code 1.
  const num = d.startsWith('1') ? d.slice(1) : d

  if (num.length === 0) return ''
  if (num.length <= 3) return `+1 (${num}`
  if (num.length <= 6) return `+1 (${num.slice(0, 3)}) ${num.slice(3)}`
  return `+1 (${num.slice(0, 3)}) ${num.slice(3, 6)}-${num.slice(6, 10)}`
}

function toDigits(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  label,
  value,
  onChange,
  placeholder = '+1 (555) 555-5555',
  error,
  className,
  id,
}) => {
  const displayValue = value ? formatAsYouType(value) : ''

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = toDigits(e.target.value)
    // Cap at 11 digits (1 + 10)
    const capped = raw.length > 11 ? raw.slice(0, 11) : raw
    // Store as +1XXXXXXXXXX
    if (capped.length === 0) {
      onChange('')
    } else if (capped.startsWith('1') && capped.length <= 11) {
      onChange(`+${capped}`)
    } else if (capped.length <= 10) {
      onChange(`+1${capped}`)
    } else {
      onChange(`+${capped}`)
    }
  }, [onChange])

  return (
    <Input
      label={label}
      type="tel"
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      error={error}
      className={className}
      id={id}
    />
  )
}
