import React from 'react';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'success' | 'info' | 'dark';
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  icon,
  className = '',
  variant = 'default',
  onClick,
}) => {
  const variants = {
    default: 'bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100',
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

  return (
    <div 
      className={`p-6 rounded-2xl border shadow-sm ${variants[variant]} ${className}`}
      onClick={onClick}
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
