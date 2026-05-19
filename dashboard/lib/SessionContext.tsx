'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { forceLogout as apiForceLogout } from './api'

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000'

export type UserRole = 'owner' | 'front_desk'

// WHY: tokens minted before the role column landed don't carry the claim.
// Treat absent / unrecognized values as 'owner' so existing sessions don't
// silently downgrade. Mirrors the server-side coercion in routes/auth.ts.
function normalizeRole(raw: string | null | undefined): UserRole {
  return raw === 'front_desk' ? 'front_desk' : 'owner'
}

interface SessionState {
  tenantId: string | null
  userName: string | null
  userEmail: string | null
  role: UserRole
  isAdmin: boolean
  managedTenantId: string | null
  managedTenantName: string | null
  loading: boolean
  tenantsVersion: number
  login: (data: { tenant_id: string; user_name: string; user_email?: string; role?: string }) => void
  logout: () => void
  selectManagedTenant: (id: string, name: string) => void
  notifyTenantsChanged: () => void
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [role, setRole] = useState<UserRole>('owner')
  const [isAdmin, setIsAdmin] = useState(false)
  const [managedTenantId, setManagedTenantId] = useState<string | null>(null)
  const [managedTenantName, setManagedTenantName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tenantsVersion, setTenantsVersion] = useState(0)

  useEffect(() => {
    const storedTenantId = localStorage.getItem('tenantId')
    const storedUserName = localStorage.getItem('userName')
    const storedUserEmail = localStorage.getItem('userEmail')
    const storedRole = localStorage.getItem('userRole')

    if (storedTenantId) {
      setTenantId(storedTenantId)
      setUserName(storedUserName)
      setUserEmail(storedUserEmail)
      setRole(normalizeRole(storedRole))
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

  const login = useCallback((data: { tenant_id: string; user_name: string; user_email?: string; role?: string }) => {
    setTenantId(data.tenant_id)
    setUserName(data.user_name)
    setUserEmail(data.user_email ?? localStorage.getItem('userEmail'))
    const nextRole = normalizeRole(data.role)
    setRole(nextRole)
    localStorage.setItem('userRole', nextRole)
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
    setUserEmail(null)
    setRole('owner')
    setIsAdmin(false)
    localStorage.removeItem('userRole')
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
      userEmail,
      role,
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
