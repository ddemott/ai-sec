'use client'

import React, { useState } from 'react'
import DashboardHome from '@/components/DashboardHome'
import SchedulerView from '@/components/SchedulerView'
import CRMView from '@/components/CRMView'
import MyTeamView from '@/components/MyTeamView'
import MyBusinessView from '@/components/MyBusinessView'
import AIInsightsView from '@/components/AIInsightsView'
import SettingsView from '@/components/SettingsView'
import SuperAdminDashboard from '@/components/SuperAdminDashboard'
import LoginView from '@/components/LoginView'
import { OutlookLayout } from '@/components/OutlookLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useSessionContext } from '@/lib/SessionContext'

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
        {activeTab === 'dashboard' && <DashboardHome overrideTenantId={managedTenantId} onNavigate={setActiveTab} />}
        {activeTab === 'schedule' && <SchedulerView overrideTenantId={managedTenantId} />}
        {activeTab === 'customers' && <CRMView overrideTenantId={managedTenantId} />}
        {activeTab === 'my-team' && <MyTeamView overrideTenantId={managedTenantId} />}
        {activeTab === 'my-business' && <MyBusinessView overrideTenantId={managedTenantId} />}
        {activeTab === 'ai-insights' && <AIInsightsView overrideTenantId={managedTenantId} />}
        {activeTab === 'settings' && <SettingsView overrideTenantId={managedTenantId} />}
      </ErrorBoundary>
    </OutlookLayout>
  )
}
