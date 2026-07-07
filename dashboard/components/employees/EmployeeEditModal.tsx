'use client';

import React from 'react';
import { Users, Tag, Trash2, CheckCircle2, PlusCircle } from 'lucide-react';
import type { Employee, Service } from '../../lib/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PhoneInput } from '../ui/PhoneInput';
import { ToggleSwitch } from '../ui/ToggleSwitch';

export interface EmployeeEditForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  is_active: boolean;
}

interface EmployeeEditModalProps {
  isOpen: boolean;
  employee: Employee | null;
  form: EmployeeEditForm;
  onFormChange: (updates: Partial<EmployeeEditForm>) => void;
  services: Service[];
  mappings: { service_id: string; employee_id?: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onToggleService: (serviceId: string, employeeId: string) => void;
  employeeLabel: string;
}

export function EmployeeEditModal({
  isOpen,
  employee,
  form,
  onFormChange,
  services,
  mappings,
  saving,
  onClose,
  onSave,
  onDelete,
  onToggleService,
  employeeLabel,
}: EmployeeEditModalProps) {
  return (
    <Modal
      isOpen={isOpen && !!employee}
      onClose={onClose}
      title={employee?.name ?? ''}
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
      {employee && (
        <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2">
          <section className="space-y-4">
            <h4
              className="text-xs font-bold uppercase tracking-widest flex items-center"
              style={{ color: 'var(--text-muted)' }}
            >
              <Users className="w-3 h-3 mr-2" /> Basic Info
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First Name"
                value={form.first_name}
                onChange={(e) => onFormChange({ first_name: e.target.value })}
              />
              <Input
                label="Last Name"
                value={form.last_name}
                onChange={(e) => onFormChange({ last_name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Email"
                type="email"
                placeholder="employee@email.com"
                value={form.email}
                onChange={(e) => onFormChange({ email: e.target.value })}
              />
              <PhoneInput
                label="Phone"
                value={form.phone}
                onChange={(val) => onFormChange({ phone: val })}
              />
            </div>
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
          </section>

          <section>
            <h4
              className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center"
              style={{ color: 'var(--text-muted)' }}
            >
              <Tag className="w-3 h-3 mr-2" /> Authorized Services
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {services.map((service) => {
                const isMapped = mappings.some(
                  (m) =>
                    m.service_id === service.service_id && m.employee_id === employee.employee_id
                );
                return (
                  <button
                    key={service.service_id}
                    onClick={() => onToggleService(service.service_id, employee.employee_id)}
                    aria-pressed={isMapped}
                    aria-label={`${isMapped ? 'Remove' : 'Add'} ${service.name}`}
                    className={`flex items-center justify-between p-4 rounded-2xl text-sm font-bold transition-all ${isMapped ? 'text-white shadow-lg' : ''}`}
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

          <section className="pt-6 border-t" style={{ borderColor: 'var(--border-soft)' }}>
            <Button
              variant="ghost"
              className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 w-full justify-center"
              icon={Trash2}
              onClick={() => onDelete(employee.employee_id)}
            >
              {`Remove ${employeeLabel}`}
            </Button>
          </section>
        </div>
      )}
    </Modal>
  );
}
