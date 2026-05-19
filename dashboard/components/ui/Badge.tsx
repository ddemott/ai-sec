import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'primary', className = '' }) => {
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
      color: 'var(--accent-soft)',
    },
    secondary: { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' },
    success: { backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80' },
    danger: { backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171' },
    warning: { backgroundColor: 'rgba(234,179,8,0.15)', color: '#facc15' },
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest inline-block ${className}`}
      style={variantStyles[variant]}
    >
      {children}
    </span>
  );
};
