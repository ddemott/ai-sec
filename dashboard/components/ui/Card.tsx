import React from 'react';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  children: React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'success' | 'info' | 'dark';
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  icon,
  className = '',
  style,
  variant = 'default',
  onClick,
  role,
  tabIndex,
  onKeyDown,
  ...rest
}) => {
  const variants = {
    default: 'border text-inherit',
    success:
      'bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/40 text-green-900 dark:text-green-100',
    info: 'border',
    dark: 'border-transparent text-white',
  };

  const titleColors = {
    default: 'text-gray-400 dark:text-gray-500',
    success: 'text-green-800 dark:text-green-500',
    info: '',
    dark: '',
  };

  const defaultStyle =
    variant === 'default'
      ? {
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }
      : undefined;

  const variantInlineStyles: React.CSSProperties | undefined =
    variant === 'info'
      ? {
          backgroundColor: 'var(--accent-muted)',
          borderColor: 'var(--accent-muted)',
          color: 'var(--accent-soft)',
        }
      : variant === 'dark'
        ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }
        : undefined;

  return (
    <div
      className={`p-6 rounded-2xl border shadow-sm ${variants[variant]} ${onClick ? 'cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2' : ''} ${className}`}
      style={
        style
          ? { ...defaultStyle, ...variantInlineStyles, ...style }
          : { ...defaultStyle, ...variantInlineStyles }
      }
      onClick={onClick}
      role={role ?? (onClick ? 'button' : undefined)}
      tabIndex={tabIndex ?? (onClick ? 0 : undefined)}
      onKeyDown={
        onKeyDown ??
        (onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
              }
            }
          : undefined)
      }
      {...rest}
    >
      {title && (
        <h3
          className={`font-bold mb-4 flex items-center text-sm uppercase tracking-widest ${titleColors[variant]}`}
        >
          {icon && <span className="mr-2">{icon}</span>}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
};
