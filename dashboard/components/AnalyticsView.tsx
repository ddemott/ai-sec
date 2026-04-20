'use client'

import React, { useState, useEffect } from 'react'
import {
  PhoneIncoming,
  CalendarCheck,
  Clock,
  PhoneOff,
  Repeat,
  UserX,
  Loader2,
  TrendingUp,
} from 'lucide-react'
import { Api } from '../lib/api'
import { useActiveTenantId } from '../lib/SessionContext'
import { formatHour } from '../lib/utils'

/**
 * Analytics — Rebuilt March 2026
 *
 * Six metrics that answer real business questions:
 * 1. Call Volume Over Time — marketing effectiveness signal
 * 2. Call to Booking Conversion — by day and hour
 * 3. Busiest Hours — when is the phone ringing vs bookings made
 * 4. Caller Abandonment Point — where do people hang up
 * 5. Return Rate by First Service — which services drive loyalty
 * 6. No-Show Pattern — which days have the most no-shows
 *
 * Phase 1: Structure + what we can measure from existing data.
 * Phase 2: Vapi call log integration for call-specific metrics.
 */

interface AppointmentSummary {
  total: number
  byDay: Record<string, number>
  byHour: Record<number, number>
  noShowsByDay: Record<string, number>
  returnRate: Record<string, { first: number; returned: number }>
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function AnalyticsView() {
  const tenantId = useActiveTenantId()
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<AppointmentSummary | null>(null)

  useEffect(() => {
    if (!tenantId) return
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function loadData() {
    setLoading(true)
    try {
      // Load appointments — the data we actually have
      const appointments = await Api.appointments.list(tenantId)
      if (Array.isArray(appointments)) {
        const byDay: Record<string, number> = {}
        const byHour: Record<number, number> = {}
        const noShowsByDay: Record<string, number> = {}
        const allCustomerServices: Record<string, string[]> = {}

        for (const apt of appointments) {
          // By day of week
          const d = new Date(apt.start_time)
          const dayName = DAY_NAMES[d.getDay()]
          byDay[dayName] = (byDay[dayName] || 0) + 1

          // By hour
          const hour = d.getHours()
          byHour[hour] = (byHour[hour] || 0) + 1

          // No-shows by day
          if (apt.status === 'canceled') {
            noShowsByDay[dayName] = (noShowsByDay[dayName] || 0) + 1
          }

          // Track services per customer for return rate
          const custId = apt.customer_id
          if (custId) {
            if (!allCustomerServices[custId]) allCustomerServices[custId] = []
            allCustomerServices[custId].push(apt.description || 'Unknown')
          }
        }

        // Return rate by first service
        const returnRate: Record<string, { first: number; returned: number }> = {}
        for (const services of Object.values(allCustomerServices)) {
          const firstSvc = services[0]
          if (!returnRate[firstSvc]) returnRate[firstSvc] = { first: 0, returned: 0 }
          returnRate[firstSvc].first++
          if (services.length > 1) returnRate[firstSvc].returned++
        }

        setSummary({
          total: appointments.length,
          byDay,
          byHour,
          noShowsByDay,
          returnRate,
        })
      }
    } catch (err) {
      console.error('Failed to load analytics', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg-base)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="h-8 w-32 rounded-lg mb-1 animate-pulse" style={{ backgroundColor: 'var(--bg-raised)' }} />
          <div className="h-4 w-64 rounded mb-6 animate-pulse" style={{ backgroundColor: 'var(--bg-raised)' }} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)' }}>
                <div className="h-4 w-24 rounded mb-2 animate-pulse" style={{ backgroundColor: 'var(--bg-raised)' }} />
                <div className="h-3 w-40 rounded mb-3 animate-pulse" style={{ backgroundColor: 'var(--bg-raised)' }} />
                <div className="h-16 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--bg-raised)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!summary || summary.total === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-base)' }}>
        <div className="text-center">
          <CalendarCheck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No booking data yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Analytics will appear once appointments are booked.</p>
        </div>
      </div>
    )
  }

  // Find busiest hour
  const busiestHour = summary ? Object.entries(summary.byHour).sort(([, a], [, b]) => b - a)[0] : null
  const busiestDay = summary ? Object.entries(summary.byDay).sort(([, a], [, b]) => b - a)[0] : null

  return (
    <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="max-w-5xl mx-auto">
        <h1 className="font-display text-2xl tracking-wide mb-1" style={{ color: 'var(--text-primary)' }}>
          Analytics
        </h1>
        <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>
          Patterns from your booking data. You know your business — these numbers help you see it.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* 1. Call Volume Over Time */}
          <MetricCard
            icon={PhoneIncoming}
            title="Call Volume"
            subtitle="Requires Vapi call log integration (Phase 2)"
            placeholder
          />

          {/* 2. Call to Booking Conversion */}
          <MetricCard
            icon={CalendarCheck}
            title="Booking Conversion"
            subtitle="Requires Vapi call log integration (Phase 2)"
            placeholder
          />

          {/* 3. Busiest Hours */}
          <MetricCard
            icon={Clock}
            title="Busiest Hours"
            subtitle="When bookings happen"
          >
            {summary && busiestHour ? (
              <div>
                <div className="font-display text-3xl" style={{ color: 'var(--text-primary)' }}>
                  {formatHour(Number(busiestHour[0]))}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Peak hour ({busiestHour[1]} bookings)
                  {busiestDay && ` · ${busiestDay[0]}s busiest (${busiestDay[1]})`}
                </p>
                <div className="flex gap-1 mt-3">
                  {Array.from({ length: 12 }, (_, i) => i + 6).map(h => {
                    const count = summary.byHour[h] || 0
                    const max = Math.max(...Object.values(summary.byHour), 1)
                    return (
                      <div key={h} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-sm"
                          style={{
                            height: `${Math.max(4, (count / max) * 40)}px`,
                            backgroundColor: count > 0 ? 'var(--accent)' : 'var(--border-soft)',
                            opacity: count > 0 ? 0.7 : 0.3,
                          }}
                        />
                        <span className="text-[8px]" style={{ color: 'var(--text-muted)' }}>
                          {h > 12 ? h - 12 : h}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data yet</p>
            )}
          </MetricCard>

          {/* 4. Caller Abandonment Point */}
          <MetricCard
            icon={PhoneOff}
            title="Caller Abandonment"
            subtitle="Requires Vapi call log integration (Phase 2)"
            placeholder
          />

          {/* 5. Return Rate by First Service */}
          <MetricCard
            icon={Repeat}
            title="Return Rate by First Service"
            subtitle="Of first-time customers, how many came back?"
          >
            {summary && Object.keys(summary.returnRate).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(summary.returnRate)
                  .sort(([, a], [, b]) => b.first - a.first)
                  .slice(0, 5)
                  .map(([svc, data]) => {
                    const rate = data.first > 0 ? Math.round((data.returned / data.first) * 100) : 0
                    return (
                      <div key={svc}>
                        <div className="flex justify-between text-xs mb-1">
                          <span style={{ color: 'var(--text-secondary)' }} className="truncate mr-2">{svc}</span>
                          <span style={{ color: rate > 50 ? 'var(--green)' : rate > 25 ? 'var(--yellow)' : 'var(--red)' }} className="font-medium shrink-0">
                            {rate}% ({data.returned}/{data.first})
                          </span>
                        </div>
                        <div className="h-1 rounded-full" style={{ backgroundColor: 'var(--border-soft)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${rate}%`,
                              backgroundColor: rate > 50 ? 'var(--green)' : rate > 25 ? 'var(--yellow)' : 'var(--red)',
                              opacity: 0.7,
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No repeat customer data yet</p>
            )}
          </MetricCard>

          {/* 6. No-Show Pattern */}
          <MetricCard
            icon={UserX}
            title="No-Show Pattern"
            subtitle="Canceled appointments by day of week"
          >
            {summary ? (
              <div>
                <div className="flex gap-2 mt-1">
                  {DAY_NAMES.map(day => {
                    const count = summary.noShowsByDay[day] || 0
                    const total = summary.byDay[day] || 0
                    const rate = total > 0 ? Math.round((count / total) * 100) : 0
                    return (
                      <div key={day} className="flex-1 text-center">
                        <div
                          className="text-xs font-bold rounded-md py-1 mb-1"
                          style={{
                            backgroundColor: rate > 20 ? 'rgba(248,113,113,0.15)' : rate > 10 ? 'rgba(252,211,77,0.15)' : 'rgba(52,211,153,0.1)',
                            color: rate > 20 ? 'var(--red)' : rate > 10 ? 'var(--yellow)' : 'var(--green)',
                          }}
                        >
                          {count}
                        </div>
                        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{day}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data yet</p>
            )}
          </MetricCard>

        </div>

        {/* Phase 2 notice */}
        <div className="mt-6 p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)' }}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Coming in Phase 2</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Call volume trends, booking conversion rates, and caller abandonment analysis require Vapi call log integration.
            Staff request tracking requires structured data capture during calls.
          </p>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ icon: Icon, title, subtitle, placeholder, children }: {
  icon: React.ElementType
  title: string
  subtitle: string
  placeholder?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-soft)',
        opacity: placeholder ? 0.5 : 1,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
      </div>
      <p className="text-[10px] mb-3" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
      {placeholder ? (
        <div className="h-16 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-raised)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Coming in Phase 2 — available after Vapi integration</span>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

