'use client';

import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Users,
  Clock,
  ChevronRight,
  Wand2,
  ArrowRight,
  AlertCircle,
  Plus,
  Phone,
} from 'lucide-react';
import { Api } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { useActiveTenantId, useSessionContext } from '../lib/SessionContext';
import { useVocabulary, useVocabularyRefresh } from '@/lib/VocabularyContext';
import type { AnalyticsStats } from '../lib/types';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { WizardModeChooser } from './SetupWizard/WizardModeChooser';
import { WizardWelcome } from './SetupWizard/WizardWelcome';
import { BusinessTypePicker } from './SetupWizard/BusinessTypePicker';
import { notifySetupProgressChanged } from '../lib/useSetupProgress';
import { FirstRunTour } from './FirstRunTour';
import SetupWizard from './SetupWizard';
import SoloWizard from './SetupWizard/SoloWizard';
import { QuickBookPanel } from './scheduler/QuickBookPanel';
import { LoadingState } from './ui/LoadingState';
import { useOnboardingState } from '../lib/useOnboardingState';
import type { Tab } from '../app/dashboard/page';
import type { Customer } from '../lib/types';

interface DashboardHomeProps {
  onNavigate?: (tab: Tab) => void;
}

export default function DashboardHome({ onNavigate }: DashboardHomeProps) {
  const tenantId = useActiveTenantId();
  const { userName } = useSessionContext();
  const vocab = useVocabulary();
  const refreshVocabulary = useVocabularyRefresh();

  interface DashboardAppointment {
    appointment_id: string;
    start_time: string;
    end_time?: string;
    status: string;
    description?: string;
    customer_name?: string;
    employee_id?: string | null;
    customers?: { name?: string; first_name?: string; last_name?: string; phone?: string };
    resources?: { name?: string };
  }
  interface DashboardEmployee {
    employee_id: string;
    name: string;
    first_name?: string | null;
    last_name?: string | null;
    type?: string;
    is_active: boolean;
  }
  interface DashboardService {
    service_id: string;
    name: string;
  }
  interface DashboardResource {
    resource_id: string;
    name: string;
  }

  const [appointments, setAppointments] = useState<DashboardAppointment[]>([]);
  const [employees, setEmployees] = useState<DashboardEmployee[]>([]);
  const [services, setServices] = useState<DashboardService[]>([]);
  const [resources, setResources] = useState<DashboardResource[]>([]);
  // QuickBookPanel needs the customer list so the operator can pick an
  // existing caller or create one inline. Pulled here (separate from the
  // four counts the cards already need) so the panel can open without a
  // second round-trip when the user clicks "+ New Booking".
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  // Surface load failures so an empty dashboard can never be confused with
  // "new tenant with no data yet." The older silent `.catch(() => [])`
  // pattern left owners unsure whether they had no bookings, or the app
  // had lost its connection — a trust-eroding ambiguity.
  const [loadError, setLoadError] = useState<string | null>(null);
  // undefined = not yet fetched, null = fetched but not configured, string = active phone
  const [tenantPhone, setTenantPhone] = useState<string | null | undefined>(undefined);
  const [analyticsStats, setAnalyticsStats] = useState<AnalyticsStats | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    const today = new Date().toISOString().split('T')[0];
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    // Track whether any of the 4 data calls failed. Promise.all would
    // reject on first failure and leave partial state unset; Promise
    // .allSettled lets each call succeed or fail independently so we
    // render partial data and show a dismissable error for the gaps.
    const results = await Promise.allSettled([
      Api.appointments.list(tenantId, { startDate: today, endDate: weekEnd }),
      Api.employees.list(tenantId),
      Api.services.list(tenantId),
      Api.resources.list(tenantId),
      Api.customers.list(tenantId),
      Api.tenants.getConfig(tenantId),
      Api.analytics.getStats(tenantId).catch(() => null), // fail-soft; powers top-line + reliability tiles
    ]);

    const [apptsR, empsR, svcsR, resR, custR, configR, statsR] = results;

    setAppointments(
      apptsR.status === 'fulfilled' && Array.isArray(apptsR.value) ? apptsR.value : []
    );
    setEmployees(
      empsR.status === 'fulfilled' && Array.isArray(empsR.value)
        ? empsR.value.filter((e: DashboardEmployee) => e.type === 'employee' && e.is_active)
        : []
    );
    setServices(svcsR.status === 'fulfilled' && Array.isArray(svcsR.value) ? svcsR.value : []);
    setResources(resR.status === 'fulfilled' && Array.isArray(resR.value) ? resR.value : []);
    setCustomers(custR.status === 'fulfilled' && Array.isArray(custR.value) ? custR.value : []);
    if (configR.status === 'fulfilled') {
      setTenantPhone((configR.value)?.inbound_phone ?? null);
    }
    if (statsR.status === 'fulfilled' && statsR.value) {
      setAnalyticsStats(statsR.value);
    }

    const anyFailed = results.some((r) => r.status === 'rejected');
    if (anyFailed) {
      setLoadError("Couldn't load all your data. Check your connection and try again.");
    }
    setLoading(false);
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const todayAppointments = appointments
    .filter((a) => a.status === 'scheduled' && a.start_time.startsWith(todayStr))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const needsSetup = services.length === 0 || employees.length === 0 || resources.length === 0;

  // Single source of truth for the setup-wizard overlay state
  // (UX audit #7). Replaces the welcomePassed/wizardMode/
  // businessTypeReady/wizardDismissed 4-flag matrix. Stage transitions
  // are exhaustive in the reducer so only one overlay renders at a
  // time — see useOnboardingState.ts.
  const { stage, mode, transitions } = useOnboardingState({ needsSetup, loading, autoOpen: true });

  // Keyboard-shortcut entry-point: `N` (registered at the dashboard
  // page level) dispatches `ai-sec:new-booking` so any mounted Home
  // can open the panel without page-level plumbing. Guarded by the
  // same disabled conditions as the visible button.
  useEffect(() => {
    function onShortcut() {
      if (loading || needsSetup) return;
      setQuickBookOpen(true);
    }
    window.addEventListener('ai-sec:new-booking', onShortcut);
    return () => window.removeEventListener('ai-sec:new-booking', onShortcut);
  }, [loading, needsSetup]);

  function handleCloseWizard() {
    transitions.closeToIdle();
    void loadData(); // refresh counts after wizard completes
    // Signal the persistent setup-progress pill to refetch — if the
    // user actually finished the wizard, the pill should vanish on
    // the same tick instead of waiting for a navigation/reload.
    notifySetupProgressChanged();
  }

  async function handleBusinessTypeSelected(businessType: string) {
    if (!tenantId) {
      transitions.enterWizard();
      return;
    }
    try {
      // Fetch the full template to apply its settings
      const templates = await Api.templates.listFull();
      const tpl = (templates || []).find((t) => t.business_type === businessType);
      // Update tenant config with template values
      await Api.tenants.updateConfig(tenantId, {
        business_type: businessType,
        system_prompt: tpl?.system_prompt_template || undefined,
        voice_id: tpl?.voice_id || undefined,
        first_message: tpl?.first_message || undefined,
      });
      refreshVocabulary();
    } catch {
      // Still proceed — worst case they get default vocabulary
    }
    transitions.enterWizard();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingState message="Loading dashboard…" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl mx-auto">
      {/* GREETING + primary New Booking action.
          New Booking is the single most-frequent front-desk task — the
          2026-05-07 audit measured 8+ decisions to book a call-in on the
          default Schedule→Calendar landing, dropped to ~3 once Quick Book
          was hoisted across all Schedule sub-tabs, and now reaches 1 tap
          from the Home landing. Button is disabled until setup data is
          loaded so an empty-state user can't open the panel and stare at
          empty pickers. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display">
            {greeting}, {(userName || 'there').split(' ')[0]}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={() => setQuickBookOpen(true)}
          disabled={loading || needsSetup}
          aria-label="Create a new booking"
        >
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          New Booking
        </Button>
      </div>

      {/* LOAD ERROR — shown when any of the four parallel fetches failed.
          Retryable in-place so users don't have to reload the whole app. */}
      {loadError && (
        <div
          role="alert"
          className="rounded-xl border-2 p-4 flex items-start gap-3"
          style={{ borderColor: 'var(--red, #dc2626)', backgroundColor: 'var(--bg-raised)' }}
        >
          <AlertCircle
            className="w-5 h-5 mt-0.5 shrink-0"
            style={{ color: 'var(--red, #dc2626)' }}
            aria-hidden="true"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {loadError}
            </div>
            <Button variant="secondary" size="sm" className="mt-2" onClick={loadData}>
              Try again
            </Button>
          </div>
          <button
            onClick={() => setLoadError(null)}
            aria-label="Dismiss error"
            className="text-xs px-2 py-1 rounded hover:brightness-125"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* SETUP PROMPT — shown only when the wizard was dismissed and
          setup is still incomplete. Driven by the single 'dismissed'
          stage from useOnboardingState, so it cannot co-render with
          any modal stage (welcome/chooser/picker/wizard). */}
      {needsSetup && stage === 'dismissed' && (
        <div
          className="rounded-xl border-2 p-5"
          style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--accent-muted)' }}
        >
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-raised)' }}>
              <Wand2 className="w-6 h-6" style={{ color: 'var(--accent-soft)' }} />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                Finish setting up your business
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                {services.length === 0 && `Add your services. `}
                {resources.length === 0 && `Add your ${vocab.resource_plural.toLowerCase()}. `}
                {employees.length === 0 && `Add your ${vocab.employee_plural.toLowerCase()}. `}
              </p>
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={transitions.openToChooser}
              >
                <Wand2 className="w-4 h-4 mr-1.5" />
                Open Setup Assistant
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* WIZARD overlay — exactly one of these renders at a time,
          enforced by the reducer. */}
      {stage === 'welcome' && (
        <WizardWelcome onContinue={transitions.advanceWelcome} onDismiss={transitions.dismiss} />
      )}
      {stage === 'chooser' && (
        <WizardModeChooser
          onChoose={transitions.chooseMode}
          onClose={transitions.dismiss}
          onBack={transitions.backToWelcome}
        />
      )}
      {stage === 'picker' && (
        <BusinessTypePicker
          onSelect={handleBusinessTypeSelected}
          onBack={transitions.backToChooser}
          onClose={handleCloseWizard}
        />
      )}
      {stage === 'wizard' && mode === 'solo' && (
        <SoloWizard
          isOpen={true}
          onClose={handleCloseWizard}
          onBackToPicker={transitions.backToPicker}
        />
      )}
      {stage === 'wizard' && mode === 'team' && (
        <SetupWizard
          isOpen={true}
          onClose={handleCloseWizard}
          onBackToPicker={transitions.backToPicker}
        />
      )}

      {/* AI RECEPTIONIST STATUS — visible once setup is complete so owners
          always know whether the phone line is active. Fetched alongside
          the rest of loadData(); undefined means still loading (hidden),
          null means configured but no phone number set. */}
      {!needsSetup && tenantPhone !== undefined && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border"
          style={{
            borderColor: tenantPhone ? 'var(--border-soft)' : 'var(--border-soft)',
            backgroundColor: 'var(--bg-raised)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-lg shrink-0"
              style={{
                backgroundColor: tenantPhone
                  ? 'color-mix(in srgb, var(--green, #22c55e) 15%, transparent)'
                  : 'var(--bg-surface)',
              }}
            >
              <Phone
                className="w-4 h-4"
                style={{ color: tenantPhone ? 'var(--green, #22c55e)' : 'var(--text-muted)' }}
                aria-hidden="true"
              />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                AI Receptionist
              </div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {tenantPhone
                  ? `Active on ${formatPhone(tenantPhone)}`
                  : 'No phone number configured yet'}
              </div>
            </div>
          </div>
          {!tenantPhone && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('ai-insights')}
              className="text-xs flex items-center gap-1 shrink-0 hover:underline"
              style={{ color: 'var(--accent-soft)' }}
            >
              Configure <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* Analytics reliability snapshot — wires the backend /analytics/stats
          (which was implemented but previously unused on the owner home).
          Shows pre-aggregated top-line numbers + note that they are reliable
          server-side aggregates (not client recomputes). Recent activity feed
          gives a quick "what just happened" without opening Calls or Schedule.
          This finishes the stubbed stats consumption + adds explicit
          owner-facing reliability/freshness UI. */}
      {analyticsStats && (
        <div
          className="mb-6 p-4 rounded-xl border"
          style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-raised)' }}
        >
          <div
            className="text-[10px] uppercase tracking-[1px] mb-2 flex items-center gap-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>Analytics data (reliable aggregates)</span>
            <span className="text-[9px] normal-case opacity-60">— from voice_sessions + appointments</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm">
            <div>
              Calls this week: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{analyticsStats.calls.week}</span>
              <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>(total {analyticsStats.calls.total})</span>
            </div>
            <div>
              Upcoming appts: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{analyticsStats.appointments.upcoming}</span>
            </div>
            <div>
              New customers (7d): <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{analyticsStats.customers.new_this_week}</span>
            </div>
            <div>
              Appts (week): <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{analyticsStats.appointments.week}</span>
            </div>
          </div>
          {analyticsStats.recent_activity && analyticsStats.recent_activity.length > 0 && (
            <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>
              Recent: {analyticsStats.recent_activity.slice(0, 3).map((a, i) => (
                <span key={i}>
                  {a.description}
                  {i < 2 && analyticsStats.recent_activity.length > i + 1 ? ' · ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TODAY'S SCHEDULE — the whole header row is a click target
          (Fitts's Law: larger targets are faster to hit). The 12px
          "Full schedule" link previously WAS the only affordance but
          was barely tappable on mobile. Now the entire header behaves
          as one button; the chevron stays as the visual cue. */}
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
            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
              Nothing booked for today yet.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {/* New Booking is the primary affordance even in the
                  empty state — the top-of-page button is the canonical
                  entry-point, but on a fresh tenant the user is already
                  looking at this card and we shouldn't force them to
                  scroll up. Secondary actions follow. UX audit Flows
                  4.1 row 6 (2026-05-18). */}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setQuickBookOpen(true)}
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
              {employees.length > 1 && (
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

      {/* THIS WEEK — day by day with appointment counts and who's working */}
      <Card>
        <h2
          className="font-semibold mb-4 flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <Calendar className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
          Next 3 Days
        </h2>
        <WeekView tenantId={tenantId} employees={employees} vocab={vocab} onNavigate={onNavigate} />
      </Card>

      {/* Quick Action cards removed 2026-05-28 — duplicated the nav bar
          already visible 600px above with zero new information. */}

      {/* Quick Book panel — mounted here (not in SchedulerView) so the
          New Booking button at the top of Home opens it directly. Same
          component instance the Schedule tab uses; data shape matches.
          Pre-fill is empty so the operator picks customer + service +
          time fresh; on success we refresh Home's appointment data so
          today's schedule card reflects the new booking immediately. */}
      <QuickBookPanel
        isOpen={quickBookOpen}
        onClose={() => setQuickBookOpen(false)}
        tenantId={tenantId}
        prefill={{}}
        customers={customers}
        employees={employees}
        resources={resources}
        services={services}
        onBooked={loadData}
      />

      {/* First-run tour — self-gates on the localStorage flag the wizard's
          Done button sets. No-op when the tenant has already seen it. */}
      <FirstRunTour onNavigate={onNavigate} />
    </div>
  );
}

function WeekView({
  tenantId,
  employees,
  vocab,
  onNavigate,
}: {
  tenantId: string | null;
  employees: {
    employee_id: string;
    name: string;
    first_name?: string | null;
    last_name?: string | null;
  }[];
  vocab: { booking_label: string; employee_label: string };
  onNavigate?: (tab: Tab) => void;
}) {
  const [weekAppts, setWeekAppts] = useState<
    { date: string; count: number; appts: { time: string; desc: string; employee?: string }[] }[]
  >([]);
  const [weekShifts, setWeekShifts] = useState<
    Record<string, { name: string; start: string; end: string; isOff: boolean }[]>
  >({});

  useEffect(() => {
    if (!tenantId) return;
    void loadWeekData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadWeekData() {
    const today = new Date();
    const days: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().split('T')[0]);
    }

    // Fetch appointments for next 3 days
    const weekEnd = days[2];
    try {
      const appts = await Api.appointments.list(tenantId, {
        startDate: days[0],
        endDate: new Date(new Date(weekEnd).getTime() + 86400000).toISOString().split('T')[0],
      });
      const apptList = Array.isArray(appts) ? appts.filter((a) => a.status === 'scheduled') : [];

      const byDay = days.map((date) => {
        const dayAppts = apptList
          .filter((a) => a.start_time.startsWith(date))
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        return {
          date,
          count: dayAppts.length,
          appts: dayAppts.slice(0, 4).map((a) => {
            const empName =
              a.employee_id && employees.find((e) => e.employee_id === String(a.employee_id));
            return {
              time: new Date(a.start_time).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              }),
              desc: a.description || vocab.booking_label,
              employee: empName ? empName.first_name || empName.name : undefined,
            };
          }),
        };
      });
      setWeekAppts(byDay);
    } catch {
      // Silent fail — week view is supplementary
    }

    // Fetch shifts for each employee
    if (employees.length > 0 && employees.length <= 10) {
      const shiftMap: Record<
        string,
        { name: string; start: string; end: string; isOff: boolean }[]
      > = {};
      try {
        const shiftPromises = employees.map((emp) =>
          Api.shifts.schedule
            .forDate(tenantId, emp.employee_id, days[0], days[2])
            .then((shifts) => ({
              empId: emp.employee_id,
              empName: emp.first_name || emp.name,
              shifts,
            }))
            .catch(() => ({
              empId: emp.employee_id,
              empName: emp.first_name || emp.name,
              shifts: [],
            }))
        );
        const results = await Promise.all(shiftPromises);
        for (const { empName, shifts } of results) {
          for (const shift of shifts) {
            const dateKey = shift.shift_date;
            if (!shiftMap[dateKey]) shiftMap[dateKey] = [];
            shiftMap[dateKey].push({
              name: empName,
              start: shift.start_time || '',
              end: shift.end_time || '',
              isOff: shift.is_off,
            });
          }
        }
        setWeekShifts(shiftMap);
      } catch {
        // Silent fail
      }
    }
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function formatShiftTime(t: string) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'p' : 'a';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2, '0')}${ampm}`;
  }

  if (weekAppts.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
        No recent activity
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {weekAppts.map((day) => {
        const date = new Date(day.date + 'T12:00:00');
        const dayName = DAY_NAMES[date.getDay()];
        const dayNum = date.getDate();
        const isToday = day.date === new Date().toISOString().split('T')[0];
        const dayShifts = weekShifts[day.date] || [];
        const workingStaff = dayShifts.filter((s) => !s.isOff);

        return (
          <button
            key={day.date}
            onClick={() => onNavigate?.('schedule')}
            className="rounded-xl p-2.5 border text-left transition-colors"
            style={{
              borderColor: isToday ? 'var(--accent)' : 'var(--border-soft)',
              backgroundColor: isToday ? 'var(--accent-muted)' : 'var(--bg-surface)',
            }}
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <span
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: 'var(--text-muted)' }}
              >
                {dayName}
              </span>
              <span
                className="text-lg font-bold"
                style={{ color: isToday ? 'var(--accent-soft)' : 'var(--text-primary)' }}
              >
                {dayNum}
              </span>
            </div>

            {/* Appointment count */}
            {day.count > 0 ? (
              <div className="text-xs font-medium mb-1" style={{ color: 'var(--accent-soft)' }}>
                {day.count}{' '}
                {day.count === 1
                  ? vocab.booking_label.toLowerCase()
                  : `${vocab.booking_label.toLowerCase()}s`}
              </div>
            ) : (
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                No bookings
              </div>
            )}

            {/* First few appointments */}
            {day.appts.slice(0, 4).map((a, i) => (
              <div
                key={i}
                className="text-xs truncate"
                style={{ color: 'var(--text-secondary)' }}
              >
                {a.time} {a.desc}
              </div>
            ))}
            {day.count > 4 && (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                +{day.count - 4} more
              </div>
            )}

            {/* Who's working */}
            {workingStaff.length > 0 && employees.length > 1 && (
              <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: 'var(--border-soft)' }}>
                {workingStaff.slice(0, 3).map((s, i) => (
                  <div
                    key={i}
                    className="text-xs truncate"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {s.name} {formatShiftTime(s.start)}–{formatShiftTime(s.end)}
                  </div>
                ))}
                {workingStaff.length > 3 && (
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    +{workingStaff.length - 3} more
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

