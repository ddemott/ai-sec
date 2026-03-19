'use client'

import React, { useState } from 'react'
import { Api } from '../../lib/api'
import { Button } from '../ui/Button'
import type { BrokenChain } from './useSkillMapData'

interface SkillMapFixPanelProps {
  chain: BrokenChain
  employees: any[]
  resources: any[]
  tenantId: string | null
  onFixed: () => void
  onClose: () => void
}

export default function SkillMapFixPanel({ chain, employees, resources, tenantId, onFixed, onClose }: SkillMapFixPanelProps) {
  const [saving, setSaving] = useState(false)

  // Employees who DON'T already have this skill
  const eligibleEmployees = (employees || [])
    .filter(e => e.type !== 'user')
    .filter(e => !(Array.isArray(e.skills) && e.skills.includes(chain.skillName)))

  // Resources who DON'T already have this capability
  const eligibleResources = (resources || [])
    .filter(r => !(Array.isArray(r.capabilities) && r.capabilities.includes(chain.skillName)))

  async function assignToEmployee(emp: any) {
    setSaving(true)
    try {
      const updatedSkills = [...(Array.isArray(emp.skills) ? emp.skills : []), chain.skillName]
      await Api.employees.update(emp.id, { skills: updatedSkills })
      onFixed()
    } catch (err) {
      console.error('Failed to assign skill to employee', err)
    } finally {
      setSaving(false)
    }
  }

  async function assignToResource(res: any) {
    setSaving(true)
    try {
      const updatedCaps = [...(Array.isArray(res.capabilities) ? res.capabilities : []), chain.skillName]
      await Api.resources.update(res.id, { capabilities: updatedCaps }, tenantId)
      onFixed()
    } catch (err) {
      console.error('Failed to assign capability to resource', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid={`fix-panel-${chain.skillId}`}
      className="border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 rounded-lg p-3 mt-2"
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400">
          Fix: {chain.skillName}
        </h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>

      {chain.missingEmployees && eligibleEmployees.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wider">Add staff:</p>
          <div className="flex flex-wrap gap-1">
            {eligibleEmployees.map(emp => (
              <Button
                key={emp.id}
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => assignToEmployee(emp)}
                className="text-[10px] py-0.5 px-2"
              >
                + {emp.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {chain.missingResources && eligibleResources.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wider">Add resource:</p>
          <div className="flex flex-wrap gap-1">
            {eligibleResources.map(res => (
              <Button
                key={res.id}
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => assignToResource(res)}
                className="text-[10px] py-0.5 px-2"
              >
                + {res.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {eligibleEmployees.length === 0 && chain.missingEmployees && (
        <p className="text-[10px] text-gray-400 italic">No available employees to assign.</p>
      )}
      {eligibleResources.length === 0 && chain.missingResources && (
        <p className="text-[10px] text-gray-400 italic">No available resources to assign.</p>
      )}
    </div>
  )
}
