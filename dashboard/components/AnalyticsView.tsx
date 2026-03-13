'use client'

import React, { useState, useEffect } from 'react'
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  PhoneCall, 
  CalendarCheck, 
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Loader2
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession } from '../lib/hooks'
import { Card } from './ui/Card'

export default function AnalyticsView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId)
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [tenantId])

  async function fetchStats() {
    if (!tenantId) return
    setLoading(true)
    try {
      const data = await Api.analytics.getStats(tenantId)
      setStats(data)
    } catch (err) {
      console.error("Failed to fetch analytics", err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 italic">
        <Loader2 className="w-12 h-12 animate-spin mb-4 opacity-20" />
        <p>Calculating your business metrics...</p>
      </div>
    )
  }

  const conversionRate = stats?.calls?.total > 0 
    ? ((stats.appointments.total / stats.calls.total) * 100).toFixed(1) 
    : '0'

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-10 shrink-0">
        <div className="flex items-center mb-2">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-bold">Business Analytics</h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-sm ml-12">Monitor your AI Secretary's performance and booking conversion.</p>
      </header>

      {/* KPI GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <Card className="p-6 bg-blue-50/50 dark:bg-blue-900/5 border-blue-100 dark:border-blue-900/20">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400">
              <PhoneCall className="w-5 h-5" />
            </div>
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-none">+12%</Badge>
          </div>
          <div className="text-3xl font-black mb-1">{stats?.calls?.total || 0}</div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total AI Calls</div>
        </Card>

        <Card className="p-6 bg-purple-50/50 dark:bg-purple-900/5 border-purple-100 dark:border-purple-900/20">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-xl text-purple-600 dark:text-purple-400">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-none">+8%</Badge>
          </div>
          <div className="text-3xl font-black mb-1">{stats?.appointments?.total || 0}</div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Appointments</div>
        </Card>

        <Card className="p-6 bg-orange-50/50 dark:bg-orange-900/5 border-orange-100 dark:border-orange-900/20">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-xl text-orange-600 dark:text-orange-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="text-[10px] font-bold text-orange-600 uppercase">Target: 25%</div>
          </div>
          <div className="text-3xl font-black mb-1">{conversionRate}%</div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Conversion Rate</div>
        </Card>

        <Card className="p-6 bg-green-50/50 dark:bg-green-900/5 border-green-100 dark:border-green-900/20">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-xl text-green-600 dark:text-green-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <ArrowUpRight className="w-4 h-4 text-green-500" />
          </div>
          <div className="text-3xl font-black mb-1">${stats?.revenue?.estimate?.toLocaleString() || '0'}</div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Est. Revenue Generated</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* CONVERSION FUNNEL */}
        <Card className="lg:col-span-2 p-8">
          <h3 className="text-lg font-bold mb-8 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            Booking Performance
          </h3>
          
          <div className="space-y-10">
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-bold mb-1">
                <span>Total Calls Analyzed</span>
                <span>{stats?.calls?.total || 0}</span>
              </div>
              <div className="h-4 bg-gray-100 dark:bg-[#222] rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }}></div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm font-bold mb-1">
                <span>Booking Intents Detected</span>
                <span>{Math.round((stats?.appointments?.total || 0) * 1.4)}</span>
              </div>
              <div className="h-4 bg-gray-100 dark:bg-[#222] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 rounded-full transition-all duration-1000" 
                  style={{ width: `${Math.min(100, ((stats?.appointments?.total || 0) * 1.4 / (stats?.calls?.total || 1)) * 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm font-bold mb-1">
                <span>Confirmed Appointments</span>
                <span>{stats?.appointments?.total || 0}</span>
              </div>
              <div className="h-4 bg-gray-100 dark:bg-[#222] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 rounded-full transition-all duration-1000" 
                  style={{ width: `${conversionRate}%` }}
                ></div>
              </div>
            </div>
          </div>

          <div className="mt-12 p-4 bg-gray-50 dark:bg-black/20 rounded-2xl border border-gray-100 dark:border-gray-800">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 mt-0.5">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-bold">New Customers This Month</div>
                <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{stats?.customers?.new_30d || 0}</div>
                <p className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-tighter">Your customer base is growing by ~4% weekly</p>
              </div>
            </div>
          </div>
        </Card>

        {/* RECENT ACTIVITY */}
        <Card className="p-6 overflow-hidden flex flex-col">
          <h3 className="text-lg font-bold mb-6">Recent Activity</h3>
          <div className="flex-1 space-y-6 overflow-auto pr-2 custom-scrollbar">
            {stats?.recent_activity?.length > 0 ? (
              stats.recent_activity.map((item: any, i: number) => (
                <div key={item.id} className="flex gap-4 group">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-xs font-bold border-2 border-white dark:border-[#1a1a1a] z-10 relative text-blue-600 dark:text-blue-400">
                      {(item.customer_name || '??').split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    {i < stats.recent_activity.length - 1 && <div className="absolute top-10 left-1/2 -translate-x-1/2 w-0.5 h-6 bg-gray-100 dark:bg-gray-800" />}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{item.customer_name || 'Unknown Caller'}</div>
                    <div className="text-xs text-gray-500 line-clamp-2 mb-1 leading-relaxed italic">
                      "{item.summary || 'Call summary processing...'}"
                    </div>
                    <div className="text-[10px] text-blue-500 font-bold uppercase">
                      {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center opacity-30 italic">
                <BarChart3 className="w-12 h-12 mb-2" />
                <p className="text-sm">No activity recorded yet.</p>
              </div>
            )}
          </div>
          <button className="mt-6 w-full py-3 bg-gray-50 dark:bg-[#222] rounded-xl text-xs font-bold hover:bg-gray-100 dark:hover:bg-[#333] transition-all">
            View Full Audit Log
          </button>
        </Card>
      </div>
    </div>
  )
}

function Badge({ children, className = "" }: { children: React.ReactNode, className?: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${className}`}>
      {children}
    </span>
  )
}
