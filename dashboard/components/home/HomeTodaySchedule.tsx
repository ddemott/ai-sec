'use client';

/**
 * "Today's Schedule" card on the Home tab.
 * Shows today's booked appointments or an empty-state prompt.
 * Extracted from DashboardHome.tsx (dense-view decomposition).
 */

import React from 'react';
import { Clock, ChevronRight, Plus, Calendar, Users } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import type { Tab } from '../../app/dashboard/page';

interface TodayAppointment {
  appointment_id: string;
  start_time: string;
  end_time?: string;
  status: string;
  description?: string;
  customer_name?: string;
  customers?: { name?: string; first_name?: string; last_name?: string; phone?: string };
  resources?: { name?: string };
}

interface HomeTodayScheduleProps {
  appointments: TodayAppointment[];
  loading: boolean;
  needsSetup: boolean;
  hasMultipleEmployees: boolean;
  vocab: { booking_label: string };
  onNavigate?: (tab: Tab) => void;
  onNewBooking: () => void;
}

export function HomeTodaySchedule({
  appointments,
  loading,
  needsSetup,
  hasMultipleEmployees,
  vocab,
  onNavigate,
  onNewBooking,
}: HomeTodayScheduleProps) {
  const todayDate = new Date();
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
  const todayAppointments = appointments
    .filter((a) => a.status === 'scheduled' && a.start_time.startsWith(todayStr))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <Card>
      <button
        type="button"
        onClick={() => onNavigate?.('schedule')}
        aria-label="View full schedule"
        className="w-full flex items-center justify-between mb-4 rounded-md transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2 group"
        style={{ '--tw-ring-color': 'var(--accent-glow)' } as React.CSSProperties}
      >
        <h2
          className="font-semibold flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <Clock className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} aria-hidden="true" />
          Today&apos;s Schedule
        </h2>
        <span
          className="text-xs flex items-center gap-1 group-hover:underline"
          style={{ color: 'var(--accent-soft)' }}
        >
          Full schedule <ChevronRight className="w-3 h-3" aria-hidden="true" />
        </span>
      </button>

      {todayAppointments.length === 0 ? (
        <div className="py-4 text-center">
          <Calendar
            className="w-8 h-8 mx-auto mb-2 opacity-30"
            style={{ color: 'var(--accent-soft)' }}
            aria-hidden="true"
          />
          <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
            Nothing booked for today yet.
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={onNewBooking}
              disabled={loading || needsSetup}
              aria-label="Book the first appointment for today"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              New Booking
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onNavigate?.('schedule')}>
              <Calendar className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              View this week
            </Button>
            {hasMultipleEmployees && (
              <Button variant="secondary" size="sm" onClick={() => onNavigate?.('setup')}>
                <Users className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                See staff shifts
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {todayAppointments.map((appt) => {
            const startTime = new Date(appt.start_time);
            const endTime = appt.end_time ? new Date(appt.end_time) : null;
            const customerName = appt.customers
              ? [appt.customers.first_name, appt.customers.last_name].filter(Boolean).join(' ') ||
                appt.customers.name
              : appt.customer_name;
            return (
              <div
                key={appt.appointment_id}
                className="flex items-center gap-3 p-3 rounded-lg border"
                style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
              >
                <div className="text-right" style={{ minWidth: '5.5rem' }}>
                  <div className="text-sm font-bold" style={{ color: 'var(--accent-soft)' }}>
                    {startTime.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </div>
                  {endTime && (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      to{' '}
                      {endTime.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </div>
                  )}
                </div>
                <div className="w-px h-8 rounded" style={{ backgroundColor: 'var(--accent)' }} />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {appt.description || vocab.booking_label}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {customerName || 'Walk-in'}
                    {appt.resources?.name && ` · ${appt.resources.name}`}
                  </div>
                </div>
              </div>
            );
          })}
          {todayAppointments.length > 10 && (
            <button
              className="text-xs text-center pt-1 w-full hover:underline cursor-pointer"
              style={{ color: 'var(--accent)' }}
              onClick={() => onNavigate?.('schedule')}
            >
              +{todayAppointments.length - 10} more — view schedule
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
