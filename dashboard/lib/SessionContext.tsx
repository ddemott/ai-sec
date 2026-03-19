'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000'

interface SessionState {
  tenantId: string | null
  userName: string | null
  isAdmin: boolean
  managedTenantId: string | null
  managedTenantName: string | null
  loading: boolean
  login: (data: { tenant_id: string; user_name: string }) => void
  logout: () => void
  selectManagedTenant: (id: string, name: string) => void
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [managedTenantId, setManagedTenantId] = useState<string | null>(null)
  const [managedTenantName, setManagedTenantName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
    localStorage.removeItem('tenantId')
    localStorage.removeItem('userName')
    localStorage.removeItem('authToken')
    localStorage.removeItem('managedTenantId')
    localStorage.removeItem('managedTenantName')
    setTenantId(null)
    setManagedTenantId(null)
    setManagedTenantName(null)
    setUserName(null)
    setIsAdmin(false)
  }, [])

  const selectManagedTenant = useCallback((id: string, name: string) => {
    setManagedTenantId(id)
    setManagedTenantName(name)
    localStorage.setItem('managedTenantId', id)
    localStorage.setItem('managedTenantName', name)
  }, [])

  return (
    <SessionContext.Provider value={{
      tenantId,
      userName,
      isAdmin,
      managedTenantId,
      managedTenantName,
      loading,
      login,
      logout,
      selectManagedTenant,
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
