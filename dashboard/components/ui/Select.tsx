import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { label: string; value: string | number }[];
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  options,
  className = '',
  id,
  ...props
}) => {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
      )}
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && id ? `${id}-error` : undefined}
        className={`w-full p-2.5 border rounded-lg outline-none text-sm font-bold transition focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M5%207L10%2012L15%207%22%20stroke%3D%22%236B7280%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E')] bg-[length:20px_20px] bg-[right_10px_center] bg-no-repeat pr-10 ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : ''} ${className}`}
        style={{
          backgroundColor: 'var(--input-bg)',
          borderColor: error ? undefined : 'var(--border)',
          color: 'var(--text-primary)',
        }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={id ? `${id}-error` : undefined} role="alert" className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  );
};
