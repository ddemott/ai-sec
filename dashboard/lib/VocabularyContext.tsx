'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Api } from './api'
import { useSessionContext } from './SessionContext'

export interface Vocabulary {
  resource_label: string
  resource_plural: string
  employee_label: string
  employee_plural: string
  booking_label: string
}

const DEFAULTS: Vocabulary = {
  resource_label: 'Resource',
  resource_plural: 'Resources',
  employee_label: 'Employee',
  employee_plural: 'Employees',
  booking_label: 'Appointment',
}

interface VocabularyContextValue {
  vocab: Vocabulary
  refreshVocabulary: () => void
}

const VocabularyContext = createContext<VocabularyContextValue>({ vocab: DEFAULTS, refreshVocabulary: () => {} })

export function VocabularyProvider({ children }: { children: ReactNode }) {
  const { tenantId, managedTenantId } = useSessionContext()
  const [vocab, setVocab] = useState<Vocabulary>(DEFAULTS)
  const [version, setVersion] = useState(0)

  // Use managedTenantId for super-admin, tenantId for regular users
  const effectiveTenantId = managedTenantId || tenantId

  useEffect(() => {
    if (!effectiveTenantId) {
      setVocab(DEFAULTS)
      return
    }

    let cancelled = false
    Api.vocabulary.get(effectiveTenantId).then((data) => {
      if (!cancelled && data) {
        setVocab({
          resource_label: data.resource_label || DEFAULTS.resource_label,
          resource_plural: data.resource_plural || DEFAULTS.resource_plural,
          employee_label: data.employee_label || DEFAULTS.employee_label,
          employee_plural: data.employee_plural || DEFAULTS.employee_plural,
          booking_label: data.booking_label || DEFAULTS.booking_label,
        })
      }
    }).catch(() => {
      // Fall back to defaults on error
      if (!cancelled) setVocab(DEFAULTS)
    })

    return () => { cancelled = true }
  }, [effectiveTenantId, version])

  function refreshVocabulary() {
    setVersion(v => v + 1)
  }

  return (
    <VocabularyContext.Provider value={{ vocab, refreshVocabulary }}>
      {children}
    </VocabularyContext.Provider>
  )
}

export function useVocabulary(): Vocabulary {
  return useContext(VocabularyContext).vocab
}

export function useVocabularyRefresh(): () => void {
  return useContext(VocabularyContext).refreshVocabulary
}
