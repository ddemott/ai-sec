import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = '',
  id: externalId,
  ...props
}) => {
  const autoId = useId();
  const id = externalId || (label ? autoId : undefined);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && id ? `${id}-error` : undefined}
        className={`w-full p-2.5 border rounded-lg outline-none text-sm font-bold transition focus:ring-2 ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : 'focus:ring-[var(--accent-glow)] focus:border-[var(--accent)]'} ${className}`}
        style={{
          backgroundColor: 'var(--input-bg)',
          borderColor: error ? undefined : 'var(--border)',
          color: 'var(--text-primary)',
        }}
        {...props}
      />
      {error && (
        <p id={id ? `${id}-error` : undefined} role="alert" className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
    </div>
  );
};
