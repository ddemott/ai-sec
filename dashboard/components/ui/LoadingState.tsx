'use client'

import React from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Single loading-state primitive (UX audit Design 4.4 row 1).
 *
 * Before: Home used `animate-pulse text-gray-400`, Login used a
 * spinner-with-text inline, SuperAdminDashboard used RefreshCw +
 * italic, KB used a bare Loader2 with the right styling but no
 * label. Every consumer rolled its own — same idea, four shapes.
 *
 * After: one component, three sizes, optional message.
 *
 * Sizes:
 *   inline — for buttons / chips. 12px spinner, no message space.
 *            Use when the component itself already provides the
 *            label (e.g. <Button isLoading />).
 *   sm     — for card-internal loading. 16px spinner + small label.
 *   md     — for full-pane loading. 24px spinner + medium label.
 *
 * Centered by default; pass `centered={false}` for left-aligned use.
 */

interface LoadingStateProps {
  size?: 'inline' | 'sm' | 'md'
  /** Loading label. Defaults to "Loading…" — pass a tenant- or
      tab-specific phrase for context ("Loading schedule…"). */
  message?: string
  /** Center horizontally + vertically. Default true. Pass false for
      inline / left-aligned use inside dense layouts. */
  centered?: boolean
  className?: string
}

const SIZE_CONFIG = {
  inline: { icon: 'w-3 h-3', text: 'text-xs', gap: 'gap-1.5', padding: 'p-0' },
  sm:     { icon: 'w-4 h-4', text: 'text-sm', gap: 'gap-2',   padding: 'p-4' },
  md:     { icon: 'w-6 h-6', text: 'text-base', gap: 'gap-3', padding: 'p-8' },
} as const

export const LoadingState: React.FC<LoadingStateProps> = ({
  size = 'md',
  message = 'Loading…',
  centered = true,
  className = '',
}) => {
  const cfg = SIZE_CONFIG[size]
  const layout = centered
    ? `flex items-center justify-center ${cfg.padding}`
    : `inline-flex items-center ${cfg.padding}`

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${layout} ${cfg.gap} ${className}`}
      style={{ color: 'var(--text-muted)' }}
    >
      <Loader2 className={`${cfg.icon} animate-spin`} aria-hidden="true" />
      {size !== 'inline' && (
        <span className={`${cfg.text} font-medium`}>{message}</span>
      )}
      {size === 'inline' && (
        <span className="sr-only">{message}</span>
      )}
    </div>
  )
}
