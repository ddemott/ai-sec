'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { forceLogout as apiForceLogout } from './api'

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000'

interface SessionState {
  tenantId: string | null
  userName: string | null
  isAdmin: boolean
  managedTenantId: string | null
  managedTenantName: string | null
  loading: boolean
  tenantsVersion: number
  login: (data: { tenant_id: string; user_name: string }) => void
  logout: () => void
  selectManagedTenant: (id: string, name: string) => void
  notifyTenantsChanged: () => void
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [managedTenantId, setManagedTenantId] = useState<string | null>(null)
  const [managedTenantName, setManagedTenantName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tenantsVersion, setTenantsVersion] = useState(0)

  useEffect(() => {
    const storedTenantId = localStorage.getItem('tenantId')
    const storedUserName = localStorage.getItem('userName')

    if (storedTenantId) {
      setTenantId(storedTenantId)
      setUserName(storedUserName)
      const isSuper = storedTenantId === SUPER_ADMIN_TENANT_ID
      setIsAdmin(isSuper)
      if (isSuper) {
        const savedManagedId = localStorage.getItem('managedTenantId')
        const savedManagedName = localStorage.getItem('managedTenantName')
        if (savedManagedId && savedManagedName) {
          setManagedTenantId(savedManagedId)
          setManagedTenantName(savedManagedName)
        }
      } else {
        setManagedTenantId(storedTenantId)
      }
    }
    setLoading(false)
  }, [])

  const login = useCallback((data: { tenant_id: string; user_name: string }) => {
    setTenantId(data.tenant_id)
    setUserName(data.user_name)
    const isSuper = data.tenant_id === SUPER_ADMIN_TENANT_ID
    setIsAdmin(isSuper)
    if (!isSuper) {
      setManagedTenantId(data.tenant_id)
    }
  }, [])

  const logout = useCallback(() => {
    setTenantId(null)
    setManagedTenantId(null)
    setManagedTenantName(null)
    setUserName(null)
    setIsAdmin(false)
    apiForceLogout()
  }, [])

  const selectManagedTenant = useCallback((id: string, name: string) => {
    setManagedTenantId(id)
    setManagedTenantName(name)
    localStorage.setItem('managedTenantId', id)
    localStorage.setItem('managedTenantName', name)
  }, [])

  const notifyTenantsChanged = useCallback(() => {
    setTenantsVersion(v => v + 1)
  }, [])

  return (
    <SessionContext.Provider value={{
      tenantId,
      userName,
      isAdmin,
      managedTenantId,
      managedTenantName,
      loading,
      tenantsVersion,
      login,
      logout,
      selectManagedTenant,
      notifyTenantsChanged,
    }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSessionContext() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSessionContext must be used within a SessionProvider')
  return ctx
}

/**
 * Returns the effective tenant ID for API calls.
 * For super-admin: returns the managed (selected) tenant ID.
 * For regular users: returns their own tenant ID.
 * Replaces the old useSession(overrideTenantId) pattern — no prop drilling needed.
 */
export function useActiveTenantId(): string | null {
  const { tenantId, managedTenantId } = useSessionContext()
  return managedTenantId || tenantId
}
