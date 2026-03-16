'use client'

import React, { useState } from 'react'
import AppointmentView from '@/components/AppointmentView'
import CRMView from '@/components/CRMView'
import AIConfigView from '@/components/AIConfigView'
import SettingsView from '@/components/SettingsView'
import SuperAdminDashboard from '@/components/SuperAdminDashboard'
import LoginView from '@/components/LoginView'
import { OutlookLayout } from '@/components/OutlookLayout'
import ResourceManagerView from '@/components/ResourceManagerView'
import ServiceAssignmentView from '@/components/ServiceAssignmentView'
import EmployeeManagementView from '@/components/EmployeeManagementView'
import SkillMatrixView from '@/components/SkillMatrixView'
import KnowledgeBaseView from '@/components/KnowledgeBaseView'
import ShiftManagementView from '@/components/ShiftManagementView'
import AnalyticsView from '@/components/AnalyticsView'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useSessionContext } from '@/lib/SessionContext'

type Tab = 'appointments' | 'crm' | 'ai-tuning' | 'analytics' | 'settings' | 'all-businesses' | 'manage-resources' | 'service-catalog' | 'staff' | 'skill-matrix' | 'knowledge-base' | 'staff-shifts'

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
      : 'appointments'
  )

  const handleLoginSuccess = (data: { tenant_id: string; user_name: string }) => {
    login(data)
    if (data.tenant_id === '00000000-0000-0000-0000-000000000000') {
      setActiveTab('all-businesses')
    } else {
      setActiveTab('appointments')
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
        {activeTab === 'appointments' && <AppointmentView overrideTenantId={managedTenantId} />}
        {activeTab === 'crm' && <CRMView overrideTenantId={managedTenantId} />}
        {activeTab === 'ai-tuning' && <AIConfigView overrideTenantId={managedTenantId} />}
        {activeTab === 'analytics' && <AnalyticsView overrideTenantId={managedTenantId} />}
        {activeTab === 'settings' && <SettingsView overrideTenantId={managedTenantId} />}
        {activeTab === 'manage-resources' && <ResourceManagerView overrideTenantId={managedTenantId} />}
        {activeTab === 'service-catalog' && <ServiceAssignmentView overrideTenantId={managedTenantId} />}
        {activeTab === 'staff' && <EmployeeManagementView overrideTenantId={managedTenantId} />}
        {activeTab === 'skill-matrix' && <SkillMatrixView overrideTenantId={managedTenantId} />}
        {activeTab === 'staff-shifts' && <ShiftManagementView overrideTenantId={managedTenantId} />}
        {activeTab === 'knowledge-base' && <KnowledgeBaseView overrideTenantId={managedTenantId} />}
      </ErrorBoundary>
    </OutlookLayout>
  )
}
