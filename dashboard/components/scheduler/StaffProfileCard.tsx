import React, { useEffect, useRef } from 'react';
import type { Employee } from '../../lib/types';
import { useVocabulary } from '@/lib/VocabularyContext';

export interface StaffProfileCardProps {
  employee: Employee;
  /** Number of appointments today */
  todayApptCount: number;
  /** Total hours booked today */
  todayHours: number;
  /** Shift start time string (e.g. "7am") or null if no shift */
  shiftStart: string | null;
  /** Shift end time string (e.g. "4pm") or null if no shift */
  shiftEnd: string | null;
  /** Skills derived from service-employee mappings (single source of truth) */
  skills?: string[];
  /** Anchor element rect for positioning */
  anchorRect: DOMRect;
  /** Called when user clicks outside the card */
  onClose: () => void;
}

export function StaffProfileCard({
  employee,
  todayApptCount,
  todayHours,
  shiftStart,
  skills,
  shiftEnd,
  anchorRect,
  onClose,
}: StaffProfileCardProps) {
  const vocab = useVocabulary();
  const cardRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click or Escape key
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // Delay click listener to avoid catching the click that opened the card
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Position: below the anchor, or above if near bottom
  const cardWidth = 260;
  const cardEstHeight = 260;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

  const spaceBelow = viewportHeight - anchorRect.bottom;
  const positionAbove = spaceBelow < cardEstHeight && anchorRect.top > cardEstHeight;

  const top = positionAbove
    ? anchorRect.top - cardEstHeight - 4
    : anchorRect.bottom + 4;
  const left = Math.max(8, anchorRect.left);

  // Generate initials for avatar
  const initials = employee.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const hoursLabel = todayHours === 1 ? '1 hr' : `${todayHours} hrs`;

  return (
    <div
      ref={cardRef}
      data-testid="staff-profile-card"
      className="fixed z-50 rounded-lg shadow-xl"
      style={{
        top,
        left,
        width: cardWidth,
        background: 'var(--bg-raised, #2a2a2a)',
        border: '1px solid var(--border-soft, #444)',
        fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
        color: 'var(--text-primary, #fff)',
      }}
    >
      {/* Header: avatar + name + role */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{
            background: 'var(--accent-muted, rgba(59,130,246,0.15))',
            color: 'var(--accent, #3b82f6)',
          }}
          data-testid="staff-avatar"
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div
            className="text-sm font-bold truncate"
            style={{ color: 'var(--text-primary, #fff)' }}
            title={employee.name}
            data-testid="staff-card-name"
          >
            {employee.name}
          </div>
          <div
            className="text-xs truncate"
            style={{ color: 'var(--text-muted, #888)' }}
            data-testid="staff-card-role"
          >
            {employee.type === 'user' ? 'Admin' : vocab.employee_label}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border-soft, #333)', margin: '0 16px' }} />

      {/* Today + Shift stats */}
      <div className="px-4 py-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted, #888)' }}>Today</span>
          <span style={{ color: 'var(--text-secondary, #aaa)' }} data-testid="staff-card-today">
            {todayApptCount} appts &middot; {hoursLabel}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted, #888)' }}>Shift</span>
          <span style={{ color: 'var(--text-secondary, #aaa)' }} data-testid="staff-card-shift">
            {shiftStart && shiftEnd ? `${shiftStart} – ${shiftEnd}` : 'No shift today'}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border-soft, #333)', margin: '0 16px' }} />

      {/* Skills */}
      <div className="px-4 pt-3 pb-4">
        <div
          className="text-[10px] font-semibold tracking-wider uppercase mb-1.5"
          style={{
            color: 'var(--text-muted, #888)',
            fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
          }}
          data-testid="staff-card-skills-label"
        >
          Skills
        </div>
        {skills && skills.length > 0 ? (
          <ul className="flex flex-col gap-0.5" data-testid="staff-card-skills-list">
            {skills.map((skill, i) => (
              <li
                key={i}
                className="text-xs pl-3"
                style={{ color: 'var(--text-secondary, #aaa)' }}
              >
                {skill}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs pl-3" style={{ color: 'var(--text-muted, #666)' }}>
            No skills assigned
          </div>
        )}
      </div>
    </div>
  );
}
