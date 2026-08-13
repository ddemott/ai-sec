'use client';

import React, { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Api } from '../lib/api';
import type { Tenant } from '@/lib/types';
import { deriveChecklistRuntimeConfig } from '../../shared/checklistPresetDerivation';
import {
  CHECKLIST_PRESET_IDS,
  CHECKLIST_PRESET_LABELS,
  OPTIONAL_NODE_IDS,
  OPTIONAL_NODE_LABELS,
  checklistPresetLabel,
  conversationBlockLabel,
  runtimeForTenant,
} from '../lib/checklistPresets';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { showToast } from './ui/Toast';

interface ChecklistPresetSectionProps {
  tenantId: string | null;
  refreshToken?: number;
}

export default function ChecklistPresetSection({
  tenantId,
  refreshToken = 0,
}: ChecklistPresetSectionProps) {
  const [config, setConfig] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<string>('derived');
  const [disabledBlocks, setDisabledBlocks] = useState<string[]>([]);
  const [bookingMode, setBookingMode] = useState<string>('offer_once');
  const [messageMode, setMessageMode] = useState<string>('always');
  const [optionalNodes, setOptionalNodes] = useState<string[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    setLoading(true);
    Api.tenants
      .getConfig(tenantId)
      .then((cfg) => {
        if (!active) return;
        setConfig(cfg);
        setDraft(cfg.checklist_preset_id ?? 'derived');
        setDisabledBlocks(cfg.checklist_overrides?.disabled_conversation_blocks ?? []);
        setBookingMode(cfg.checklist_overrides?.booking_mode ?? 'offer_once');
        setMessageMode(cfg.checklist_overrides?.message_mode ?? 'always');
        setOptionalNodes(cfg.checklist_overrides?.optional_node_ids ?? []);
      })
      .catch(() => {
        if (active) setConfig(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, refreshToken]);

  const runtime = runtimeForTenant({
    business_type: config?.business_type,
    checklist_preset_id: draft === 'derived' ? null : draft,
    checklist_runtime_config:
      draft === (config?.checklist_preset_id ?? 'derived')
        ? config?.checklist_runtime_config
        : undefined,
  });
  const baseBlocks = deriveChecklistRuntimeConfig(
    config?.business_type,
    draft === 'derived' ? null : draft
  ).enabled_conversation_blocks;
  const savedDisabled = config?.checklist_overrides?.disabled_conversation_blocks ?? [];
  const savedOptional = config?.checklist_overrides?.optional_node_ids ?? [];
  const dirty =
    draft !== (config?.checklist_preset_id ?? 'derived') ||
    bookingMode !== (config?.checklist_overrides?.booking_mode ?? 'offer_once') ||
    messageMode !== (config?.checklist_overrides?.message_mode ?? 'always') ||
    [...disabledBlocks].sort().join(',') !== [...savedDisabled].sort().join(',') ||
    [...optionalNodes].sort().join(',') !== [...savedOptional].sort().join(',');

  async function save() {
    if (!tenantId) return;
    setSaving(true);
    try {
      const res = await Api.tenants.updateConfig(tenantId, {
        checklist_preset_id: draft === 'derived' ? null : (draft as Tenant['checklist_preset_id']),
        checklist_overrides: {
          disabled_conversation_blocks: disabledBlocks,
          booking_mode: bookingMode as 'offer_once' | 'prefer' | 'never',
          message_mode: messageMode as 'always' | 'fallback_only',
          optional_node_ids: optionalNodes,
        },
      });
      if (!res.success) {
        showToast(res.error || 'Could not save the call checklist.', 'error');
        return;
      }
      const next = await Api.tenants.getConfig(tenantId);
      setConfig(next);
      setDraft(next.checklist_preset_id ?? 'derived');
      setDisabledBlocks(next.checklist_overrides?.disabled_conversation_blocks ?? []);
      setBookingMode(next.checklist_overrides?.booking_mode ?? 'offer_once');
      setMessageMode(next.checklist_overrides?.message_mode ?? 'always');
      setOptionalNodes(next.checklist_overrides?.optional_node_ids ?? []);
      showToast(
        draft === 'derived'
          ? 'Call checklist follows business type again.'
          : `Call checklist set to ${checklistPresetLabel(draft)}.`,
        'success'
      );
    } catch {
      showToast('Connection error — checklist not saved', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
      <div className="flex items-center mb-4">
        <div
          className="p-2 rounded-lg mr-4"
          style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
        >
          <ListChecks className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Call checklist</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Which conversation blocks the receptionist can open on a live call.
          </p>
        </div>
      </div>

      <Select
        label="Preset"
        value={draft}
        disabled={loading || !config}
        onChange={(e) => setDraft(e.target.value)}
        options={[
          { value: 'derived', label: 'Match business type (recommended)' },
          ...CHECKLIST_PRESET_IDS.map((id) => ({
            value: id,
            label: CHECKLIST_PRESET_LABELS[id],
          })),
        ]}
      />

      <div
        className="mt-4 rounded-xl p-4"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-soft)' }}
      >
        <div
          className="text-sm font-bold"
          data-testid="checklist-preset-name"
          style={{ color: 'var(--text-primary)' }}
        >
          {loading ? 'Loading…' : checklistPresetLabel(runtime.preset_id)}
        </div>
        <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
          {draft === 'derived'
            ? 'Derived from business type. The live agent uses this set.'
            : 'Explicit override. Business type no longer picks the checklist.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {baseBlocks.map((blockId) => {
            const off = disabledBlocks.includes(blockId);
            const locked = blockId === 'identity';
            return (
              <button
                key={blockId}
                type="button"
                disabled={locked || loading}
                onClick={() =>
                  setDisabledBlocks((current) =>
                    current.includes(blockId)
                      ? current.filter((id) => id !== blockId)
                      : [...current, blockId]
                  )
                }
                className="text-xs font-medium px-2 py-1 rounded-lg disabled:cursor-not-allowed"
                style={{
                  backgroundColor: off ? 'transparent' : 'var(--accent-muted)',
                  color: off ? 'var(--text-muted)' : 'var(--accent-soft)',
                  border: `1px solid ${off ? 'var(--border-soft)' : 'transparent'}`,
                  textDecoration: off ? 'line-through' : undefined,
                }}
                title={
                  locked ? 'Identity stays on — contact-bearing calls need it' : 'Click to toggle'
                }
              >
                {conversationBlockLabel(blockId)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Select
          label="Booking policy"
          value={bookingMode}
          disabled={loading || !config}
          onChange={(e) => setBookingMode(e.target.value)}
          options={[
            { value: 'offer_once', label: 'Offer a time once, then message' },
            { value: 'prefer', label: 'Prefer booking whenever it fits' },
            { value: 'never', label: 'Never book — message only' },
          ]}
        />
        <Select
          label="Message policy"
          value={messageMode}
          disabled={loading || !config}
          onChange={(e) => setMessageMode(e.target.value)}
          options={[
            { value: 'always', label: 'Message is always available' },
            { value: 'fallback_only', label: 'Message only as a fallback' },
          ]}
        />
      </div>

      <div className="mt-4">
        <p
          className="block text-xs font-bold uppercase mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          Optional fields (ask only if volunteered)
        </p>
        <div className="flex flex-wrap gap-2">
          {OPTIONAL_NODE_IDS.map((nodeId) => {
            const on = optionalNodes.includes(nodeId);
            return (
              <button
                key={nodeId}
                type="button"
                disabled={loading}
                onClick={() =>
                  setOptionalNodes((current) =>
                    current.includes(nodeId)
                      ? current.filter((id) => id !== nodeId)
                      : [...current, nodeId]
                  )
                }
                className="text-xs font-medium px-2 py-1 rounded-lg"
                style={{
                  backgroundColor: on ? 'var(--accent-muted)' : 'transparent',
                  color: on ? 'var(--accent-soft)' : 'var(--text-secondary)',
                  border: `1px solid ${on ? 'transparent' : 'var(--border-soft)'}`,
                }}
              >
                {OPTIONAL_NODE_LABELS[nodeId] ?? nodeId}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving || loading || !config}
          isLoading={saving}
        >
          Save checklist
        </Button>
      </div>
    </Card>
  );
}
