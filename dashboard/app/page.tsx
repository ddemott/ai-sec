'use client'

import React, { useState, useEffect } from 'react'
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

type Tab = 'appointments' | 'crm' | 'ai-tuning' | 'analytics' | 'settings' | 'all-businesses' | 'manage-resources' | 'service-catalog' | 'staff' | 'skill-matrix' | 'knowledge-base' | 'staff-shifts'

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000'

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('appointments')
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [managedTenantId, setManagedTenantId] = useState<string | null>(null)
  const [managedTenantName, setManagedTenantName] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for session in local storage
    const storedTenantId = localStorage.getItem('tenantId')
    const storedUserName = localStorage.getItem('userName')
    
    if (storedTenantId) {
      setTenantId(storedTenantId)
      setUserName(storedUserName)
      const isSuper = storedTenantId === SUPER_ADMIN_TENANT_ID
      setIsAdmin(isSuper)
      
      // If NOT a super admin, the managed tenant is always themselves
      if (!isSuper) {
        setManagedTenantId(storedTenantId)
      }

      if (isSuper) {
        setActiveTab('all-businesses')
      }
    }
    setLoading(false)
  }, [])

  const handleLoginSuccess = (data: { tenant_id: string; user_name: string }) => {
    setTenantId(data.tenant_id)
    setUserName(data.user_name)
    const isSuper = data.tenant_id === SUPER_ADMIN_TENANT_ID
    setIsAdmin(isSuper)
    
    if (!isSuper) {
      setManagedTenantId(data.tenant_id)
    }

    if (isSuper) {
      setActiveTab('all-businesses')
    } else {
      setActiveTab('appointments')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('tenantId')
    localStorage.removeItem('userName')
    setTenantId(null)
    setManagedTenantId(null)
    setManagedTenantName(null)
    setUserName(null)
    setIsAdmin(false)
  }

  const handleSelectManagedTenant = (id: string, name: string) => {
    setManagedTenantId(id)
    setManagedTenantName(name)
  }

  if (loading) return null

  if (!tenantId) {
    return (
      <div className="relative h-screen w-screen overflow-hidden">
        <LoginView onLoginSuccess={handleLoginSuccess} />
        {/* DEV BYPASS */}
        <div className="absolute bottom-4 right-4 z-50">
          <button 
            onClick={() => handleLoginSuccess({ tenant_id: SUPER_ADMIN_TENANT_ID, user_name: 'Dev Admin' })}
            className="px-4 py-2 bg-gray-100 text-gray-400 text-[10px] font-bold uppercase rounded hover:bg-gray-200 transition"
          >
            [DEV] Bypass to SuperAdmin
          </button>
        </div>
      </div>
    )
  }

  return (
    <OutlookLayout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab}
      onLogout={handleLogout}
      userName={userName}
      isAdmin={isAdmin}
      managedTenantName={managedTenantName}
      managedTenantId={managedTenantId}
      onSelectTenant={handleSelectManagedTenant}
    >
        {activeTab === 'all-businesses' && (
          <SuperAdminDashboard onSelectTenant={handleSelectManagedTenant} currentTenantId={managedTenantId} />
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
    </OutlookLayout>
  )
}
