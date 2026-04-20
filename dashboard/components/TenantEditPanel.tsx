'use client'

import React, { useRef } from 'react';
import {
  Building2,
  Save,
  X,
  Phone,
  LayoutTemplate,
  Edit,
  Clock,
  ShieldAlert,
  Trash2,
  Mic,
  Globe,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { formatPhone } from '../lib/phone';
import { US_TIMEZONES } from '../lib/constants';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { PhoneInput } from './ui/PhoneInput';
import { Select } from './ui/Select';
import { Card } from './ui/Card';
import { Api } from '../lib/api';
import { ConfirmModal } from './ui/ConfirmModal';
import { useConfirm } from '../lib/useConfirm';
import { showToast } from './ui/Toast';

type Tenant = {
  id: string;
  name: string;
  business_type: string;
  timezone?: string;
  owner_phone?: string | null;
  inbound_phone?: string | null;
  voice_id?: string | null;
  first_message?: string | null;
  system_prompt?: string | null;
  vapi_assistant_id?: string | null;
  vapi_phone_number_id?: string | null;
  phone_status?: string;
};

type Template = {
  business_type: string;
  display_name: string;
};

interface TenantEditPanelProps {
  selectedTenant: Tenant;
  form: Tenant;
  templates: Template[];
  isEditing: boolean;
  saving: boolean;
  success: boolean;
  error: string | null;
  onFormChange: (form: Tenant) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
  onTenantUpdate: (tenant: Tenant) => void;
}

export function TenantEditPanel({
  selectedTenant,
  form,
  templates,
  isEditing,
  saving,
  success,
  error,
  onFormChange,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onTenantUpdate,
}: TenantEditPanelProps) {
  const { state: confirmState, confirm: openConfirm, close: closeConfirm } = useConfirm();
  const areaCodeRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <header className="p-4 md:p-8 border-b flex items-center justify-between sticky top-0 z-10 transition-colors duration-200" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center">
          <div className="p-2 rounded-lg mr-4 shadow-md" style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}>
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-display">{selectedTenant.name}</h1>
            <p className="text-sm font-mono italic" style={{ color: 'var(--text-secondary)' }}>
              {isEditing ? 'Global Attributes Editor' : 'Business Settings Overview'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {success && <span className="text-green-600 dark:text-green-400 text-sm font-bold flex items-center mr-2"><Save className="w-4 h-4 mr-1" /> Updated!</span>}
          {!isEditing ? (
              <>
                  <Button variant="danger" size="sm" onClick={onDelete} title="Delete Business"><Trash2 className="w-5 h-5" /></Button>
                  <Button
                      variant="secondary"
                      onClick={onEdit}
                  >
                      <Edit className="w-4 h-4 mr-2" /> Modify Attributes
                  </Button>
              </>
          ) : (
              <>
                  <Button variant="ghost" onClick={onCancelEdit}>
                      <X className="w-5 h-5" />
                  </Button>
                  <Button
                      onClick={onSave}
                      isLoading={saving}
                  >
                      {!saving && <Save className="w-4 h-4 mr-2" />}
                      Save Changes
                  </Button>
              </>
          )}
        </div>
      </header>

      <div className="p-4 md:p-8 space-y-8 max-w-4xl">

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {/* Core Identity */}
        <Card title="Business Identity & Operations" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                  {isEditing ? (
                      <Input
                          label="Display Name"
                          value={form.name}
                          onChange={e => onFormChange({...form, name: e.target.value})}
                      />
                  ) : (
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase ml-1" style={{ color: 'var(--text-secondary)' }}>Display Name</label>
                          <p className="p-2.5 font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{selectedTenant.name}</p>
                      </div>
                  )}
                  {isEditing ? (
                      <Select
                          label="Template Type"
                          value={form.business_type}
                          onChange={e => onFormChange({...form, business_type: e.target.value})}
                          options={templates.map(t => ({ label: t.display_name, value: t.business_type }))}
                      />
                  ) : (
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase ml-1 flex items-center" style={{ color: 'var(--text-secondary)' }}>
                              <LayoutTemplate className="w-3 h-3 mr-1" /> Template Type
                          </label>
                          <p className="p-2.5 font-bold uppercase tracking-tight text-sm" style={{ color: 'var(--accent-soft)' }}>
                              {templates.find(t => t.business_type === selectedTenant.business_type)?.display_name || selectedTenant.business_type}
                          </p>
                      </div>
                  )}
              </div>
              <div className="space-y-4">
                  {isEditing ? (
                      <Select
                          label="Timezone"
                          value={form.timezone}
                          onChange={e => onFormChange({...form, timezone: e.target.value})}
                          options={US_TIMEZONES}
                      />
                  ) : (
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase ml-1 flex items-center" style={{ color: 'var(--text-secondary)' }}>
                              <Clock className="w-3 h-3 mr-1" /> Timezone
                          </label>
                          <p className="p-2.5 font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                              {US_TIMEZONES.find(tz => tz.value === selectedTenant.timezone)?.label || selectedTenant.timezone}
                          </p>
                      </div>
                  )}
                  {isEditing ? (
                      <PhoneInput
                          label="Owner Notification Phone"
                          value={form.owner_phone || ''}
                          onChange={(val) => onFormChange({...form, owner_phone: val})}
                      />
                  ) : (
                      <div className="space-y-1">
                          <label className="text-xs font-bold uppercase ml-1 flex items-center" style={{ color: 'var(--text-secondary)' }}>
                              <Phone className="w-3 h-3 mr-1" /> Owner Notification Phone
                          </label>
                          <p className="p-2.5 font-medium font-mono" style={{ color: 'var(--text-primary)' }}>{selectedTenant.owner_phone ? formatPhone(selectedTenant.owner_phone) : 'Not set'}</p>
                      </div>
                  )}
                  {/* Phone Provisioning */}
                  <div className="space-y-2" aria-live="polite">
                      <label className="text-xs font-bold uppercase ml-1 flex items-center" style={{ color: 'var(--accent-soft)' }}>
                          <Globe className="w-3 h-3 mr-1" /> AI Phone Line
                      </label>
                      {selectedTenant.phone_status === 'active' && selectedTenant.inbound_phone ? (
                          <div className="flex items-center gap-3">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Active
                              </span>
                              <span className="font-mono font-bold" style={{ color: 'var(--accent-soft)' }}>{formatPhone(selectedTenant.inbound_phone)}</span>
                              <button
                                  onClick={() => {
                                      openConfirm({
                                          title: 'Deactivate Phone Line',
                                          message: 'Deactivate this phone line? The number will be released.',
                                          onConfirm: async () => {
                                              closeConfirm();
                                              try {
                                                  await Api.provisioning.deactivate(selectedTenant.id)
                                                  onTenantUpdate({...selectedTenant, phone_status: 'deprovisioned', inbound_phone: null, vapi_assistant_id: null, vapi_phone_number_id: null})
                                              } catch (err: unknown) {
                                                  const msg = err instanceof Error ? err.message : 'Failed to deactivate phone';
                                                  showToast(msg, 'error')
                                              }
                                          },
                                      });
                                  }}
                                  className="text-xs text-red-500 hover:text-red-700 underline"
                              >Deactivate</button>
                          </div>
                      ) : selectedTenant.phone_status === 'provisioning' ? (
                          <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                  Provisioning...
                              </span>
                          </div>
                      ) : (
                          <div className="flex items-end gap-2">
                              <div>
                                  <label htmlFor="area-code-input" className="block text-xs font-bold uppercase ml-1 mb-1" style={{ color: 'var(--text-secondary)' }}>
                                      Area code <span className="normal-case font-normal" style={{ color: 'var(--text-muted)' }}>(optional)</span>
                                  </label>
                                  <input
                                      type="text"
                                      maxLength={3}
                                      placeholder="e.g. 630"
                                      className="w-24 px-2.5 py-1.5 text-sm border rounded-lg"
                                      style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
                                      id="area-code-input"
                                      ref={areaCodeRef}
                                  />
                              </div>
                              <button
                                  onClick={async () => {
                                      const areaCode = areaCodeRef.current?.value?.trim()
                                      onTenantUpdate({...selectedTenant, phone_status: 'provisioning'})
                                      try {
                                          const result = await Api.provisioning.activate(selectedTenant.id, areaCode || undefined)
                                          onTenantUpdate({
                                              ...selectedTenant,
                                              phone_status: 'active',
                                              inbound_phone: result.phone_number,
                                              vapi_assistant_id: result.assistant_id,
                                              vapi_phone_number_id: result.phone_number_id,
                                          })
                                      } catch (err: unknown) {
                                          onTenantUpdate({...selectedTenant, phone_status: 'failed'})
                                          const msg = err instanceof Error ? err.message : 'Failed to activate phone';
                                          showToast(msg, 'error')
                                      }
                                  }}
                                  className="px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 rounded-lg flex items-center gap-1.5"
                                  style={{ backgroundColor: 'var(--accent)' }}
                              >
                                  <Phone className="w-3.5 h-3.5" /> Activate Phone
                              </button>
                              {selectedTenant.phone_status === 'failed' && (
                                  <span className="text-xs text-red-500">Last attempt failed — try again</span>
                              )}
                          </div>
                      )}
                  </div>
              </div>
          </div>
        </Card>

        {/* AI Config */}
        <section className="space-y-6">
          <div className="flex items-center space-x-2 border-b pb-2" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-soft)' }}>
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold tracking-tight">Secretary HQ Core Attributes</h2>
          </div>

          <div className="space-y-6">
              {isEditing ? (
                  <Input
                      label="Voice ID (Vapi/ElevenLabs)"
                      value={form.voice_id || ''}
                      onChange={e => onFormChange({...form, voice_id: e.target.value})}
                      className="font-mono"
                  />
              ) : (
                  <div className="space-y-1">
                      <label className="text-xs font-bold uppercase ml-1 flex items-center" style={{ color: 'var(--text-secondary)' }}>
                          <Mic className="w-3 h-3 mr-1" /> Voice ID (Vapi/ElevenLabs)
                      </label>
                      <p className="p-3 rounded-xl font-mono text-xs border" style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border-soft)' }}>{selectedTenant.voice_id || 'Not set'}</p>
                  </div>
              )}

              {isEditing ? (
                  <Input
                      label="First Message (Greeting)"
                      value={form.first_message || ''}
                      onChange={e => onFormChange({...form, first_message: e.target.value})}
                  />
              ) : (
                  <div className="space-y-1">
                      <label className="text-xs font-bold uppercase ml-1 flex items-center" style={{ color: 'var(--text-secondary)' }}>
                          <MessageSquare className="w-3 h-3 mr-1" /> First Message (Greeting)
                      </label>
                      <p className="p-3 rounded-xl italic border-l-4 leading-relaxed" style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-primary)', borderLeftColor: 'var(--accent)' }}>&quot;{selectedTenant.first_message || 'No greeting set'}&quot;</p>
                  </div>
              )}

              <div className="space-y-1">
                  <label className="text-xs font-bold uppercase ml-1 flex items-center" style={{ color: 'var(--text-secondary)' }}>
                      <RefreshCw className="w-3 h-3 mr-1" /> System Prompt (Brain)
                  </label>
                  {isEditing ? (
                      <textarea
                          rows={10}
                          value={form.system_prompt || ''}
                          onChange={e => onFormChange({...form, system_prompt: e.target.value})}
                          className="w-full p-4 border rounded-xl outline-none focus:ring-2 text-sm font-mono shadow-inner transition"
                          style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
                      />
                  ) : (
                      <div className="p-4 rounded-xl text-sm leading-relaxed font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border" style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border-soft)' }}>
                          {selectedTenant.system_prompt || 'No prompt configured.'}
                      </div>
                  )}
              </div>
          </div>
        </section>

        {isEditing && (
          <div className="pt-8 border-t flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-4" style={{ borderColor: 'var(--border-soft)' }}>
              <Button
                  onClick={onSave}
                  isLoading={saving}
                  className="flex-1 py-4 text-lg"
              >
                  {!saving && <Save className="w-6 h-6 mr-3" />}
                  Save All Global Attributes
              </Button>
              <Button
                  variant="secondary"
                  onClick={onCancelEdit}
                  className="px-8 py-4"
              >
                  Cancel
              </Button>
          </div>
        )}

      </div>

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        confirmVariant={confirmState.confirmVariant}
        onConfirm={confirmState.onConfirm}
        onClose={closeConfirm}
      />
    </>
  );
}
