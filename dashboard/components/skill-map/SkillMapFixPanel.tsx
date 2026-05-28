'use client';

import React, { useState } from 'react';
import { Api } from '../../lib/api';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';
import type { BrokenChain } from './useSkillMapData';

interface FixPanelEmployee {
  employee_id: string;
  name: string;
  type?: string;
}
interface FixPanelResource {
  resource_id: string;
  name: string;
}
interface ServiceMapping {
  service_id: string;
  employee_id?: string;
  resource_id?: string;
}

interface SkillMapFixPanelProps {
  chain: BrokenChain;
  employees: FixPanelEmployee[];
  resources: FixPanelResource[];
  tenantId: string | null;
  empMappings?: ServiceMapping[];
  resMappings?: ServiceMapping[];
  onFixed: () => void;
  onClose: () => void;
}

export default function SkillMapFixPanel({
  chain,
  employees,
  resources,
  tenantId,
  empMappings = [],
  resMappings = [],
  onFixed,
  onClose,
}: SkillMapFixPanelProps) {
  const [saving, setSaving] = useState(false);

  // Extract the service ID from the skill node ID (format: "skill-{serviceId}")
  const serviceId = chain.skillId.replace('skill-', '');

  // Employees NOT already assigned to this service
  const eligibleEmployees = (employees || [])
    .filter((e) => e.type !== 'user')
    .filter(
      (e) =>
        !empMappings.some(
          (m) =>
            String(m.service_id) === serviceId && String(m.employee_id) === String(e.employee_id)
        )
    );

  // Resources NOT already assigned to this service
  const eligibleResources = (resources || []).filter(
    (r) =>
      !resMappings.some(
        (m) => String(m.service_id) === serviceId && String(m.resource_id) === String(r.resource_id)
      )
  );

  async function assignEmployee(emp: FixPanelEmployee) {
    if (!tenantId) return;
    setSaving(true);
    try {
      await Api.mappings.assignServiceEmployee(serviceId, String(emp.employee_id), tenantId);
      onFixed();
    } catch (err) {
      console.error('Failed to assign employee to service', err);
      showToast('Assignment failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function assignResource(res: FixPanelResource) {
    if (!tenantId) return;
    setSaving(true);
    try {
      await Api.mappings.assignServiceResource(serviceId, String(res.resource_id), tenantId);
      onFixed();
    } catch (err) {
      console.error('Failed to assign resource to service', err);
      showToast('Assignment failed', 'error');
    } finally {
      setSaving(false);
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
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">
          ✕
        </button>
      </div>

      {chain.missingEmployees && eligibleEmployees.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
            Assign staff:
          </p>
          <div className="flex flex-wrap gap-1">
            {eligibleEmployees.map((emp) => (
              <Button
                key={emp.employee_id}
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => assignEmployee(emp)}
                className="text-xs py-0.5 px-2"
              >
                + {emp.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {chain.missingResources && eligibleResources.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
            Assign resource:
          </p>
          <div className="flex flex-wrap gap-1">
            {eligibleResources.map((res) => (
              <Button
                key={res.resource_id}
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => assignResource(res)}
                className="text-xs py-0.5 px-2"
              >
                + {res.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {eligibleEmployees.length === 0 && chain.missingEmployees && (
        <p className="text-xs text-gray-400 italic">No available employees to assign.</p>
      )}
      {eligibleResources.length === 0 && chain.missingResources && (
        <p className="text-xs text-gray-400 italic">No available resources to assign.</p>
      )}
    </div>
  );
}
