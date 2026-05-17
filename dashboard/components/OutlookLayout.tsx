'use client'

import React, { ReactNode, useEffect, useRef, useState } from 'react'
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
} from 'lucide-react'
import { Api } from '../lib/api'
import { FolderTab, FolderTabBar } from './ui/FolderTabs'
import { useTheme, THEMES } from '@/lib/ThemeContext'
import { useSessionContext, type UserRole } from '@/lib/SessionContext'
import { FeedbackButton } from './ui/FeedbackButton'
import { SetupProgressPill } from './SetupProgressPill'

type Tab = 'dashboard' | 'schedule' | 'customers' | 'calls' | 'my-team' | 'my-business' | 'ai-insights' | 'settings' | 'all-businesses' | 'profile' | 'business-settings';

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
]

// Top-level labels say what the section is FOR, not what's inside the
// database. Compound noun-pairs ("Services & Resources") describe the
// schema; possessive plain-English ("My Business") describes the user's
// job-to-be-done. Also: shorter labels survive the mobile bottom-nav's
// 64px-wide tap targets without truncation.
const ADVANCED_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'my-business', label: 'My Business', icon: Wrench },
  { id: 'my-team', label: 'My Team', icon: UserCog },
  { id: 'ai-insights', label: 'Phone Assistant', icon: Bot },
]

const ACCOUNT_TABS: Record<'profile' | 'business-settings' | 'all-businesses', string> = {
  profile: 'My Profile',
  'business-settings': 'Business Settings',
  'all-businesses': 'All Businesses',
}

function getTabLabel(tab: Tab): string {
  const match = [...PRIMARY_TABS, ...ADVANCED_TABS].find(t => t.id === tab)
  return match?.label || ACCOUNT_TABS[tab as keyof typeof ACCOUNT_TABS] || tab
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
  onSelectTenant
}: LayoutProps) {
  // WHY: front-desk staff are the dashboard's primary daily-use audience —
  // owners can configure services/skills/vocabulary, but the people who
  // actually answer calls don't need (and shouldn't see) those tabs. Super-
  // admins keep full access; the role column doesn't apply to them since
  // they're identified by tenant_id, not by users.role.
  const isFrontDeskOnly = role === 'front_desk' && !isAdmin
  const { theme, setTheme, themeInfo } = useTheme()
  const [allTenants, setAllTenants] = useState<{ tenant_id: string; name: string; business_type: string }[]>([])
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const tenantBtnRef = useRef<HTMLButtonElement>(null)
  const profileBtnRef = useRef<HTMLButtonElement>(null)

  const { tenantsVersion } = useSessionContext()
  const [unansweredCount, setUnansweredCount] = useState(0)
  // E3 (2026-05-17): count of currently-active voice calls, used as a
  // badge on the Calls tab so front-desk can see live activity at a
  // glance even when looking at another tab. Mirrors the unanswered-KB
  // pattern — refresh on activeTab change rather than poll on a timer.
  const [activeCallCount, setActiveCallCount] = useState(0)

  const visibleTabs = isFrontDeskOnly ? PRIMARY_TABS : [...PRIMARY_TABS, ...ADVANCED_TABS]

  // WHY: a front-desk-only user could still land on a management tab via a
  // stale ?tab=my-business URL or a back-button. Snap them back to Home so
  // they always land on the simplest working surface.
  useEffect(() => {
    if (!isFrontDeskOnly) return
    const restrictedTabs = new Set<Tab>(['my-business', 'my-team', 'ai-insights', 'settings', 'all-businesses'])
    if (restrictedTabs.has(activeTab)) setActiveTab('dashboard')
  }, [isFrontDeskOnly, activeTab, setActiveTab])

  // Fetch unanswered question count for KB badge
  const effectiveTenantId = managedTenantId || null
  useEffect(() => {
    if (!effectiveTenantId) return
    Api.knowledge.unanswered(effectiveTenantId)
      .then(res => setUnansweredCount(res?.questions?.length || 0))
      .catch(() => {}) // non-fatal
  }, [effectiveTenantId, activeTab])

  // E3: fetch active-call count for the Calls tab badge. Refetches on
  // every tab change so the count is fresh whenever the user is moving
  // around. Errors silently — a missing badge is better than a noisy
  // error toast on every tab switch.
  useEffect(() => {
    if (!effectiveTenantId) return
    Api.voice.getActiveCalls(effectiveTenantId)
      .then(res => setActiveCallCount(typeof res?.total === 'number' ? res.total : (res?.calls?.length || 0)))
      .catch(() => {}) // non-fatal
  }, [effectiveTenantId, activeTab])

  useEffect(() => {
    if (isAdmin) {
      Api.tenants.list().then(data => {
        setAllTenants(Array.isArray(data) ? data : [])
      })
    }
  }, [isAdmin, tenantsVersion])

  return (
    <>
    <div className="flex flex-col h-screen overflow-hidden transition-colors duration-200" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>

      {/* ADMIN HEADER (super-admin only) */}
      {isAdmin && managedTenantName && (
        <header
          className="px-6 py-2 flex items-center justify-between shadow-sm shrink-0 transition-colors duration-200"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-base)' }}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Admin Mode</span>
            <span className="mx-2 opacity-30">|</span>
            <button
              ref={tenantBtnRef}
              onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1 rounded-lg transition-all cursor-pointer"
              style={{ backgroundColor: 'rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.1)' }}
            >
              <span className="text-sm font-bold truncate max-w-[200px]">{managedTenantName}</span>
              <ChevronRight className="w-3 h-3 transition-transform rotate-90" />
            </button>
          </div>
          <button
            onClick={() => setActiveTab('all-businesses')}
            className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full transition-all"
            style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
          >
            Configure Businesses
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
                className={`p-2 rounded-md transition-all ${activeTab === 'all-businesses' ? '' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                style={activeTab === 'all-businesses' ? { color: 'var(--accent-soft)', backgroundColor: 'var(--accent-muted)' } : undefined}
              >
                <Globe className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            <SetupProgressPill />
            <select
              value={theme}
              onChange={e => setTheme(e.target.value as typeof theme)}
              aria-label={`Theme (currently ${themeInfo.name})`}
              title={`Theme: ${themeInfo.name}`}
              className="text-xs rounded-md px-2 py-1.5 cursor-pointer outline-none transition-all"
              style={{
                backgroundColor: 'var(--bg-raised)',
                borderColor: 'var(--border-soft)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-soft)',
                fontFamily: 'var(--font-body)',
              }}
            >
              {THEMES.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              ref={profileBtnRef}
              aria-label={userName ? `Account menu for ${userName}` : 'Account menu'}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              title={`Account: ${userName || 'Profile'}`}
              onClick={() => setProfileMenuOpen(!profileMenuOpen)}
              className={`p-2 rounded-md transition-all ${
                profileMenuOpen || activeTab === 'profile' || activeTab === 'business-settings'
                  ? ''
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
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
        {visibleTabs.map(tab => (
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
                style={{ backgroundColor: 'var(--danger, #dc2626)', color: 'var(--primary-text)' }}
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

      {/* MOBILE NAVIGATION — mirrors the primary tabs */}
      <nav aria-label="Mobile navigation" className="md:hidden flex flex-col border-t transition-colors duration-200 safe-area-pb" style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--border)' }}>
        <div className="flex h-14 overflow-x-auto no-scrollbar border-b" style={{ borderColor: 'var(--border)' }}>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('all-businesses')}
              className={`relative flex-1 min-w-[64px] flex flex-col items-center justify-center shrink-0 ${activeTab === 'all-businesses' ? '' : 'text-gray-500'}`}
              style={activeTab === 'all-businesses' ? { color: 'var(--accent-soft)' } : undefined}
            >
              <Globe className="w-5 h-5" />
              <span className="text-[9px] mt-0.5 font-medium">Businesses</span>
            </button>
          )}
          {visibleTabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex-1 min-w-[64px] flex flex-col items-center justify-center shrink-0 ${activeTab === tab.id ? '' : 'text-gray-500'}`}
                style={activeTab === tab.id ? { color: 'var(--accent-soft)' } : undefined}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[9px] mt-0.5 font-medium">{tab.label}</span>
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
                    style={{ backgroundColor: 'var(--danger, #dc2626)', color: 'var(--primary-text)' }}
                    aria-label={`${activeCallCount} active call${activeCallCount > 1 ? 's' : ''}`}
                  >
                    {activeCallCount > 99 ? '99+' : activeCallCount}
                  </span>
                )}
              </button>
            )
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
            top: tenantBtnRef.current ? tenantBtnRef.current.getBoundingClientRect().bottom + 4 : 0,
            left: tenantBtnRef.current ? tenantBtnRef.current.getBoundingClientRect().left : 0,
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
          <div className="max-h-60 overflow-y-auto" role="listbox" aria-label="Select active business" onKeyDown={(e) => {
            const items = e.currentTarget.querySelectorAll('[role="option"]')
            const focused = e.currentTarget.querySelector(':focus') as HTMLElement | null
            const idx = focused ? Array.from(items).indexOf(focused) : -1
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              const next = items[idx + 1] as HTMLElement | undefined
              next?.focus()
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              const prev = items[idx - 1] as HTMLElement | undefined
              prev?.focus()
            } else if (e.key === 'Enter' && focused) {
              focused.click()
            }
          }}>
            {allTenants.map(t => (
              <button
                key={t.tenant_id}
                role="option"
                aria-selected={managedTenantId === t.tenant_id}
                onClick={() => { if (onSelectTenant) onSelectTenant(t.tenant_id, t.name); setTenantDropdownOpen(false); if (activeTab === 'all-businesses') setActiveTab('dashboard'); }}
                className="w-full text-left px-4 py-3 flex flex-col transition-colors border-b hover:brightness-125"
                style={{
                  backgroundColor: managedTenantId === t.tenant_id ? 'var(--accent-muted)' : undefined,
                  borderColor: 'var(--border-soft)',
                }}
              >
                <span className="text-sm font-bold">{t.name}</span>
                <span className="text-[10px] opacity-50 uppercase tracking-tighter">{t.business_type}</span>
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
            top: profileBtnRef.current ? profileBtnRef.current.getBoundingClientRect().bottom + 4 : 0,
            right: 16,
          }}
        >
          {/* User info header */}
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{userName || 'User'}</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Signed in</div>
          </div>
          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => { setActiveTab('profile'); setProfileMenuOpen(false) }}
              className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors hover:brightness-125"
              style={{ color: 'var(--text-primary)', backgroundColor: activeTab === 'profile' ? 'var(--accent-muted)' : 'transparent' }}
            >
              <User className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              My Profile
            </button>
            <button
              onClick={() => { setActiveTab('business-settings'); setProfileMenuOpen(false) }}
              className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors hover:brightness-125"
              style={{ color: 'var(--text-primary)', backgroundColor: activeTab === 'business-settings' ? 'var(--accent-muted)' : 'transparent' }}
            >
              <Settings className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              Business Settings
            </button>
          </div>
          {/* Logout */}
          {onLogout && (
            <div className="border-t py-1" style={{ borderColor: 'var(--border-soft)' }}>
              <button
                onClick={() => { setProfileMenuOpen(false); onLogout() }}
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
  )
}
