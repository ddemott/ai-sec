'use client';

/**
 * Edit modal for an existing service — updates name/description/duration/price
 * and toggles resource + employee mappings inline.
 * Extracted from ServiceAssignmentView.tsx (dense-view decomposition).
 */

import React from 'react';
import { Wrench, Tag, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

type Service = {
  service_id: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price?: number | null;
};

interface EditForm {
  name?: string;
  description?: string;
  duration_minutes?: number;
  price?: number | null;
}

interface Resource {
  resource_id: string;
  name: string;
}

interface Employee {
  employee_id: string;
  name: string;
  type?: string;
}

interface ServiceEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedService: Service | null;
  editForm: EditForm;
  onEditFormChange: (form: EditForm) => void;
  resources: Resource[];
  employees: Employee[];
  resMappings: { service_id: string; resource_id?: string }[];
  empMappings: { service_id: string; employee_id?: string }[];
  saving: boolean;
  vocab: { resource_plural: string; employee_plural: string };
  onSave: () => void;
  onDelete: (serviceId: string) => void;
  onToggleResource: (serviceId: string, resourceId: string) => void;
  onToggleEmployee: (serviceId: string, employeeId: string) => void;
}

export function ServiceEditModal({
  isOpen,
  onClose,
  selectedService,
  editForm,
  onEditFormChange,
  resources,
  employees,
  resMappings,
  empMappings,
  saving,
  vocab,
  onSave,
  onDelete,
  onToggleResource,
  onToggleEmployee,
}: ServiceEditModalProps) {
  return (
    <Modal
      isOpen={isOpen && !!selectedService}
      onClose={onClose}
      title={selectedService?.name || 'Edit Service'}
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
      <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2">
        {/* Basic info */}
        <section className="space-y-4">
          <h4
            className="text-xs font-bold uppercase tracking-widest flex items-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <Tag className="w-3 h-3 mr-2" /> Service Details
          </h4>
          <div className="grid grid-cols-1 gap-4">
            <Input
              label="Name"
              value={editForm.name}
              onChange={(e) => onEditFormChange({ ...editForm, name: e.target.value })}
            />
            <div>
              <label
                className="block text-xs font-bold uppercase mb-1 ml-1 tracking-widest"
                style={{ color: 'var(--text-muted)' }}
              >
                Description
              </label>
              <textarea
                className="w-full p-3 border rounded-xl text-sm h-20 outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
                value={editForm.description}
                onChange={(e) => onEditFormChange({ ...editForm, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Duration (Min)"
                type="number"
                step={15}
                min={15}
                value={editForm.duration_minutes}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  onEditFormChange({
                    ...editForm,
                    duration_minutes: Number.isFinite(v) ? v : undefined,
                  });
                }}
              />
              <Input
                label="Price ($)"
                type="number"
                value={editForm.price ?? ''}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onEditFormChange({ ...editForm, price: Number.isFinite(v) ? v : undefined });
                }}
              />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Scheduled in 15-minute slots — non-multiples are rounded up on save.
            </p>
          </div>
        </section>

        {/* Resource + employee mapping toggles */}
        <section className="space-y-4">
          <h4
            className="text-xs font-bold uppercase tracking-widest flex items-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <Wrench className="w-3 h-3 mr-2" /> {vocab.resource_plural} & {vocab.employee_plural}
          </h4>
          <div className="space-y-6">
            <div>
              <p
                className="text-xs font-bold uppercase mb-3 ml-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Authorized {vocab.resource_plural}
              </p>
              <div className="flex flex-wrap gap-2">
                {resources.map((res) => {
                  const isMapped = resMappings.some(
                    (m) =>
                      m.service_id === selectedService?.service_id &&
                      m.resource_id === res.resource_id
                  );
                  return (
                    <button
                      key={res.resource_id}
                      onClick={() =>
                        selectedService &&
                        onToggleResource(selectedService.service_id, res.resource_id)
                      }
                      aria-pressed={isMapped}
                      aria-label={`${isMapped ? 'Remove' : 'Add'} ${res.name}`}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold border transition-all"
                      style={
                        isMapped
                          ? {
                              backgroundColor: 'var(--accent)',
                              color: 'var(--primary-text)',
                              borderColor: 'var(--accent)',
                            }
                          : {
                              backgroundColor: 'var(--bg-raised)',
                              borderColor: 'var(--border-soft)',
                              color: 'var(--text-secondary)',
                            }
                      }
                    >
                      {res.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p
                className="text-xs font-bold uppercase mb-3 ml-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Qualified {vocab.employee_plural}
              </p>
              <div className="flex flex-wrap gap-2">
                {employees
                  .filter((e) => e.type !== 'user')
                  .map((emp) => {
                    const isMapped = empMappings.some(
                      (m) =>
                        m.service_id === selectedService?.service_id &&
                        m.employee_id === emp.employee_id
                    );
                    return (
                      <button
                        key={emp.employee_id}
                        onClick={() =>
                          selectedService &&
                          onToggleEmployee(selectedService.service_id, emp.employee_id)
                        }
                        aria-pressed={isMapped}
                        aria-label={`${isMapped ? 'Remove' : 'Add'} ${emp.name}`}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold border transition-all"
                        style={
                          isMapped
                            ? {
                                backgroundColor: 'var(--success)',
                                borderColor: 'var(--success)',
                                color: '#ffffff',
                              }
                            : {
                                backgroundColor: 'var(--bg-raised)',
                                borderColor: 'var(--border-soft)',
                                color: 'var(--text-secondary)',
                              }
                        }
                      >
                        {emp.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </section>

        <section className="pt-6 border-t" style={{ borderColor: 'var(--border-soft)' }}>
          <Button
            variant="ghost"
            className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 w-full justify-center"
            icon={Trash2}
            onClick={() => selectedService && onDelete(selectedService.service_id)}
          >
            Delete Service Permanently
          </Button>
        </section>
      </div>
    </Modal>
  );
}
