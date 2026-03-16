import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'primary',
  className = '',
}) => {
  const variants = {
    primary: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
    secondary: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
    success: 'bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400',
    danger: 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400',
    warning: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-600 dark:text-yellow-400',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest inline-block ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};
