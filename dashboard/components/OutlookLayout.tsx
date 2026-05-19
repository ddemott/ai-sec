'use client';

import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Users,
  Settings,
  Bot,
  LogOut,
  User,
  Globe,
  Wrench,
  ShieldCheck,
  ChevronRight,
  LayoutDashboard,
  Phone,
  UserCog,
} from 'lucide-react';
import { Api } from '../lib/api';
import { FolderTab, FolderTabBar } from './ui/FolderTabs';
import { useTheme, THEMES } from '@/lib/ThemeContext';
import { useSessionContext, type UserRole } from '@/lib/SessionContext';
import { FeedbackButton } from './ui/FeedbackButton';
import { SetupProgressPill } from './SetupProgressPill';
import { useAnchorRect } from '../lib/useAnchorRect';

type Tab =
  | 'dashboard'
  | 'schedule'
  | 'customers'
  | 'calls'
  | 'my-team'
  | 'my-business'
  | 'ai-insights'
  | 'settings'
  | 'all-businesses'
  | 'profile'
  | 'business-settings';

interface LayoutProps {
  children: ReactNode;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  onLogout?: () => void;
  userName?: string | null;
  role?: UserRole;
  isAdmin?: boolean;
  managedTenantName?: string | null;
  managedTenantId?: string | null;
  onSelectTenant?: (id: string, name: string) => void;
}

const PRIMARY_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'calls', label: 'Calls', icon: Phone },
];

// Top-level labels say what the section is FOR, not what's inside the
// database. Compound noun-pairs ("Services & Resources") describe the
// schema; possessive plain-English ("My Business") describes the user's
// job-to-be-done. Also: shorter labels survive the mobile bottom-nav's
// 64px-wide tap targets without truncation.
const ADVANCED_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'my-business', label: 'My Business', icon: Wrench },
  { id: 'my-team', label: 'My Team', icon: UserCog },
  { id: 'ai-insights', label: 'Phone Assistant', icon: Bot },
];

const ACCOUNT_TABS: Record<'profile' | 'business-settings' | 'all-businesses', string> = {
  profile: 'My Profile',
  'business-settings': 'Business Settings',
  'all-businesses': 'All Businesses',
};

function getTabLabel(tab: Tab): string {
  const match = [...PRIMARY_TABS, ...ADVANCED_TABS].find((t) => t.id === tab);
  return match?.label || ACCOUNT_TABS[tab as keyof typeof ACCOUNT_TABS] || tab;
}

export function OutlookLayout({
  children,
  activeTab,
  setActiveTab,
  onLogout,
  userName,
  role = 'owner',
  isAdmin,
  managedTenantName,
  managedTenantId,
  onSelectTenant,
}: LayoutProps) {
  // WHY: front-desk staff are the dashboard's primary daily-use audience —
  // owners can configure services/skills/vocabulary, but the people who
  // actually answer calls don't need (and shouldn't see) those tabs. Super-
  // admins keep full access; the role column doesn't apply to them since
  // they're identified by tenant_id, not by users.role.
  const isFrontDeskOnly = role === 'front_desk' && !isAdmin;
  const { theme, setTheme, themeInfo } = useTheme();
  const [allTenants, setAllTenants] = useState<
    { tenant_id: string; name: string; business_type: string }[]
  >([]);
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const tenantBtnRef = useRef<HTMLButtonElement>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);

  const { tenantsVersion } = useSessionContext();
  // Anchor rects for the floating dropdowns. Track scroll/resize so
  // the menus stay glued to their triggers (UX audit 4.2 row 7).
  const tenantBtnRect = useAnchorRect(tenantBtnRef, tenantDropdownOpen);
  const profileBtnRect = useAnchorRect(profileBtnRef, profileMenuOpen);
  const [unansweredCount, setUnansweredCount] = useState(0);
  // E3 (2026-05-17): count of currently-active voice calls, used as a
  // badge on the Calls tab so front-desk can see live activity at a
  // glance even when looking at another tab. Mirrors the unanswered-KB
  // pattern — refresh on activeTab change rather than poll on a timer.
  const [activeCallCount, setActiveCallCount] = useState(0);

  const visibleTabs = isFrontDeskOnly ? PRIMARY_TABS : [...PRIMARY_TABS, ...ADVANCED_TABS];

  // WHY: a front-desk-only user could still land on a management tab via a
  // stale ?tab=my-business URL or a back-button. Snap them back to Home so
  // they always land on the simplest working surface.
  useEffect(() => {
    if (!isFrontDeskOnly) return;
    const restrictedTabs = new Set<Tab>([
      'my-business',
      'my-team',
      'ai-insights',
      'settings',
      'all-businesses',
    ]);
    if (restrictedTabs.has(activeTab)) setActiveTab('dashboard');
  }, [isFrontDeskOnly, activeTab, setActiveTab]);

  // Live-badge polling (UX audit #3, 2026-05-18).
  //
  // Before: both effects ran with `[effectiveTenantId, activeTab]` as the
  // sole dependencies, so the "active call" red pulse only refreshed when
  // the user changed tabs — front-desk staff staring at Home for ten
  // minutes never saw an incoming call indicator. After: each count
  // polls every 5s while the tenant is active. Polling stops when the
  // tenant context goes null (logout, super-admin with no managed tenant).
  //
  // 5s matches the cadence used by Slack/Linear/Gmail for "soft live"
  // counters. SSE would be tighter but introduces a server contract
  // (single connection per tab, reconnect logic, auth-on-stream) that's
  // out of scope here. The polled counter feels live enough.
  const effectiveTenantId = managedTenantId || null;

  useEffect(() => {
    if (!effectiveTenantId) return;
    let cancelled = false;
    const fetchUnanswered = () => {
      if (cancelled) return;
      Api.knowledge
        .unanswered(effectiveTenantId)
        .then((res) => {
          if (!cancelled) setUnansweredCount(res?.questions?.length || 0);
        })
        .catch(() => {}); // non-fatal — silent: a missing badge beats a toast on every tick
    };
    fetchUnanswered();
    const id = setInterval(fetchUnanswered, 30_000); // KB unanswered drifts slowly, 30s is plenty
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [effectiveTenantId]);

  useEffect(() => {
    if (!effectiveTenantId) return;
    let cancelled = false;
    const fetchActiveCalls = () => {
      if (cancelled) return;
      Api.voice
        .getActiveCalls(effectiveTenantId)
        .then((res) => {
          if (cancelled) return;
          setActiveCallCount(typeof res?.total === 'number' ? res.total : res?.calls?.length || 0);
        })
        .catch(() => {});
    };
    fetchActiveCalls();
    const id = setInterval(fetchActiveCalls, 5_000); // active calls demand a tighter cadence
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [effectiveTenantId]);

  useEffect(() => {
    if (isAdmin) {
      void Api.tenants.list().then((data) => {
        setAllTenants(Array.isArray(data) ? data : []);
      });
    }
  }, [isAdmin, tenantsVersion]);

  // Screen-reader announcement region for the live badges. The visual
  // pulse is sighted-user candy; screen-reader users need an explicit
  // text update. Renders off-screen via the standard sr-only pattern;
  // aria-live=polite keeps announcements quiet unless something changes.
  const liveAnnouncement = (() => {
    const parts: string[] = [];
    if (activeCallCount > 0)
      parts.push(`${activeCallCount} active call${activeCallCount > 1 ? 's' : ''}`);
    if (unansweredCount > 0)
      parts.push(`${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''}`);
    return parts.join('. ');
  })();

  return (
    <>
      <div
        className="flex flex-col h-screen overflow-hidden transition-colors duration-200"
        style={{
          backgroundColor: 'var(--bg-base)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
        }}
      >
        {/* SR-only live region. Off-screen via clip; aria-live="polite" so
          screen readers announce when the live-call count flips. Mirrors
          the visual red-pulse + KB-badge UI. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {liveAnnouncement}
        </div>

        {/* ADMIN HEADER (super-admin only) */}
        {isAdmin && managedTenantName && (
          <header
            className="px-6 py-2 flex items-center justify-between shadow-sm shrink-0 transition-colors duration-200"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-base)' }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                Admin Mode
              </span>
              <span className="mx-2 opacity-30">|</span>
              <button
                ref={tenantBtnRef}
                onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1 rounded-lg transition-all cursor-pointer"
                style={{ backgroundColor: 'rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.1)' }}
              >
                <span className="text-sm font-bold truncate max-w-[200px]">
                  {managedTenantName}
                </span>
                <ChevronRight className="w-3 h-3 transition-transform rotate-90" />
              </button>
            </div>
            {/* UX audit Natural 4.5.4 (2026-05-18): the previous label
              "Configure Businesses" sounded like a destination, not
              an exit. Renamed to make the return-to-super-admin
              path explicit; the action is the same (jump to the
              all-businesses grid, which IS the super-admin landing). */}
            <button
              onClick={() => setActiveTab('all-businesses')}
              className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full transition-all inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
              aria-label="Exit admin mode — return to the businesses grid"
            >
              <ChevronRight className="w-3 h-3 rotate-180" aria-hidden="true" />
              Exit admin mode
            </button>
          </header>
        )}

        {/* PRIMARY NAVIGATION BAR — Daily-use tabs + utility buttons */}
        <FolderTabBar
          size="lg"
          ariaLabel="Main navigation"
          right={
            <>
              {isAdmin && (
                <button
                  aria-label="All businesses"
                  title="All businesses"
                  onClick={() => setActiveTab('all-businesses')}
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 rounded-md transition-all ${activeTab === 'all-businesses' ? '' : 'hover:brightness-110'}`}
                  style={
                    activeTab === 'all-businesses'
                      ? { color: 'var(--accent-soft)', backgroundColor: 'var(--accent-muted)' }
                      : { color: 'var(--text-muted)' }
                  }
                >
                  <Globe className="w-4 h-4" aria-hidden="true" />
                  {/* UX audit Natural 4.5.2 (2026-05-18): icon-only had
                    only a title attribute, which is silent on touch
                    and on quick scans. Showing the word as a sibling
                    span gives sighted users the same cue screen
                    readers have always had via aria-label. */}
                  <span className="text-xs font-bold uppercase tracking-wider">All businesses</span>
                </button>
              )}
              <SetupProgressPill />
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as typeof theme)}
                aria-label={`Theme (currently ${themeInfo.name})`}
                title={`Theme: ${themeInfo.name}`}
                className="text-xs rounded-md px-2 py-1.5 min-h-[40px] cursor-pointer outline-none transition-all"
                style={{
                  backgroundColor: 'var(--bg-raised)',
                  borderColor: 'var(--border-soft)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-soft)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                ref={profileBtnRef}
                aria-label={userName ? `Account menu for ${userName}` : 'Account menu'}
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                title={`Account: ${userName || 'Profile'}`}
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                className={`inline-flex items-center justify-center min-w-[40px] min-h-[40px] p-2 rounded-md transition-all ${
                  profileMenuOpen || activeTab === 'profile' || activeTab === 'business-settings'
                    ? ''
                    : 'hover:brightness-110'
                }`}
                style={
                  profileMenuOpen || activeTab === 'profile' || activeTab === 'business-settings'
                    ? { color: 'var(--accent-soft)', backgroundColor: 'var(--accent-muted)' }
                    : undefined
                }
              >
                <User className="w-4 h-4" aria-hidden="true" />
              </button>
            </>
          }
        >
          {visibleTabs.map((tab) => (
            <span key={tab.id} data-tab-id={tab.id} className="relative">
              <FolderTab
                label={tab.label}
                icon={tab.icon}
                size="lg"
                isActive={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
              {tab.id === 'ai-insights' && unansweredCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold leading-none"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}
                  title={`${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''} from callers`}
                >
                  {unansweredCount > 99 ? '99+' : unansweredCount}
                </span>
              )}
              {tab.id === 'calls' && activeCallCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold leading-none animate-pulse"
                  style={{
                    backgroundColor: 'var(--danger, #dc2626)',
                    color: 'var(--primary-text)',
                  }}
                  title={`${activeCallCount} call${activeCallCount > 1 ? 's' : ''} in progress`}
                  aria-label={`${activeCallCount} active call${activeCallCount > 1 ? 's' : ''}`}
                >
                  {activeCallCount > 99 ? '99+' : activeCallCount}
                </span>
              )}
            </span>
          ))}
        </FolderTabBar>

        {/* CONTENT AREA */}
        <div role="main" className="flex-1 flex overflow-hidden">
          {children}
        </div>

        {/* MOBILE NAVIGATION — mirrors the primary tabs.
          UX audit #4 (2026-05-18): the admin Globe was previously
          rendered in this row too, which combined with 4 primary + 3
          advanced tabs forced a horizontal scroll on iPhone SE (375px).
          Globe lives in the top utility row (and the FolderTabBar's
          `right` slot is visible at every viewport), so dropping it
          from the bottom-row mobile nav doesn't lose admin access.
          Label font bumped from text-[9px] (sub-WCAG body-text size)
          to text-[11px] — fits 4 primary tabs at 375px without
          overflow and reads cleanly. */}
        <nav
          aria-label="Mobile navigation"
          className="md:hidden flex flex-col border-t transition-colors duration-200 safe-area-pb"
          style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--border)' }}
        >
          <div
            className="flex h-14 overflow-x-auto no-scrollbar border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative flex-1 min-w-[64px] flex flex-col items-center justify-center shrink-0"
                  style={
                    activeTab === tab.id
                      ? { color: 'var(--accent-soft)' }
                      : { color: 'var(--text-muted)' }
                  }
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] mt-0.5 font-medium">{tab.label}</span>
                  {tab.id === 'ai-insights' && unansweredCount > 0 && (
                    <span
                      className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full text-[8px] font-bold leading-none"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}
                    >
                      {unansweredCount > 99 ? '99+' : unansweredCount}
                    </span>
                  )}
                  {tab.id === 'calls' && activeCallCount > 0 && (
                    <span
                      className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full text-[8px] font-bold leading-none animate-pulse"
                      style={{
                        backgroundColor: 'var(--danger, #dc2626)',
                        color: 'var(--primary-text)',
                      }}
                      aria-label={`${activeCallCount} active call${activeCallCount > 1 ? 's' : ''}`}
                    >
                      {activeCallCount > 99 ? '99+' : activeCallCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Tenant switcher dropdown.
        Uses CSS vars (not hardcoded bg-white/gray classes) so it theme-
        matches midnight, nord, sunset, forest, etc. — otherwise the panel
        pops as a bright-white rectangle in 6 of 8 themes. */}
      {tenantDropdownOpen && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setTenantDropdownOpen(false)} />
          <div
            data-testid="tenant-switcher-panel"
            className="fixed z-[100] w-64 rounded-xl shadow-2xl border overflow-hidden"
            style={{
              top: tenantBtnRect ? tenantBtnRect.bottom + 4 : 0,
              left: tenantBtnRect ? tenantBtnRect.left : 0,
              backgroundColor: 'var(--bg-raised)',
              color: 'var(--text-primary)',
              borderColor: 'var(--border-soft)',
            }}
          >
            <div
              className="p-2 border-b text-[10px] font-bold uppercase tracking-widest"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-soft)',
                color: 'var(--text-muted)',
              }}
            >
              Switch Active Business
            </div>
            <div
              className="max-h-60 overflow-y-auto"
              role="listbox"
              aria-label="Select active business"
              onKeyDown={(e) => {
                const items = e.currentTarget.querySelectorAll('[role="option"]');
                const focused = e.currentTarget.querySelector<HTMLElement>(':focus');
                const idx = focused ? Array.from(items).indexOf(focused) : -1;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const next = items[idx + 1] as HTMLElement | undefined;
                  next?.focus();
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const prev = items[idx - 1] as HTMLElement | undefined;
                  prev?.focus();
                } else if (e.key === 'Enter' && focused) {
                  focused.click();
                }
              }}
            >
              {allTenants.map((t) => (
                <button
                  key={t.tenant_id}
                  role="option"
                  aria-selected={managedTenantId === t.tenant_id}
                  onClick={() => {
                    if (onSelectTenant) onSelectTenant(t.tenant_id, t.name);
                    setTenantDropdownOpen(false);
                    if (activeTab === 'all-businesses') setActiveTab('dashboard');
                  }}
                  className="w-full text-left px-4 py-3 flex flex-col transition-colors border-b hover:brightness-125"
                  style={{
                    backgroundColor:
                      managedTenantId === t.tenant_id ? 'var(--accent-muted)' : undefined,
                    borderColor: 'var(--border-soft)',
                  }}
                >
                  <span className="text-sm font-bold">{t.name}</span>
                  <span className="text-[10px] opacity-50 uppercase tracking-tighter">
                    {t.business_type}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Profile dropdown menu */}
      {profileMenuOpen && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setProfileMenuOpen(false)} />
          <div
            className="fixed z-[100] w-56 rounded-xl shadow-2xl border overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-raised)',
              borderColor: 'var(--border-soft)',
              top: profileBtnRect ? profileBtnRect.bottom + 4 : 0,
              right: 16,
            }}
          >
            {/* User info header */}
            <div
              className="px-4 py-3 border-b"
              style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}
            >
              <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {userName || 'User'}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Signed in
              </div>
            </div>
            {/* Menu items */}
            <div className="py-1">
              <button
                onClick={() => {
                  setActiveTab('profile');
                  setProfileMenuOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors hover:brightness-125"
                style={{
                  color: 'var(--text-primary)',
                  backgroundColor: activeTab === 'profile' ? 'var(--accent-muted)' : 'transparent',
                }}
              >
                <User className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                My Profile
              </button>
              <button
                onClick={() => {
                  setActiveTab('business-settings');
                  setProfileMenuOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors hover:brightness-125"
                style={{
                  color: 'var(--text-primary)',
                  backgroundColor:
                    activeTab === 'business-settings' ? 'var(--accent-muted)' : 'transparent',
                }}
              >
                <Settings className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                Business Settings
              </button>
            </div>
            {/* Logout */}
            {onLogout && (
              <div className="border-t py-1" style={{ borderColor: 'var(--border-soft)' }}>
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors"
                  style={{ color: 'var(--red)' }}
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Feedback button — appears on every page with automatic context */}
      <FeedbackButton
        page={getTabLabel(activeTab)}
        context={managedTenantName ? `Viewing as: ${managedTenantName}` : undefined}
      />
    </>
  );
}
