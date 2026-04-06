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
import { useTheme, THEMES } from '@/lib/ThemeContext'
import { useSessionContext } from '@/lib/SessionContext'
import { FeedbackButton } from './ui/FeedbackButton'

type Tab = 'dashboard' | 'schedule' | 'customers' | 'my-team' | 'my-business' | 'ai-insights' | 'settings' | 'all-businesses';

type TopMode = 'front-desk' | 'back-office';

interface LayoutProps {
  children: ReactNode;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  onLogout?: () => void;
  userName?: string | null;
  isAdmin?: boolean;
  managedTenantName?: string | null;
  managedTenantId?: string | null;
  onSelectTenant?: (id: string, name: string) => void;
}

const FRONT_DESK_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Users },
]

const BACK_OFFICE_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'my-business', label: 'Services & Resources', icon: Wrench },
  { id: 'my-team', label: 'Staff & Shifts', icon: UserCog },
  { id: 'ai-insights', label: 'AI & Knowledge', icon: Bot },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function getMode(tab: Tab): TopMode {
  if (['dashboard', 'schedule', 'customers'].includes(tab)) return 'front-desk'
  return 'back-office'
}

export function OutlookLayout({
  children,
  activeTab,
  setActiveTab,
  onLogout,
  userName,
  isAdmin,
  managedTenantName,
  managedTenantId,
  onSelectTenant
}: LayoutProps) {
  const { theme, setTheme, themeInfo } = useTheme()
  const [allTenants, setAllTenants] = useState<{ id: string; name: string; business_type: string }[]>([])
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false)
  const tenantBtnRef = useRef<HTMLButtonElement>(null)

  const { tenantsVersion } = useSessionContext()

  const currentMode = activeTab === 'all-businesses' ? 'front-desk' : getMode(activeTab)
  const subTabs = currentMode === 'front-desk' ? FRONT_DESK_TABS : BACK_OFFICE_TABS

  useEffect(() => {
    if (isAdmin) {
      Api.tenants.list().then(data => {
        setAllTenants(Array.isArray(data) ? data : [])
      })
    }
  }, [isAdmin, tenantsVersion])

  const handleModeSwitch = (mode: TopMode) => {
    if (mode === 'front-desk' && currentMode !== 'front-desk') {
      setActiveTab('dashboard')
    } else if (mode === 'back-office' && currentMode !== 'back-office') {
      setActiveTab('my-business')
    }
  }

  return (
    <>
    <div className="flex flex-col h-screen overflow-hidden transition-colors duration-200" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>

      {/* ADMIN HEADER (super-admin only) */}
      {isAdmin && managedTenantName && (
        <header className="bg-blue-600 text-white px-6 py-2 flex items-center justify-between shadow-sm shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Admin Mode</span>
            <span className="mx-2 opacity-30">|</span>
            <button
              ref={tenantBtnRef}
              onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
              className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded-lg border border-white/10 hover:bg-white/20 transition-all cursor-pointer"
            >
              <span className="text-sm font-bold truncate max-w-[200px]">{managedTenantName}</span>
              <ChevronRight className="w-3 h-3 transition-transform rotate-90" />
            </button>
          </div>
          <button
            onClick={() => setActiveTab('all-businesses')}
            className="text-[10px] font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full transition-all"
          >
            Configure Businesses
          </button>
        </header>
      )}

      {/* TOP NAVIGATION BAR */}
      <div className="shrink-0 border-b transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center justify-between px-4">
          {/* Left: Mode tabs + Sub-tabs */}
          <div className="flex items-center gap-0">
            {/* Front Desk / Back Office toggle */}
            <div className="flex mr-4" role="tablist" aria-label="Navigation mode">
              <button
                onClick={() => handleModeSwitch('front-desk')}
                role="tab"
                aria-selected={currentMode === 'front-desk'}
                className="flex items-center gap-1.5 px-4 py-3 text-sm font-bold transition-all"
                style={{
                  color: currentMode === 'front-desk' ? 'var(--accent-soft)' : 'var(--text-secondary)',
                  borderBottom: currentMode === 'front-desk' ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <Phone className="w-4 h-4" aria-hidden="true" />
                Front Desk
              </button>
              <button
                onClick={() => handleModeSwitch('back-office')}
                role="tab"
                aria-selected={currentMode === 'back-office'}
                className="flex items-center gap-1.5 px-4 py-3 text-sm font-bold transition-all"
                style={{
                  color: currentMode === 'back-office' ? 'var(--accent-soft)' : 'var(--text-secondary)',
                  borderBottom: currentMode === 'back-office' ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <Wrench className="w-4 h-4" aria-hidden="true" />
                Back Office
              </button>
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mr-4" />

            {/* Sub-tabs for current mode */}
            {subTabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className="flex items-center gap-1.5 px-3 py-3 text-sm font-medium transition-all"
                  style={{
                    color: activeTab === tab.id ? 'var(--accent-soft)' : 'var(--text-secondary)',
                    borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" style={{ opacity: activeTab === tab.id ? 1 : 0.6 }} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              )
            })}
          </div>

          {/* Right: utility buttons */}
          <div className="flex items-center gap-1">
            {isAdmin && (
              <button
                title="All Businesses"
                onClick={() => setActiveTab('all-businesses')}
                className={`p-2 rounded-md transition-all ${activeTab === 'all-businesses' ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
              >
                <Globe className="w-4 h-4" />
              </button>
            )}
            <select
              value={theme}
              onChange={e => setTheme(e.target.value as typeof theme)}
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
              title={`User: ${userName || 'Profile'}`}
              className="p-2 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all"
            >
              <User className="w-4 h-4" />
            </button>
            {onLogout && (
              <button
                title="Logout"
                onClick={onLogout}
                className="p-2 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CONTENT AREA */}
      <div role="main" className="flex-1 flex overflow-hidden">
        {children}
      </div>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav aria-label="Mobile navigation" className="md:hidden flex flex-col border-t transition-colors duration-200 safe-area-pb" style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--border)' }}>
        {/* Mode toggle */}
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => handleModeSwitch('front-desk')}
            className={`flex-1 py-2 text-xs font-bold text-center transition-all ${
              currentMode === 'front-desk'
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                : 'text-gray-400'
            }`}
          >
            Front Desk
          </button>
          <button
            onClick={() => handleModeSwitch('back-office')}
            className={`flex-1 py-2 text-xs font-bold text-center transition-all ${
              currentMode === 'back-office'
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                : 'text-gray-400'
            }`}
          >
            Back Office
          </button>
        </div>
        {/* Sub-tabs */}
        <div className="flex h-14">
          {subTabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center justify-center ${activeTab === tab.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[9px] mt-0.5 font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>

    {/* Tenant switcher dropdown */}
    {tenantDropdownOpen && (
      <>
        <div className="fixed inset-0 z-[99]" onClick={() => setTenantDropdownOpen(false)} />
        <div
          className="fixed z-[100] w-64 bg-white dark:bg-[#222] text-gray-900 dark:text-gray-100 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
          style={{
            top: tenantBtnRef.current ? tenantBtnRef.current.getBoundingClientRect().bottom + 4 : 0,
            left: tenantBtnRef.current ? tenantBtnRef.current.getBoundingClientRect().left : 0,
          }}
        >
          <div className="p-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Switch Active Business
          </div>
          <div className="max-h-60 overflow-y-auto">
            {allTenants.map(t => (
              <button
                key={t.id}
                onClick={() => { if (onSelectTenant) onSelectTenant(t.id, t.name); setTenantDropdownOpen(false); if (activeTab === 'all-businesses') setActiveTab('dashboard'); }}
                className={`w-full text-left px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex flex-col transition-colors border-b border-gray-50 dark:border-gray-800/50 ${managedTenantId === t.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
              >
                <span className="text-sm font-bold">{t.name}</span>
                <span className="text-[10px] opacity-50 uppercase tracking-tighter">{t.business_type}</span>
              </button>
            ))}
          </div>
        </div>
      </>
    )}

    {/* Feedback button — appears on every page with automatic context */}
    <FeedbackButton
      page={`${currentMode === 'front-desk' ? 'Front Desk' : 'Back Office'} > ${
        FRONT_DESK_TABS.find(t => t.id === activeTab)?.label ||
        BACK_OFFICE_TABS.find(t => t.id === activeTab)?.label ||
        activeTab
      }`}
      context={managedTenantName ? `Viewing as: ${managedTenantName}` : undefined}
    />
    </>
  )
}
