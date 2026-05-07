import React from 'react'

/**
 * Folder-tab navigation — mimics physical file folder tabs with depth cues.
 * Three sizes map to the app's navigation hierarchy:
 *   lg  = primary navigation tabs
 *   md  = section tabs (Services & Resources, Staff & Shifts, …)
 *   sm  = sub-section tabs (Services, Chairs, Knowledge Base, …)
 */

type FolderTabSize = 'lg' | 'md' | 'sm'

const SIZE_CONFIG: Record<FolderTabSize, {
  activePadding: string
  inactivePadding: string
  radius: string
  fontSize: string
  fontWeight: string
  iconSize: string
  shadowActive: string
  shadowInactive: string
}> = {
  lg: {
    activePadding: '10px 24px 12px',
    inactivePadding: '8px 24px 10px',
    radius: '6px 6px 0 0',
    fontSize: '0.875rem',    // text-sm
    fontWeight: '700',       // font-bold
    iconSize: 'w-4 h-4',
    shadowActive: '0 -3px 10px rgba(0,0,0,0.35), -3px 0 8px rgba(0,0,0,0.2), 3px 0 8px rgba(0,0,0,0.2)',
    shadowInactive: 'inset 0 -1px 3px rgba(0,0,0,0.3)',
  },
  md: {
    activePadding: '8px 16px 10px',
    inactivePadding: '6px 16px 8px',
    radius: '5px 5px 0 0',
    fontSize: '0.75rem',     // text-xs
    fontWeight: '500',       // font-medium
    iconSize: 'w-3.5 h-3.5',
    shadowActive: '0 -2px 6px rgba(0,0,0,0.25), -2px 0 4px rgba(0,0,0,0.15), 2px 0 4px rgba(0,0,0,0.15)',
    shadowInactive: 'inset 0 -1px 3px rgba(0,0,0,0.3)',
  },
  sm: {
    activePadding: '7px 14px 9px',
    inactivePadding: '5px 14px 7px',
    radius: '4px 4px 0 0',
    fontSize: '0.75rem',     // text-xs
    fontWeight: '500',       // font-medium
    iconSize: 'w-3.5 h-3.5',
    shadowActive: '0 -2px 5px rgba(0,0,0,0.2), -2px 0 4px rgba(0,0,0,0.12), 2px 0 4px rgba(0,0,0,0.12)',
    shadowInactive: 'inset 0 -1px 3px rgba(0,0,0,0.3)',
  },
}

// --- FolderTab ---

interface FolderTabProps {
  label: string
  isActive: boolean
  onClick: () => void
  icon?: React.ElementType
  size?: FolderTabSize
}

export const FolderTab: React.FC<FolderTabProps> = ({
  label,
  isActive,
  onClick,
  icon: Icon,
  size = 'md',
}) => {
  const cfg = SIZE_CONFIG[size]

  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={isActive}
      className="flex items-center gap-1.5 transition-all relative focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset outline-none"
      style={{
        color: isActive ? 'var(--accent-soft)' : 'var(--text-muted)',
        backgroundColor: isActive ? 'var(--bg-raised)' : 'var(--bg-base)',
        borderRadius: cfg.radius,
        padding: isActive ? cfg.activePadding : cfg.inactivePadding,
        boxShadow: isActive ? cfg.shadowActive : cfg.shadowInactive,
        zIndex: isActive ? 2 : 1,
        borderTop: isActive ? '2px solid var(--accent)' : '1px solid var(--border-soft)',
        borderLeft: '1px solid var(--border-soft)',
        borderRight: '1px solid var(--border-soft)',
        marginRight: '-1px',
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
      }}
    >
      {Icon && <Icon className={cfg.iconSize} aria-hidden="true" style={{ opacity: isActive ? 1 : 0.5 }} />}
      {label}
    </button>
  )
}

// --- FolderTabBar ---

interface FolderTabBarProps {
  children: React.ReactNode
  /** Extra content aligned to the right (e.g. utility buttons) */
  right?: React.ReactNode
  ariaLabel?: string
  size?: FolderTabSize
}

export const FolderTabBar: React.FC<FolderTabBarProps> = ({
  children,
  right,
  ariaLabel = 'Navigation',
  size = 'md',
}) => {
  const bg = size === 'lg' ? 'var(--bg-surface)' : 'var(--bg-surface)'

  return (
    <div
      className="shrink-0 transition-colors duration-200"
      style={{
        backgroundColor: bg,
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      <div className="flex items-center justify-between px-4">
        <div
          className="flex items-end gap-0 pt-1"
          role="tablist"
          aria-label={ariaLabel}
          style={{ paddingTop: size === 'lg' ? '8px' : '4px' }}
        >
          {children}
        </div>
        {right && <div className="flex items-center gap-1">{right}</div>}
      </div>
    </div>
  )
}
