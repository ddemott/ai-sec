'use client'

import React, { useState } from 'react'
import { Calendar, Lock, Mail, Loader2, Bot } from 'lucide-react'
import { API_BASE_URL } from '../lib/api'

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
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        localStorage.setItem('tenantId', data.tenant_id)
        localStorage.setItem('userName', data.user_name)
        localStorage.setItem('userEmail', email)
        if (data.token) localStorage.setItem('authToken', data.token)
        onLoginSuccess(data)
      } else {
        setError(data.error || 'Login failed. Please try again.')
      }
    } catch {
      setError('Connection error. Is the backend server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 font-sans transition-colors duration-200" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div className="w-full max-w-md rounded-2xl shadow-xl overflow-hidden border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-soft)' }}>
        
        {/* Header/Logo */}
        <div className="p-8 flex flex-col items-center text-white" style={{ backgroundColor: 'var(--accent)' }}>
          <div className="bg-white/20 p-3 rounded-xl mb-4 backdrop-blur-sm">
            <Bot className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-display tracking-tight">Secretary HQ Portal</h1>
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
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 ml-1" style={{ color: 'var(--text-secondary)' }}>
                Business Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
                  style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
                  placeholder="admin@business.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 ml-1" style={{ color: 'var(--text-secondary)' }}>
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
                  style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 text-white rounded-xl font-bold text-sm shadow-lg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent)' }}
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

          <div className="mt-8 pt-6 border-t text-center" style={{ borderColor: 'var(--border-soft)' }}>
            <p className="text-xs text-gray-400 italic">
              &quot;Providing human-like AI reception for modern businesses.&quot;
            </p>
          </div>
        </div>
      </div>
      
      <div className="mt-8 flex items-center text-gray-400 text-xs">
        <Calendar className="w-4 h-4 mr-2" />
        <span>Secretary HQ v0.1.0 • Ready for Live Integration</span>
      </div>
    </div>
  )
}
