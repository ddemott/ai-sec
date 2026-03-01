'use client'

import React, { useState, ReactNode } from 'react'
import { 
  Calendar, 
  Users, 
  Settings, 
  BarChart3,
  Bot
} from 'lucide-react'

interface LayoutProps {
  children: ReactNode;
  activeTab: string;
  setActiveTab: (tab: any) => void;
}

export function OutlookLayout({ children, activeTab, setActiveTab }: LayoutProps) {
  return (
    <div className="flex h-screen bg-white text-gray-800 overflow-hidden font-sans flex-col md:flex-row">
      
      {/* 1. SIDEBAR (Desktop / iPad) */}
      <aside className="hidden md:flex w-16 flex-col items-center py-4 bg-[#f3f2f1] border-r border-gray-200">
        <div className="mb-8 p-2 bg-blue-600 rounded-md shadow-md">
          <Calendar className="text-white w-6 h-6" />
        </div>
        
        <nav className="flex flex-col space-y-4 flex-1 text-gray-900">
          <button 
            title="Appointments"
            onClick={() => setActiveTab('appointments')}
            className={`p-3 rounded-md transition-all ${activeTab === 'appointments' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
          >
            <Calendar className="w-6 h-6" />
          </button>
          
          <button 
            title="People"
            onClick={() => setActiveTab('crm')}
            className={`p-3 rounded-md transition-all ${activeTab === 'crm' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
          >
            <Users className="w-6 h-6" />
          </button>

          <button 
            title="AI Tuning"
            onClick={() => setActiveTab('ai-tuning')}
            className={`p-3 rounded-md transition-all ${activeTab === 'ai-tuning' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
          >
            <Bot className="w-6 h-6" />
          </button>

          <button 
            title="Analytics"
            onClick={() => setActiveTab('analytics')}
            className={`p-3 rounded-md transition-all ${activeTab === 'analytics' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
          >
            <BarChart3 className="w-6 h-6" />
          </button>
        </nav>

        <div className="pb-4">
          <button title="Settings" onClick={() => setActiveTab('settings')} className={`p-3 rounded-md transition-all ${activeTab === 'settings' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}>
            <Settings className="w-6 h-6" />
          </button>
        </div>
      </aside>

      {/* 2. DYNAMIC CONTENT AREA */}
      <div className="flex flex-1 overflow-hidden">
        {children}
      </div>

      {/* 3. BOTTOM NAVIGATION (Mobile Only) */}
      <nav className="md:hidden flex bg-[#f3f2f1] border-t border-gray-200 h-16 safe-area-pb">
        <button 
          onClick={() => setActiveTab('appointments')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'appointments' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Schedule</span>
        </button>
        <button 
          onClick={() => setActiveTab('crm')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'crm' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">People</span>
        </button>
        <button 
          onClick={() => setActiveTab('ai-tuning')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'ai-tuning' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <Bot className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Tuning</span>
        </button>
        <button 
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'analytics' ? 'text-blue-600' : 'text-gray-500'}`}
        >
          <BarChart3 className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Insights</span>
        </button>
      </nav>
    </div>
  )
}
