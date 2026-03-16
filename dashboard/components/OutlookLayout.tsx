'use client'

import React, { ReactNode, useEffect, useState } from 'react'
import { 
  Calendar, 
  Users, 
  Settings, 
  BarChart3,
  Bot,
  LogOut,
  User,
  Globe,
  Sun,
  Moon,
  Wrench,
  ShieldCheck,
  LayoutGrid,
  BookOpen,
  Clock,
  Award,
  ChevronRight
} from 'lucide-react'
import { Api } from '../lib/api'

type Tab = 'appointments' | 'crm' | 'ai-tuning' | 'analytics' | 'settings' | 'all-businesses' | 'manage-resources' | 'service-catalog' | 'staff' | 'skill-matrix' | 'knowledge-base' | 'staff-shifts';

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
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [allTenants, setAllTenants] = useState<any[]>([])

  useEffect(() => {
    // Initial load
    const savedTheme = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setIsDarkMode(true)
    }
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [isDarkMode, mounted])

  useEffect(() => {
    if (isAdmin) {
      Api.tenants.list().then(data => setAllTenants(Array.isArray(data) ? data : []))
    }
  }, [isAdmin])

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
  }

  return (
    <div className="flex h-screen bg-white dark:bg-[#111] text-gray-900 dark:text-gray-100 overflow-hidden font-sans flex-col md:flex-row transition-colors duration-200">
      
      {/* 1. SIDEBAR (Desktop / iPad) */}
      <aside aria-label="Main navigation" className="hidden md:flex w-16 flex-col items-center py-4 bg-[#f3f2f1] dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <div className="mb-8 p-2 bg-blue-600 rounded-md shadow-md">
          <Calendar className="text-white w-6 h-6" />
        </div>
        
        <nav aria-label="Sidebar navigation" className="flex flex-col space-y-4 flex-1 text-gray-900 dark:text-gray-100 overflow-y-auto no-scrollbar">
          {isAdmin && (
            <button 
              title="All Businesses"
              onClick={() => setActiveTab('all-businesses')}
              className={`p-3 rounded-md transition-all ${activeTab === 'all-businesses' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
            >
              <Globe className="w-6 h-6" />
            </button>
          )}
          <button 
            title="Appointments"
            onClick={() => setActiveTab('appointments')}
            className={`p-3 rounded-md transition-all ${activeTab === 'appointments' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Calendar className="w-6 h-6" />
          </button>
          
          <button 
            title="People (CRM)"
            onClick={() => setActiveTab('crm')}
            className={`p-3 rounded-md transition-all ${activeTab === 'crm' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Users className="w-6 h-6" />
          </button>

          <button 
            title="Skill Matrix"
            onClick={() => setActiveTab('skill-matrix')}
            className={`p-3 rounded-md transition-all ${activeTab === 'skill-matrix' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <LayoutGrid className="w-6 h-6" />
          </button>

          <button 
            title="Knowledge Base"
            onClick={() => setActiveTab('knowledge-base')}
            className={`p-3 rounded-md transition-all ${activeTab === 'knowledge-base' ? 'bg-white dark:bg-[#333] shadow-sm text-orange-600 dark:text-orange-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <BookOpen className="w-6 h-6" />
          </button>

          <button 
            title="Staff Management"
            onClick={() => setActiveTab('staff')}
            className={`p-3 rounded-md transition-all ${activeTab === 'staff' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <ShieldCheck className="w-6 h-6" />
          </button>

          <button 
            title="Staff Shifts"
            onClick={() => setActiveTab('staff-shifts')}
            className={`p-3 rounded-md transition-all ${activeTab === 'staff-shifts' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Clock className="w-6 h-6" />
          </button>

          <button 
            title="Service Catalog"
            onClick={() => setActiveTab('service-catalog')}
            className={`p-3 rounded-md transition-all ${activeTab === 'service-catalog' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Settings className="w-6 h-6" />
          </button>

          <button 
            title="AI Tuning"
            onClick={() => setActiveTab('ai-tuning')}
            className={`p-3 rounded-md transition-all ${activeTab === 'ai-tuning' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Bot className="w-6 h-6" />
          </button>

          <button 
            title="Analytics"
            onClick={() => setActiveTab('analytics')}
            className={`p-3 rounded-md transition-all ${activeTab === 'analytics' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <BarChart3 className="w-6 h-6" />
          </button>

          <button 
            title="Manage Resources"
            onClick={() => setActiveTab('manage-resources')}
            className={`p-3 rounded-md transition-all ${activeTab === 'manage-resources' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Wrench className="w-6 h-6" />
          </button>
        </nav>

        <div className="flex flex-col space-y-4 pb-4">
          <button 
            onClick={toggleDarkMode}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="p-3 rounded-md text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333] transition-all"
          >
            {isDarkMode ? <Sun className="w-6 h-6 text-amber-400" /> : <Moon className="w-6 h-6" />}
          </button>
          <button 
            title={`User: ${userName || 'Profile'}`}
            className="p-3 rounded-md text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333] transition-all"
          >
            <User className="w-6 h-6" />
          </button>
          <button 
            title="Settings" 
            onClick={() => setActiveTab('settings')} 
            className={`p-3 rounded-md transition-all ${activeTab === 'settings' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Settings className="w-6 h-6" />
          </button>
          {onLogout && (
            <button 
              title="Logout" 
              onClick={onLogout}
              className="p-3 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
            >
              <LogOut className="w-6 h-6" />
            </button>
          )}
        </div>
      </aside>

      {/* 2. DYNAMIC CONTENT AREA */}
      <div role="main" className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-[#111] transition-colors duration-200">
        {isAdmin && managedTenantName && (
          <header className="bg-blue-600 text-white px-6 py-2 flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Admin Mode</span>
              <span className="mx-2 opacity-30">|</span>
              
              {/* Quick Switcher */}
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded-lg border border-white/10 hover:bg-white/20 transition-all cursor-pointer group relative">
                <span className="text-sm font-bold truncate max-w-[200px]">{managedTenantName}</span>
                <ChevronRight className="w-3 h-3 rotate-90 opacity-50 group-hover:opacity-100 transition-all" />
                
                {/* Hidden hover dropdown */}
                <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-[#222] text-gray-900 dark:text-gray-100 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 hidden group-hover:block z-[100] animate-in fade-in slide-in-from-top-1 overflow-hidden">
                  <div className="p-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Switch Active Business
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {allTenants.map(t => (
                      <button
                        key={t.id}
                        onClick={() => onSelectTenant && onSelectTenant(t.id, t.name)}
                        className={`w-full text-left px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex flex-col transition-colors border-b border-gray-50 dark:border-gray-800/50 ${managedTenantId === t.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      >
                        <span className="text-sm font-bold">{t.name}</span>
                        <span className="text-[10px] opacity-50 uppercase tracking-tighter">{t.business_type}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <button 
              onClick={() => setActiveTab('all-businesses')}
              className="text-[10px] font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full transition-all"
            >
              Configure Businesses
            </button>
          </header>
        )}
        <div className="flex-1 flex overflow-hidden">
          {children}
        </div>
      </div>

      {/* 3. BOTTOM NAVIGATION (Mobile Only) */}
      <nav aria-label="Mobile navigation" className="md:hidden flex bg-[#f3f2f1] dark:bg-[#1a1a1a] border-t border-gray-200 dark:border-gray-800 h-16 safe-area-pb transition-colors duration-200">
        <button 
          onClick={() => setActiveTab('appointments')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'appointments' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Schedule</span>
        </button>
        <button 
          onClick={() => setActiveTab('skill-matrix')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'skill-matrix' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Skills</span>
        </button>
        <button 
          onClick={() => setActiveTab('staff-shifts')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'staff-shifts' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}
        >
          <Clock className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Shifts</span>
        </button>
        <button 
          onClick={() => setActiveTab('knowledge-base')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'knowledge-base' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-500'}`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Knowledge</span>
        </button>
        <button 
          onClick={onLogout}
          className="flex-1 flex flex-col items-center justify-center text-red-500"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Exit</span>
        </button>
      </nav>
    </div>
  )
}
