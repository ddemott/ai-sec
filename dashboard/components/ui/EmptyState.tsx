'use client';

import React from 'react';

interface EmptyStateProps {
  /** Optional Lucide icon — rendered above the title at 40px when provided */
  icon?: React.ElementType;
  /** Required primary message — what's missing */
  title: string;
  /** Optional secondary message — why it's missing or what to do about it */
  description?: string;
  /** Optional CTA — typically an "Add X" button */
  action?: React.ReactNode;
  /**
   * Visual density. 'centered' (default) fills the parent vertically and
   * centers — for entire empty views (zero customers, zero appointments).
   * 'compact' is a tighter inline block — for empty sections within
   * larger views (e.g. "No services supported" inside a row).
   */
  variant?: 'centered' | 'compact';
  /** Optional extra classes on the outer wrapper */
  className?: string;
  /** Optional data-testid for E2E hooks */
  'data-testid'?: string;
}

/**
 * EmptyState — the canonical "nothing here yet" affordance.
 *
 * Before E2 (2026-05-17) every view rolled its own copy + layout, so
 * "No customers yet" / "No staff to display" / "Nothing booked for today
 * yet" all had different fonts, colors, spacing, and CTA conventions.
 * That made the dashboard feel patchwork — H4 (consistency and standards)
 * violation. EmptyState consolidates the pattern: icon (optional) +
 * title + description (optional) + CTA (optional), all sized and
 * coloured against the CSS theme vars.
 *
 * When to use which variant:
 *   - `centered`: the WHOLE view has no data — vertically centered in the
 *     parent, used as the only thing rendered.
 *   - `compact`: an empty inline state inside a larger context (e.g.,
 *     "No services supported by this resource" inside a row that
 *     otherwise renders normally).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'centered',
  className,
  'data-testid': dataTestId,
}: EmptyStateProps) {
  const wrapperClass =
    variant === 'centered'
      ? `flex-1 flex items-center justify-center py-8 ${className ?? ''}`
      : `text-center py-4 ${className ?? ''}`;

  return (
    <div className={wrapperClass} data-testid={dataTestId}>
      <div className="text-center max-w-sm">
        {Icon && (
          <Icon
            className={variant === 'centered' ? 'w-10 h-10 mx-auto mb-3' : 'w-6 h-6 mx-auto mb-2'}
            style={{ color: 'var(--text-muted)' }}
            aria-hidden="true"
          />
        )}
        <p
          className={variant === 'centered' ? 'text-sm font-medium' : 'text-xs font-medium'}
          style={{ color: 'var(--text-secondary)' }}
        >
          {title}
        </p>
        {description && (
          <p
            className={variant === 'centered' ? 'text-xs mt-1' : 'text-[10px] mt-0.5'}
            style={{ color: 'var(--text-muted)' }}
          >
            {description}
          </p>
        )}
        {action && <div className="mt-3 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
