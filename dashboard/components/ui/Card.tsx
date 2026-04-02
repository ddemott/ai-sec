import React from 'react';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  variant?: 'default' | 'success' | 'info' | 'dark';
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  icon,
  className = '',
  style,
  variant = 'default',
  onClick,
}) => {
  const variants = {
    default: 'border text-inherit',
    success: 'bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/40 text-green-900 dark:text-green-100',
    info: 'bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40 text-blue-900 dark:text-blue-100',
    dark: 'bg-blue-900 dark:bg-blue-950 border-transparent text-white',
  };

  const titleColors = {
    default: 'text-gray-400 dark:text-gray-500',
    success: 'text-green-800 dark:text-green-500',
    info: 'text-blue-800 dark:text-blue-500',
    dark: 'text-blue-200 dark:text-blue-400',
  };

  const defaultStyle = variant === 'default' ? {
    backgroundColor: 'var(--surface)',
    borderColor: 'var(--border)',
    color: 'var(--text-primary)',
  } : undefined

  return (
    <div
      className={`p-6 rounded-2xl border shadow-sm ${variants[variant]} ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={style ? { ...defaultStyle, ...style } : defaultStyle}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {title && (
        <h3 className={`font-bold mb-4 flex items-center text-sm uppercase tracking-widest ${titleColors[variant]}`}>
          {icon && <span className="mr-2">{icon}</span>}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
};
