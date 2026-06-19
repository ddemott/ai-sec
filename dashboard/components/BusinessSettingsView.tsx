'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Calendar,
  ExternalLink,
  Unlink,
  CheckCircle2,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { Api } from '../lib/api';
import { CRMIntegrationCard } from './CRMIntegrationCard';
import BusinessTypeSection from './BusinessTypeSection';
import { useStaticData } from '../lib/hooks';
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary, useVocabularyRefresh } from '@/lib/VocabularyContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import type { EffectiveShift } from '../lib/types';
import { ConfirmModal } from './ui/ConfirmModal';
import { useConfirm } from '../lib/useConfirm';

export default function BusinessSettingsView() {
  const tenantId = useActiveTenantId();
  const { services, employees, loading: staticLoading } = useStaticData(tenantId);
  const vocab = useVocabulary();
  const refreshVocabulary = useVocabularyRefresh();

  const [teamSize, setTeamSize] = useState<number | null>(null);
  const { state: confirmState, close: closeConfirm } = useConfirm();

  // Availability
  const [shifts, setShifts] = useState<EffectiveShift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);

  // Calendar State
  const [calendarSettings, setCalendarSettings] = useState<{
    provider: string;
    external_calendar_id: string;
  } | null>(null);
  const [calLoading, setCalLoading] = useState(false);

  const isSolo = teamSize === 1;
  const soloEmployee = isSolo ? employees[0] : null;

  useEffect(() => {
    if (tenantId) {
      void fetchCalendarSettings();
      void fetchTenantConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (isSolo && soloEmployee && tenantId) {
      void fetchShifts(soloEmployee.employee_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSolo, soloEmployee?.employee_id, tenantId]);

  async function fetchTenantConfig() {
    try {
      const config = await Api.tenants.getConfig(tenantId);
      setTeamSize(config.team_size ?? null);
    } catch {
      // Default to team mode if we can't determine
      setTeamSize(null);
    }
  }

  async function fetchShifts(employeeId: string) {
    setShiftsLoading(true);
    try {
      // Get next 7 days of shifts
      const today = new Date();
      const weekOut = new Date(today);
      weekOut.setDate(weekOut.getDate() + 6);
      const startDate = today.toISOString().split('T')[0];
      const endDate = weekOut.toISOString().split('T')[0];
      const data = await Api.shifts.schedule.forDate(tenantId, employeeId, startDate, endDate);
      setShifts(data);
    } catch {
      console.error('Failed to fetch shifts');
    } finally {
      setShiftsLoading(false);
    }
  }

  // Detect OAuth redirect params
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendarConnected') === 'true') {
      void fetchCalendarSettings();
      const url = new URL(window.location.href);
      url.searchParams.delete('calendarConnected');
      window.history.replaceState({}, '', url.pathname);
    }
    if (params.get('calendarError')) {
      console.error('Calendar connection failed:', params.get('calendarError'));
      const url = new URL(window.location.href);
      url.searchParams.delete('calendarError');
      window.history.replaceState({}, '', url.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchCalendarSettings() {
    try {
      const data = await Api.calendar.getSettings(tenantId);
      setCalendarSettings(data);
    } catch {
      console.error('Failed to fetch calendar settings');
    }
  }

  async function handleConnectCalendar(provider: 'google' | 'outlook') {
    setCalLoading(true);
    try {
      const res = await Api.calendar.getAuthUrl(tenantId, provider);
      window.location.href = res.url;
    } catch {
      console.error(`Failed to get ${provider} auth URL`);
      setCalLoading(false);
    }
  }

  async function handleDisconnectCalendar() {
    setCalLoading(true);
    try {
      const res = await Api.calendar.disconnect(tenantId);
      if (res.success) {
        setCalendarSettings(null);
      }
    } catch {
      console.error('Disconnect failed');
    } finally {
      setCalLoading(false);
    }
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function formatTime(t: string) {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  // Show loading until we know team_size
  if (teamSize === null && !staticLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <header className="mb-8 flex items-center">
        <div
          className="p-2 rounded-lg mr-4"
          style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
        >
          <Settings className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-display">Business Settings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {isSolo
              ? 'Your services, availability, and calendar'
              : `Calendar sync, integrations, and ${vocab.resource_plural.toLowerCase()}`}
          </p>
        </div>
      </header>

      <div className="max-w-3xl space-y-8">
        {/* ─── BUSINESS TYPE ─── Set once during the wizard; rarely revisited.
            Lives here (not on AI Persona) so prompt-tuning doesn't have to
            scroll past 24 industry cards on every visit, and an accidental
            click can't nuke a custom persona — applying is now guarded. */}
        <BusinessTypeSection tenantId={tenantId} onChanged={refreshVocabulary} />

        {/* ─── SERVICES pointer (solo mode) ─── Services were managed
            here previously but caused duplication with My Business →
            Services, which is the canonical editor (supports price,
            skill + resource assignments). Replaced with a pointer.
            2026-05-28 P1 dedup fix. */}
        {isSolo && (
          <button
            type="button"
            className="w-full flex items-center justify-between p-5 rounded-xl border text-left transition-colors"
            style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
            onClick={() => {
              // Now a sibling sub-tab under Setup (IA merge 2026-06-03).
              window.dispatchEvent(
                new CustomEvent('ai-sec:setup-subtab', { detail: { subtab: 'services' } })
              );
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-soft)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-soft)')}
          >
            <div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                My Services
              </div>
              <div className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {services.length > 0
                  ? `${services.length} service${services.length !== 1 ? 's' : ''} — tap to add, edit, or remove`
                  : 'No services yet — tap to add what you offer'}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}

        {/* ─── MY AVAILABILITY (solo mode) ─── */}
        {isSolo && (
          <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
            <div className="flex items-center mb-6">
              <div
                className="p-2 rounded-lg mr-4"
                style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
              >
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">My Availability</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  When clients can book you. Edit your schedule in{' '}
                  <button
                    onClick={() => {
                      // Working Days is now a sibling sub-tab under Setup.
                      window.dispatchEvent(
                        new CustomEvent('ai-sec:setup-subtab', { detail: { subtab: 'shifts' } })
                      );
                    }}
                    className="underline font-bold"
                    style={{ color: 'var(--accent)' }}
                  >
                    Staff &amp; Shifts
                  </button>
                  .
                </p>
              </div>
            </div>

            {shiftsLoading ? (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Loading schedule...
              </div>
            ) : shifts.length === 0 ? (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No schedule set yet. Set your hours in{' '}
                <button
                  onClick={() => {
                    // Working Days is now a sibling sub-tab under Setup.
                    window.dispatchEvent(
                      new CustomEvent('ai-sec:setup-subtab', { detail: { subtab: 'shifts' } })
                    );
                  }}
                  className="underline font-bold"
                  style={{ color: 'var(--accent)' }}
                >
                  Staff &amp; Shifts
                </button>
                .
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {shifts.map((shift, i) => {
                  const date = new Date(String(shift.shift_date).slice(0, 10) + 'T12:00:00');
                  const dayName = DAY_NAMES[date.getDay()];
                  const dayNum = date.getDate();
                  const isOff = shift.is_off;
                  return (
                    <div
                      key={i}
                      className="rounded-xl p-3 text-center border"
                      style={{
                        borderColor: isOff ? 'var(--border-soft)' : 'var(--accent)',
                        backgroundColor: isOff ? 'var(--bg-surface)' : 'var(--accent-muted)',
                      }}
                    >
                      <div
                        className="text-xs font-bold uppercase tracking-widest"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {dayName}
                      </div>
                      <div
                        className="text-lg font-bold"
                        style={{ color: isOff ? 'var(--text-muted)' : 'var(--text-primary)' }}
                      >
                        {dayNum}
                      </div>
                      {isOff ? (
                        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          Off
                        </div>
                      ) : (
                        <div className="text-xs mt-1" style={{ color: 'var(--accent-soft)' }}>
                          {shift.start_time && formatTime(shift.start_time)}
                          <br />
                          {shift.end_time && formatTime(shift.end_time)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* ─── CONNECTIONS ─── Calendar + CRM integrations grouped under one heading */}
        <div>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-4"
            style={{ color: 'var(--text-muted)' }}
          >
            Connections
          </h2>
          <div className="space-y-4">
            {/* ─── MY CALENDAR ─── */}
            <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <div
                    className="p-2 rounded-lg mr-4"
                    style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
                  >
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">
                      {isSolo ? 'My Calendar' : 'Calendar Synchronization'}
                    </h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {isSolo
                        ? 'Sync bookings to your personal Google or Outlook calendar.'
                        : 'Automatically push AI bookings to your Google or Outlook calendar.'}
                    </p>
                  </div>
                </div>
                {calendarSettings && (
                  <Badge variant="success" className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </Badge>
                )}
              </div>

              {!calendarSettings ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => handleConnectCalendar('google')}
                    disabled={calLoading}
                    className="flex items-center justify-center gap-3 p-4 border rounded-2xl transition-all font-bold group"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-soft)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-soft)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-soft)')}
                  >
                    <div className="w-8 h-8 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-center justify-center text-red-600">
                      G
                    </div>
                    <span>Connect Google Calendar</span>
                    <ExternalLink className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-all" />
                  </button>
                  <button
                    onClick={() => handleConnectCalendar('outlook')}
                    disabled={calLoading}
                    className="flex items-center justify-center gap-3 p-4 border rounded-2xl transition-all font-bold group"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-soft)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-soft)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-soft)')}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{
                        backgroundColor: 'var(--accent-muted)',
                        color: 'var(--accent-soft)',
                      }}
                    >
                      O
                    </div>
                    <span>Connect Outlook Calendar</span>
                    <ExternalLink className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-all" />
                  </button>
                </div>
              ) : (
                <div
                  className="p-4 border rounded-2xl flex items-center justify-between"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-soft)',
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${calendarSettings.provider === 'google' ? 'bg-red-500 text-white' : ''}`}
                      style={
                        calendarSettings.provider !== 'google'
                          ? { backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }
                          : undefined
                      }
                    >
                      {calendarSettings.provider === 'google' ? 'G' : 'O'}
                    </div>
                    <div>
                      <div className="font-bold capitalize">
                        {calendarSettings.provider} Calendar Connected
                      </div>
                      <div className="text-xs text-gray-500">
                        ID: {calendarSettings.external_calendar_id}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={handleDisconnectCalendar}
                    disabled={calLoading}
                    className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    icon={Unlink}
                  >
                    Disconnect
                  </Button>
                </div>
              )}
            </Card>

            {/* ─── CRM INTEGRATIONS ─── */}
            <CRMIntegrationCard
              tenantId={tenantId}
              provider={{
                name: 'Square',
                color: 'blue',
                icon: 'S',
                description: 'Sync customers and bookings with your Square account.',
                getSettings: Api.square.getSettings,
                getAuthUrl: Api.square.getAuthUrl,
                disconnect: Api.square.disconnect,
                triggerSync: Api.square.triggerSync,
                connectedParam: 'squareConnected',
                getSyncStatus: Api.square.getSyncStatus,
              }}
            />
          </div>{/* end Connections space-y-4 */}
        </div>{/* end Connections section */}

        {/* RESOURCES & CAPACITY removed 2026-06-03 (IA merge Phase 2): the
            canonical resource editor is the "Resources" sub-tab under Setup
            (ResourceManagerView). This team-only block duplicated it. */}
        <ConfirmModal {...confirmState} onClose={closeConfirm} />
      </div>
    </div>
  );
}
