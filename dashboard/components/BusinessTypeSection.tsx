'use client'

// Business type lives here (Business Settings), not on the Phone Assistant
// → AI Persona screen. Rationale: business_type is a set-once value — owners
// pick it during the wizard and rarely return to it. Putting the full
// template grid on AI Persona forced every prompt-tuning visit to scroll
// past 24 industry cards and exposed an unguarded one-click that overwrote
// the system prompt, voice, and first message.
//
// This component:
//   1. Shows the current template's display name (recognition, not recall).
//   2. Opens the template grid in a modal on demand.
//   3. Routes preview → confirmation guard → apply, so an accidental
//      template change can't nuke a tuned persona.

import React, { useEffect, useState } from 'react'
import { Check, Eye, LayoutTemplate, X } from 'lucide-react'
import { Api } from '../lib/api'
import type { BusinessTemplate, Tenant } from '@/lib/types'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { ConfirmModal } from './ui/ConfirmModal'
import { useConfirm } from '../lib/useConfirm'
import { showToast } from './ui/Toast'

interface BusinessTypeSectionProps {
  tenantId: string | null
  onChanged?: () => void
}

export default function BusinessTypeSection({ tenantId, onChanged }: BusinessTypeSectionProps) {
  const [config, setConfig] = useState<Tenant | null>(null)
  const [templates, setTemplates] = useState<BusinessTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<BusinessTemplate | null>(null)
  const [applying, setApplying] = useState(false)
  const { state: confirmState, confirm, close: closeConfirm } = useConfirm()

  useEffect(() => {
    if (!tenantId) return
    let active = true
    setLoading(true)
    Promise.all([Api.tenants.getConfig(tenantId), Api.templates.listFull()])
      .then(([cfg, tpls]) => {
        if (!active) return
        setConfig(cfg as Tenant | null)
        setTemplates(Array.isArray(tpls) ? tpls : [])
      })
      .catch(() => { /* surfaced via empty render below */ })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [tenantId])

  const currentTemplate = templates.find(t => t.business_type === config?.business_type)
  const currentLabel = currentTemplate?.display_name || config?.business_type || 'Not set'
  const currentCategory = currentTemplate?.category || null

  const templatesByCategory = templates.reduce((acc, t) => {
    const cat = t.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(t)
    return acc
  }, {} as Record<string, BusinessTemplate[]>)
  const sortedCategories = Object.entries(templatesByCategory).sort(
    (a, b) =>
      (templates.find(t => t.category === a[0])?.sort_order ?? 99) -
      (templates.find(t => t.category === b[0])?.sort_order ?? 99)
  )

  async function applyTemplate(template: BusinessTemplate) {
    if (!tenantId || !config) return
    setApplying(true)
    try {
      const res = await Api.tenants.updateConfig(tenantId, {
        business_type: template.business_type,
        system_prompt: template.system_prompt_template,
        voice_id: template.voice_id,
        first_message: template.first_message,
      })
      if (res.success) {
        setConfig({
          ...config,
          business_type: template.business_type,
          system_prompt: template.system_prompt_template,
          voice_id: template.voice_id,
          first_message: template.first_message,
        })
        showToast(`Business type changed to "${template.display_name}"`, 'success')
        setPreviewTemplate(null)
        setPickerOpen(false)
        onChanged?.()
      } else {
        showToast('Failed to change business type', 'error')
      }
    } catch {
      showToast('Connection error — change not saved', 'error')
    } finally {
      setApplying(false)
    }
  }

  // Guard: applying a template overwrites the system prompt, voice, and
  // first message — destructive, and irreversible by undo. Same template
  // re-applied is a no-op (button disabled below), so we only guard when
  // the user is actually switching.
  function handleApplyClick(template: BusinessTemplate) {
    confirm({
      title: 'Change business type?',
      message:
        `This replaces your AI persona, voice, and first message with the ` +
        `"${template.display_name}" template. Any custom tuning you've done ` +
        `to those fields will be lost.`,
      confirmLabel: 'Change business type',
      confirmVariant: 'warning',
      onConfirm: () => {
        closeConfirm()
        void applyTemplate(template)
      },
    })
  }

  return (
    <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <div className="p-2 rounded-lg mr-4" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
            <LayoutTemplate className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Business type</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              The industry template that seeded your AI persona, vocabulary, and example services.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl p-4" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-soft)' }}>
        <div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {loading ? 'Loading…' : currentLabel}
          </div>
          {currentCategory && (
            <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {currentCategory}
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)} disabled={loading || templates.length === 0}>
          Change business type…
        </Button>
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
        Changing this will overwrite your custom AI persona, voice, and first message — use only if you started with the wrong industry.
      </p>

      {/* Picker modal: industry grid */}
      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="Choose a business type">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Click any template to preview it. Nothing changes until you confirm on the preview screen.
          </p>
          {sortedCategories.map(([category, categoryTemplates]) => (
            <div key={category} className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{category}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {categoryTemplates.map(t => {
                  const isActive = config?.business_type === t.business_type
                  return (
                    <button
                      key={t.business_type}
                      onClick={() => setPreviewTemplate(t)}
                      className="p-3 border rounded-xl text-sm font-medium transition text-left group"
                      style={isActive
                        ? { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent-soft)', borderColor: 'var(--accent)' }
                        : { backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }
                      }
                    >
                      <div className="flex items-center justify-between">
                        <span>{t.display_name}</span>
                        <Eye className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />
                      </div>
                      {isActive && (
                        <span className="text-[10px] flex items-center gap-1 mt-1" style={{ color: 'var(--accent-soft)' }}>
                          <Check className="w-3 h-3" /> Current
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Preview modal: details + Apply (gated by confirmation) */}
      {previewTemplate && (
        <Modal isOpen={true} onClose={() => setPreviewTemplate(null)} title="">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{previewTemplate.display_name}</h2>
                <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wider">
                  {previewTemplate.category || 'Business Template'}
                </p>
              </div>
              <button onClick={() => setPreviewTemplate(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 space-y-1">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Dashboard Labels</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div><span className="text-gray-400">Resources called:</span> <span className="font-medium">{previewTemplate.resource_plural || 'Resources'}</span></div>
                <div><span className="text-gray-400">Staff called:</span> <span className="font-medium">{previewTemplate.employee_plural || 'Employees'}</span></div>
                <div><span className="text-gray-400">Bookings called:</span> <span className="font-medium">{previewTemplate.booking_label || 'Appointments'}</span></div>
                <div><span className="text-gray-400">Default resource:</span> <span className="font-medium">{previewTemplate.default_resource_name || 'Station 1'}</span></div>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">AI System Prompt</p>
              <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 text-sm font-mono leading-relaxed max-h-40 overflow-y-auto">
                {previewTemplate.system_prompt_template}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Greeting Message</p>
              <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 text-sm italic">
                &quot;{previewTemplate.first_message}&quot;
              </div>
            </div>

            {previewTemplate.example_services && previewTemplate.example_services.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Suggested Services</p>
                <div className="flex flex-wrap gap-1.5">
                  {previewTemplate.example_services.map((svc, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>{svc}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
              <p className="text-xs text-gray-400">
                {config?.business_type === previewTemplate.business_type
                  ? 'This is your current template.'
                  : 'Applying will overwrite your AI persona, voice, and first message.'}
              </p>
              <Button
                onClick={() => handleApplyClick(previewTemplate)}
                disabled={config?.business_type === previewTemplate.business_type || applying}
                isLoading={applying}
              >
                {config?.business_type === previewTemplate.business_type ? 'Already applied' : 'Apply to my business'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        confirmVariant={confirmState.confirmVariant}
        onConfirm={confirmState.onConfirm}
        onClose={closeConfirm}
      />
    </Card>
  )
}
