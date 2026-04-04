'use client'

import React, { useState } from 'react'
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
const SuperAdminDashboard = dynamic(() => import('@/components/SuperAdminDashboard'), { ssr: false })

export type Tab = 'dashboard' | 'schedule' | 'customers' | 'my-team' | 'my-business' | 'ai-insights' | 'settings' | 'all-businesses'

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

  const [activeTab, setActiveTab] = useState<Tab>(() =>
    typeof window !== 'undefined' && localStorage.getItem('tenantId') === '00000000-0000-0000-0000-000000000000'
      ? 'all-businesses'
      : 'dashboard'
  )

  const handleLoginSuccess = (data: { tenant_id: string; user_name: string }) => {
    login(data)
    if (data.tenant_id === '00000000-0000-0000-0000-000000000000') {
      setActiveTab('all-businesses')
    } else {
      setActiveTab('dashboard')
    }
  }

  if (loading) return null

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
      setActiveTab={setActiveTab}
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
        {activeTab === 'dashboard' && <DashboardHome onNavigate={setActiveTab} />}
        {activeTab === 'schedule' && <SchedulerView />}
        {activeTab === 'customers' && <CRMView />}
        {activeTab === 'my-team' && <MyTeamView />}
        {activeTab === 'my-business' && <MyBusinessView />}
        {activeTab === 'ai-insights' && <AIInsightsView />}
        {activeTab === 'settings' && <SettingsView />}
      </ErrorBoundary>
    </OutlookLayout>
  )
}
