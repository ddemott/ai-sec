'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import LoginView from '@/components/LoginView'
import { OutlookLayout } from '@/components/OutlookLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ShortcutsHelpModal } from '@/components/ui/ShortcutsHelpModal'
import { useKeyboardShortcuts, type Shortcut } from '@/lib/useKeyboardShortcuts'
import { useSessionContext } from '@/lib/SessionContext'

// Lazy load tab content — only loads the JS for the active tab
const DashboardHome = dynamic(() => import('@/components/DashboardHome'), { ssr: false })
const SchedulerView = dynamic(() => import('@/components/SchedulerView'), { ssr: false })
const CRMView = dynamic(() => import('@/components/CRMView'), { ssr: false })
const MyTeamView = dynamic(() => import('@/components/MyTeamView'), { ssr: false })
const MyBusinessView = dynamic(() => import('@/components/MyBusinessView'), { ssr: false })
const AIInsightsView = dynamic(() => import('@/components/AIInsightsView'), { ssr: false })
const SettingsView = dynamic(() => import('@/components/SettingsView'), { ssr: false })
const ProfileView = dynamic(() => import('@/components/ProfileView'), { ssr: false })
const BusinessSettingsView = dynamic(() => import('@/components/BusinessSettingsView'), { ssr: false })
const SuperAdminDashboard = dynamic(() => import('@/components/SuperAdminDashboard'), { ssr: false })
const VoiceCallsView = dynamic(() => import('@/components/VoiceCallsView'), { ssr: false })

export type Tab = 'dashboard' | 'schedule' | 'customers' | 'calls' | 'my-team' | 'my-business' | 'ai-insights' | 'settings' | 'all-businesses' | 'profile' | 'business-settings'

export default function DashboardPage() {
  const {
    tenantId,
    userName,
    role,
    isAdmin,
    managedTenantId,
    managedTenantName,
    loading,
    login,
    logout,
    selectManagedTenant,
  } = useSessionContext()

  const VALID_TABS: Tab[] = ['dashboard', 'schedule', 'customers', 'calls', 'my-team', 'my-business', 'ai-insights', 'settings', 'all-businesses', 'profile', 'business-settings']

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'dashboard'
    const urlTab = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (urlTab && VALID_TABS.includes(urlTab)) return urlTab
    return localStorage.getItem('tenantId') === '00000000-0000-0000-0000-000000000000'
      ? 'all-businesses'
      : 'dashboard'
  })

  // Sync tab to URL so links are shareable and back button works
  const handleSetActiveTab = useCallback((tab: Tab) => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.pushState({}, '', url.toString())
  }, [])

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const urlTab = new URLSearchParams(window.location.search).get('tab') as Tab | null
      if (urlTab && VALID_TABS.includes(urlTab)) setActiveTab(urlTab)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard shortcuts (UX audit #10). Help modal is gated by `?`.
  // Chord nav `g h/s/c/k` maps to the four primary tabs; `n` is wired
  // to a global "open new booking" custom event that Home listens for.
  // Custom event keeps the shortcut layer at the page level without
  // having to plumb a setQuickBookOpen handler through OutlookLayout.
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const shortcuts: Shortcut[] = useMemo(() => [
    { key: 'g h', label: 'Go to Home', category: 'navigation', run: () => handleSetActiveTab('dashboard') },
    { key: 'g s', label: 'Go to Schedule', category: 'navigation', run: () => handleSetActiveTab('schedule') },
    { key: 'g c', label: 'Go to Customers', category: 'navigation', run: () => handleSetActiveTab('customers') },
    { key: 'g k', label: 'Go to Calls', category: 'navigation', run: () => handleSetActiveTab('calls') },
    {
      key: 'n',
      label: 'New booking',
      category: 'actions',
      run: () => {
        // If not on Home, route there first so the QuickBook panel
        // mounts and can receive the event.
        if (activeTab !== 'dashboard') handleSetActiveTab('dashboard')
        // Defer to the next tick so Home's listener is mounted.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('ai-sec:new-booking'))
        }, 50)
      },
    },
    {
      // Focus the active tab's search input. Search-bearing views opt
      // in by adding `data-shortcut-target="search"` to their input.
      // We walk the DOM at fire-time so we don't have to wire a
      // per-tab event listener like New Booking does. The first match
      // wins — if a page renders multiple search inputs, order them
      // so the one most useful for a `/` press is first in the tree.
      key: '/',
      label: 'Focus search',
      category: 'actions',
      run: () => {
        const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-shortcut-target="search"]')
        if (el) {
          el.focus()
          // Select existing text so the user can replace it without
          // having to clear first — mirrors browser address-bar behavior.
          if ('select' in el && typeof el.select === 'function') el.select()
        }
      },
    },
    { key: '?', label: 'Show this shortcuts cheat-sheet', category: 'help', run: () => setShortcutsHelpOpen(true) },
  ], [activeTab, handleSetActiveTab])
  useKeyboardShortcuts(shortcuts, !!tenantId)

  const handleLoginSuccess = (data: { tenant_id: string; user_name: string; role?: string }) => {
    login(data)
    if (data.tenant_id === '00000000-0000-0000-0000-000000000000') {
      handleSetActiveTab('all-businesses')
    } else {
      handleSetActiveTab('dashboard')
    }
  }

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-base, #111)' }}>
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!tenantId) {
    return (
      <div className="relative h-screen w-screen overflow-hidden">
        <LoginView onLoginSuccess={handleLoginSuccess} />
      </div>
    )
  }

  return (
    <OutlookLayout
      activeTab={activeTab}
      setActiveTab={handleSetActiveTab}
      onLogout={logout}
      userName={userName}
      role={role}
      isAdmin={isAdmin}
      managedTenantName={managedTenantName}
      managedTenantId={managedTenantId}
      onSelectTenant={selectManagedTenant}
    >
      <ErrorBoundary>
        {activeTab === 'all-businesses' && (
          <SuperAdminDashboard onSelectTenant={selectManagedTenant} currentTenantId={managedTenantId} />
        )}
        {activeTab === 'dashboard' && <DashboardHome onNavigate={handleSetActiveTab} />}
        {activeTab === 'schedule' && <SchedulerView />}
        {activeTab === 'customers' && <CRMView />}
        {activeTab === 'calls' && <VoiceCallsView />}
        {activeTab === 'my-team' && <MyTeamView />}
        {activeTab === 'my-business' && <MyBusinessView />}
        {activeTab === 'ai-insights' && <AIInsightsView />}
        {activeTab === 'settings' && <SettingsView />}
        {activeTab === 'profile' && <ProfileView />}
        {activeTab === 'business-settings' && <BusinessSettingsView />}
      </ErrorBoundary>
      <ShortcutsHelpModal
        isOpen={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
        shortcuts={shortcuts}
      />
    </OutlookLayout>
  )
}
