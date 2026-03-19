import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'info' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  loading?: boolean;
  icon?: React.ElementType;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading,
  loading,
  icon: Icon,
  className = '',
  disabled,
  ...props
}) => {
  const activeLoading = isLoading || loading;
  const baseStyles = 'inline-flex items-center justify-center font-bold transition-all duration-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variants = {
    primary: 'shadow-sm border border-transparent',
    secondary: 'border',
    danger: 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/40 hover:bg-red-100 dark:hover:bg-red-900/40',
    success: 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-900/40 hover:bg-green-100 dark:hover:bg-green-900/40',
    info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/40',
    warning: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-600 hover:bg-yellow-200 dark:hover:bg-yellow-800',
    ghost: 'bg-transparent',
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: 'var(--primary)', color: 'var(--primary-text)' },
    secondary: { backgroundColor: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' },
    ghost: { color: 'var(--text-secondary)' },
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      style={variantStyles[variant]}
      disabled={disabled || activeLoading}
      aria-busy={activeLoading || undefined}
      {...props}
    >
      {activeLoading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {!activeLoading && Icon && <Icon className="w-4 h-4 mr-2" />}
      {children}
    </button>
  );
};
