'use client'

import React from 'react';
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
  return (
    <>
      <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] flex items-center justify-between sticky top-0 bg-white dark:bg-[#111] z-10 transition-colors duration-200">
        <div className="flex items-center">
          <div className="bg-blue-600 dark:bg-blue-700 p-2 rounded-lg mr-4 shadow-md text-white">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-bold dark:text-white">{selectedTenant.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono italic">
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
                          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Display Name</label>
                          <p className="p-2.5 font-bold text-lg text-gray-900 dark:text-white">{selectedTenant.name}</p>
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
                          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                              <LayoutTemplate className="w-3 h-3 mr-1" /> Template Type
                          </label>
                          <p className="p-2.5 text-blue-700 dark:text-blue-400 font-bold uppercase tracking-tight text-sm">
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
                          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                              <Clock className="w-3 h-3 mr-1" /> Timezone
                          </label>
                          <p className="p-2.5 text-gray-700 dark:text-gray-300 font-medium text-sm">
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
                          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                              <Phone className="w-3 h-3 mr-1" /> Owner Notification Phone
                          </label>
                          <p className="p-2.5 text-gray-700 dark:text-gray-300 font-medium font-mono">{selectedTenant.owner_phone ? formatPhone(selectedTenant.owner_phone) : 'Not set'}</p>
                      </div>
                  )}
                  {/* Phone Provisioning */}
                  <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center text-blue-600">
                          <Globe className="w-3 h-3 mr-1" /> AI Phone Line
                      </label>
                      {selectedTenant.phone_status === 'active' && selectedTenant.inbound_phone ? (
                          <div className="flex items-center gap-3">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Active
                              </span>
                              <span className="font-mono font-bold text-blue-700 dark:text-blue-400">{formatPhone(selectedTenant.inbound_phone)}</span>
                              <button
                                  onClick={async () => {
                                      if (!confirm('Deactivate this phone line? The number will be released.')) return
                                      try {
                                          await Api.provisioning.deactivate(selectedTenant.id)
                                          onTenantUpdate({...selectedTenant, phone_status: 'deprovisioned', inbound_phone: null, vapi_assistant_id: null, vapi_phone_number_id: null})
                                      } catch (err: any) {
                                          alert(err.message || 'Failed to deactivate phone')
                                      }
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
                          <div className="flex items-center gap-2">
                              <input
                                  type="text"
                                  maxLength={3}
                                  placeholder="Area code (optional)"
                                  className="w-32 px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                  id="area-code-input"
                              />
                              <button
                                  onClick={async () => {
                                      const areaCode = (document.getElementById('area-code-input') as HTMLInputElement)?.value?.trim()
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
                                      } catch (err: any) {
                                          onTenantUpdate({...selectedTenant, phone_status: 'failed'})
                                          alert(err.message || 'Failed to activate phone')
                                      }
                                  }}
                                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5"
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
          <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-800 pb-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold tracking-tight">SecretaryHQ Core Attributes</h2>
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
                      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                          <Mic className="w-3 h-3 mr-1" /> Voice ID (Vapi/ElevenLabs)
                      </label>
                      <p className="p-3 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-600 dark:text-gray-400 font-mono text-xs border dark:border-gray-800">{selectedTenant.voice_id || 'Not set'}</p>
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
                      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                          <MessageSquare className="w-3 h-3 mr-1" /> First Message (Greeting)
                      </label>
                      <p className="p-3 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-700 dark:text-gray-300 italic border-l-4 border-blue-200 dark:border-l-blue-900 leading-relaxed">&quot;{selectedTenant.first_message || 'No greeting set'}&quot;</p>
                  </div>
              )}

              <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                      <RefreshCw className="w-3 h-3 mr-1" /> System Prompt (Brain)
                  </label>
                  {isEditing ? (
                      <textarea
                          rows={10}
                          value={form.system_prompt || ''}
                          onChange={e => onFormChange({...form, system_prompt: e.target.value})}
                          className="w-full p-4 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono shadow-inner dark:text-gray-100 transition"
                      />
                  ) : (
                      <div className="p-4 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-600 dark:text-gray-400 text-sm leading-relaxed font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border border-gray-100 dark:border-gray-800">
                          {selectedTenant.system_prompt || 'No prompt configured.'}
                      </div>
                  )}
              </div>
          </div>
        </section>

        {isEditing && (
          <div className="pt-8 border-t border-gray-200 dark:border-gray-800 flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-4">
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
    </>
  );
}
