'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';

/**
 * Shared shell for the scheduler's right-edge slide-in drawers (Quick Book,
 * Employee Day Focus). Owns the fixed drawer container, the slide-in
 * animation, the header chrome (icon + title + close button), the scrolling
 * body wrapper, and an optional sticky footer.
 *
 * Extracted from QuickBookPanel + EmployeeDayFocusPanel, which had byte-for-
 * byte-identical outer container + header markup (docs/IMPROVEMENT_IDEAS.md).
 * The bits that legitimately differ between callers are props so each keeps
 * its exact behavior:
 *  - `titleId` present → the drawer is exposed as role="dialog" labelled by
 *    the title (Employee Focus is a dialog; Quick Book intentionally is not).
 *  - `containerRef` is forwarded to the outer element for a focus trap.
 *  - `bodyClassName` adds padding/spacing to the scroll area (Quick Book uses
 *    `p-4 space-y-4`; Employee Focus's children own their own padding).
 *  - `footer` renders a sticky footer (Quick Book's Book-Now CTA).
 */
export interface SchedulerSidePanelProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
  /** When set, the drawer is role="dialog" labelled by this id (put on the title). */
  titleId?: string;
  /** Forwarded to the outer drawer element (e.g. for useFocusTrap). */
  containerRef?: React.Ref<HTMLDivElement>;
  dataTestId?: string;
  /** Extra classes on the scrolling body (e.g. `p-4 space-y-4`). */
  bodyClassName?: string;
  /** Optional sticky footer (e.g. a primary CTA). */
  footer?: React.ReactNode;
}

export function SchedulerSidePanel({
  icon,
  title,
  onClose,
  closeLabel,
  children,
  titleId,
  containerRef,
  dataTestId,
  bodyClassName,
  footer,
}: SchedulerSidePanelProps) {
  return (
    <div
      ref={containerRef}
      {...(titleId ? { role: 'dialog', 'aria-labelledby': titleId } : {})}
      className="fixed inset-y-0 right-0 w-full sm:w-96 shadow-2xl border-l z-30 flex flex-col animate-in slide-in-from-right duration-200"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-soft)' }}
      data-testid={dataTestId}
    >
      <header
        className="px-4 py-3 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--border-soft)' }}
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 id={titleId} className="font-bold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>
          <X className="w-4 h-4" />
        </Button>
      </header>

      <div className={`flex-1 overflow-y-auto${bodyClassName ? ` ${bodyClassName}` : ''}`}>
        {children}
      </div>

      {footer}
    </div>
  );
}
