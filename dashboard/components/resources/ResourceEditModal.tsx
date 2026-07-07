'use client';

import React from 'react';
import { Wrench, Tag, Trash2, CheckCircle2, PlusCircle, Info } from 'lucide-react';
import type { Resource, Service } from '../../lib/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { ToggleSwitch } from '../ui/ToggleSwitch';

export interface ResourceEditForm {
  name: string;
  description: string;
  is_active: boolean;
}

interface ResourceEditModalProps {
  isOpen: boolean;
  resource: Resource | null;
  form: ResourceEditForm;
  onFormChange: (updates: Partial<ResourceEditForm>) => void;
  services: Service[];
  mappings: { service_id: string; resource_id?: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onToggleService: (serviceId: string, resourceId: string) => void;
  resourceLabel: string;
}

export function ResourceEditModal({
  isOpen,
  resource,
  form,
  onFormChange,
  services,
  mappings,
  saving,
  onClose,
  onSave,
  onDelete,
  onToggleService,
  resourceLabel,
}: ResourceEditModalProps) {
  return (
    <Modal
      isOpen={isOpen && !!resource}
      onClose={onClose}
      title={resource?.name ?? resourceLabel}
      disableBackdropClose
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} isLoading={saving}>
            Save Changes
          </Button>
        </div>
      }
    >
      <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2">
        <section className="space-y-4">
          <h4
            className="text-xs font-bold uppercase tracking-widest flex items-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <Wrench className="w-3 h-3 mr-2" /> Basic Info
          </h4>
          <div className="space-y-3">
            <Input
              label={`${resourceLabel} Name`}
              value={form.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
            />
            <Input
              label="Description"
              value={form.description}
              onChange={(e) => onFormChange({ description: e.target.value })}
            />
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Active
              </span>
              <ToggleSwitch
                checked={form.is_active}
                onChange={() => onFormChange({ is_active: !form.is_active })}
                label="Active"
              />
            </div>
          </div>
        </section>

        <section>
          <h4
            className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <Tag className="w-3 h-3 mr-2" /> Supported Services
          </h4>
          <div className="grid grid-cols-1 gap-2">
            {services.map((service) => {
              const isMapped = mappings.some(
                (m) =>
                  m.service_id === service.service_id && m.resource_id === resource?.resource_id
              );
              return (
                <button
                  key={service.service_id}
                  onClick={() =>
                    resource && onToggleService(service.service_id, resource.resource_id)
                  }
                  aria-pressed={isMapped}
                  aria-label={`${isMapped ? 'Remove' : 'Add'} ${service.name}`}
                  className={`flex items-center justify-between p-4 rounded-2xl text-sm font-bold transition-all ${isMapped ? 'text-white shadow-md' : ''}`}
                  style={
                    isMapped
                      ? { backgroundColor: 'var(--accent)' }
                      : { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }
                  }
                >
                  {service.name}
                  {isMapped ? (
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  ) : (
                    <PlusCircle className="w-5 h-5 opacity-30" />
                  )}
                </button>
              );
            })}
            {services.length === 0 && (
              <div
                className="text-center p-8 border-2 border-dashed rounded-3xl"
                style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}
              >
                No services defined in the catalog.
              </div>
            )}
          </div>
        </section>

        <Card variant="info">
          <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
            <Info className="w-4 h-4 mr-2" /> Capacity Alignment
          </h4>
          <p className="text-xs leading-relaxed">
            Toggling services here determines which appointments can be booked for this{' '}
            {resourceLabel.toLowerCase()}. The AI agent will only schedule a service if it&apos;s
            enabled for the specific location or piece of equipment.
          </p>
        </Card>

        <section className="pt-4 border-t" style={{ borderColor: 'var(--border-soft)' }}>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-red-900/10"
            onClick={() => resource && onDelete(resource.resource_id)}
          >
            <Trash2 className="w-4 h-4 mr-2" /> {`Delete ${resourceLabel}`}
          </Button>
        </section>
      </div>
    </Modal>
  );
}
