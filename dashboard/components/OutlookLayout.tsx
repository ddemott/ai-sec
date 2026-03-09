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
  Wrench
} from 'lucide-react'

type Tab = 'appointments' | 'crm' | 'ai-tuning' | 'analytics' | 'settings' | 'all-businesses' | 'manage-resources';

interface LayoutProps {
  children: ReactNode;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  onLogout?: () => void;
  userName?: string | null;
  isAdmin?: boolean;
}

export function OutlookLayout({ children, activeTab, setActiveTab, onLogout, userName, isAdmin }: LayoutProps) {
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [mounted, setMounted] = useState(false)

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

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
  }

  return (
    <div className="flex h-screen bg-white dark:bg-[#111] text-gray-900 dark:text-gray-100 overflow-hidden font-sans flex-col md:flex-row transition-colors duration-200">
      
      {/* 1. SIDEBAR (Desktop / iPad) */}
      <aside className="hidden md:flex w-16 flex-col items-center py-4 bg-[#f3f2f1] dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <div className="mb-8 p-2 bg-blue-600 rounded-md shadow-md">
          <Calendar className="text-white w-6 h-6" />
        </div>
        
        <nav className="flex flex-col space-y-4 flex-1 text-gray-900 dark:text-gray-100">
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
            title="People"
            onClick={() => setActiveTab('crm')}
            className={`p-3 rounded-md transition-all ${activeTab === 'crm' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
          >
            <Users className="w-6 h-6" />
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
      <div className="flex flex-1 overflow-hidden bg-white dark:bg-[#111] transition-colors duration-200">
        {children}
      </div>

      {/* 3. BOTTOM NAVIGATION (Mobile Only) */}
      <nav className="md:hidden flex bg-[#f3f2f1] dark:bg-[#1a1a1a] border-t border-gray-200 dark:border-gray-800 h-16 safe-area-pb transition-colors duration-200">
        <button 
          onClick={() => setActiveTab('appointments')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'appointments' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Schedule</span>
        </button>
        <button 
          onClick={() => setActiveTab('crm')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'crm' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">People</span>
        </button>
        <button 
          onClick={() => setActiveTab('ai-tuning')}
          className={`flex-1 flex flex-col items-center justify-center ${activeTab === 'ai-tuning' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}
        >
          <Bot className="w-5 h-5" />
          <span className="text-[10px] mt-1 font-medium">Tuning</span>
        </button>
        <button 
          onClick={toggleDarkMode}
          className="flex-1 flex flex-col items-center justify-center text-gray-500"
        >
          {isDarkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
          <span className="text-[10px] mt-1 font-medium">{isDarkMode ? 'Light' : 'Dark'}</span>
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
