'use client'

import React, { useState } from 'react'
import { Calendar, Lock, Mail, Loader2, Bot } from 'lucide-react'

interface LoginViewProps {
  onLoginSuccess: (data: { tenant_id: string; user_name: string }) => void;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('http://localhost:3000/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        localStorage.setItem('tenantId', data.tenant_id)
        localStorage.setItem('userName', data.user_name)
        onLoginSuccess(data)
      } else {
        setError(data.error || 'Login failed. Please try again.')
      }
    } catch (err) {
      setError('Connection error. Is the backend server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f3f2f1] dark:bg-[#111] flex flex-col items-center justify-center p-4 font-sans text-gray-900 dark:text-gray-100 transition-colors duration-200">
      <div className="w-full max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl overflow-hidden border border-gray-200 dark:border-gray-800">
        
        {/* Header/Logo */}
        <div className="p-8 bg-blue-600 flex flex-col items-center text-white">
          <div className="bg-white/20 p-3 rounded-xl mb-4 backdrop-blur-sm">
            <Bot className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">AI Secretary Portal</h1>
          <p className="text-blue-100 text-sm mt-1">Multi-Tenant Management Console</p>
        </div>

        <div className="p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 text-red-700 dark:text-red-400 text-sm rounded-r-md">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 ml-1">
                Business Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-[#2a2a2a] outline-none transition-all text-sm text-gray-900 dark:text-gray-100"
                  placeholder="admin@business.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 ml-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-[#2a2a2a] outline-none transition-all text-sm text-gray-900 dark:text-gray-100"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Sign In to Dashboard'
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
            <p className="text-xs text-gray-400 italic">
              "Providing human-like AI reception for modern businesses."
            </p>
          </div>
        </div>
      </div>
      
      <div className="mt-8 flex items-center text-gray-400 text-xs">
        <Calendar className="w-4 h-4 mr-2" />
        <span>AI Secretary SaaS v0.1.0 • Ready for Live Integration</span>
      </div>
    </div>
  )
}
