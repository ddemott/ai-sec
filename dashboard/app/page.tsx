'use client'

import React, { useState } from 'react'
import AppointmentView from '@/components/AppointmentView'
import CRMView from '@/components/CRMView'
import AIConfigView from '@/components/AIConfigView'
import { OutlookLayout } from '@/components/OutlookLayout'

type Tab = 'appointments' | 'crm' | 'ai-tuning' | 'analytics' | 'settings'

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('appointments')

  return (
    <OutlookLayout activeTab={activeTab} setActiveTab={setActiveTab}>
        {activeTab === 'appointments' && <AppointmentView />}
        {activeTab === 'crm' && <CRMView />}
        {activeTab === 'ai-tuning' && <AIConfigView />}
        {activeTab === 'analytics' && (
          <div className="flex-1 flex items-center justify-center bg-gray-50 text-gray-400 italic">
            Analytics view coming soon...
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="flex-1 flex items-center justify-center bg-gray-50 text-gray-400 italic text-gray-900 font-bold">
            Settings view...
          </div>
        )}
    </OutlookLayout>
  )
}
