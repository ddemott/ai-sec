'use client';

/**
 * Individual service card in the Service Catalog grid.
 * Shows name, description, duration/price badges, the default-service radio
 * selector, and a summary of assigned resources + employees.
 * Extracted from ServiceAssignmentView.tsx (dense-view decomposition).
 */

import React from 'react';
import { Wrench, Users } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

type Service = {
  service_id: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price?: number | null;
};

interface ServiceCardProps {
  service: Service;
  defaultServiceId: string | null;
  settingDefaultId: string | null;
  resMappings: { service_id: string; resource_id?: string }[];
  empMappings: { service_id: string; employee_id?: string }[];
  vocab: { resource_plural: string; employee_plural: string };
  onSelect: (service: Service) => void;
  onSetDefault: (serviceId: string) => void;
}

export function ServiceCard({
  service,
  defaultServiceId,
  settingDefaultId,
  resMappings,
  empMappings,
  vocab,
  onSelect,
  onSetDefault,
}: ServiceCardProps) {
  const isDefault = service.service_id === defaultServiceId;

  return (
    <Card
      className="relative group cursor-pointer transition-all"
      onClick={() => onSelect(service)}
    >
      <h3 className="text-xl font-bold mb-1">{service.name}</h3>
      <p
        className="text-sm mb-4 h-10 overflow-hidden line-clamp-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        {service.description}
      </p>

      <div className="flex items-center gap-2 mb-4">
        <Badge variant="secondary">{service.duration_minutes} MIN</Badge>
        {(service.price ?? 0) > 0 && <Badge variant="primary">${service.price}</Badge>}
      </div>

      {/* Default-when-nothing-matches radio. Clicks stopPropagation so they
          don't also open the edit modal. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!isDefault) onSetDefault(service.service_id);
        }}
        disabled={settingDefaultId === service.service_id}
        aria-pressed={isDefault}
        title="The service a call books when the caller doesn't name a matchable one"
        className="flex items-center gap-2 mb-4 text-left disabled:opacity-60"
      >
        <span
          className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
          style={{ borderColor: isDefault ? 'var(--accent)' : 'var(--border-soft)' }}
        >
          {isDefault && (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
          )}
        </span>
        <span
          className="text-xs"
          style={{ color: isDefault ? 'var(--accent)' : 'var(--text-secondary)' }}
        >
          {isDefault ? 'Default when nothing matches' : 'Set as default'}
        </span>
      </button>

      <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center text-xs font-bold uppercase tracking-tighter">
          <Wrench className="w-3 h-3 mr-2" style={{ color: 'var(--accent-soft)' }} />
          <span style={{ color: 'var(--text-muted)' }}>{vocab.resource_plural}: </span>
          <span className="ml-1" style={{ color: 'var(--text-secondary)' }}>
            {resMappings.filter((m) => m.service_id === service.service_id).length} assigned
          </span>
        </div>
        <div className="flex items-center text-xs font-bold uppercase tracking-tighter">
          <Users className="w-3 h-3 mr-2" style={{ color: 'var(--success)' }} />
          <span style={{ color: 'var(--text-muted)' }}>{vocab.employee_plural}: </span>
          <span className="ml-1" style={{ color: 'var(--text-secondary)' }}>
            {empMappings.filter((m) => m.service_id === service.service_id).length} authorized
          </span>
        </div>
      </div>
    </Card>
  );
}
