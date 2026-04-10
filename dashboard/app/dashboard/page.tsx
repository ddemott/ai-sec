'use client'

import React, { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import LoginView from '@/components/LoginView'
import { OutlookLayout } from '@/components/OutlookLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
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
  }, [])

  const handleLoginSuccess = (data: { tenant_id: string; user_name: string }) => {
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
    </OutlookLayout>
  )
}
