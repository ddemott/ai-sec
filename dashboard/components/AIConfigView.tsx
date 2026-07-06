'use client';

import React, { useEffect, useState } from 'react';
import { type Tenant } from '@/lib/types';
import {
  Settings,
  MessageSquare,
  Mic,
  Info,
  Sparkles,
  PhoneForwarded,
  Bell,
  Clock,
} from 'lucide-react';
import { Api } from '../lib/api';
import { normalizePhone, formatPhone } from '../../shared/phone';
import { useActiveTenantId } from '../lib/SessionContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { showToast } from './ui/Toast';
import { LoadingState } from './ui/LoadingState';
import { GoLivePanel } from './phone/GoLivePanel';

// Per-industry starter example for the Customer Preferences textarea, so an
// owner isn't staring at a blank box. Matched loosely on the tenant's
// business_type so it survives template-id variants (e.g. "salon" / "salon_v1")
// and falls back to a generic-but-good example for anything unrecognized
// (including the platform-admin tenant). Shown as placeholder only — the moment
// the owner types, their own words take over.
function preferencesPlaceholder(businessType?: string | null): string {
  const t = (businessType || '').toLowerCase();
  if (/salon|spa|hair|nail|beauty|barber|lash|brow/.test(t)) {
    return 'Ex: Remember the service each client had and which stylist did it. If they book a cut and never mention nails, offer to add a manicure. Always offer them the same stylist they had last time. Note colors, products, or sensitivities they mention so next time feels personal.';
  }
  if (/auto|tire|mechanic|repair|bay|vehicle|car|lube|brake/.test(t)) {
    return "Ex: Remember the customer's vehicle (year/make/model) and the last service done. If they're due for something related — a rotation after new tires, the next oil-change interval — mention it. Note any preferred technician and recurring concerns (brakes, alignment) to bring up next time.";
  }
  if (/trade|plumb|hvac|electric|contractor|roof|handyman|landscap/.test(t)) {
    return 'Ex: Remember the property and the work last done, plus equipment details (furnace model, water-heater age). Flag recurring issues and seasonal maintenance (an AC tune-up before summer). Note a preferred tech and the time window the customer likes.';
  }
  if (/fitness|gym|yoga|studio|pilates|train|crossfit|cycle/.test(t)) {
    return "Ex: Remember the classes or trainer the member prefers and their goals. Suggest the next session in their usual time slot, or a related class they'd enjoy. Note any injuries or limitations they mention so bookings stay appropriate.";
  }
  if (/food|restaurant|cafe|coffee|bar|dining|kitchen|catering|grill/.test(t)) {
    return "Ex: Remember the customer's usual order and party size, their favorite table or seating, and any dietary needs or allergies. Offer their usual and flag specials they'd like. Note occasions (birthdays, anniversaries) to personalize the visit.";
  }
  return "Ex: Remember what each customer prefers — the service they had, who served them, and anything they like or want to avoid. Use it next time to greet them personally and suggest things they'd genuinely want. Don't save one-off details or anything they ask you to keep private.";
}

// Business-type / template browsing lives in BusinessSettingsView now
// (BusinessTypeSection.tsx). Owners pick the template once during the
// wizard — putting the 24-card grid here forced every prompt-tuning
// visit to scroll past it, and the unguarded "Apply" click could
// overwrite a hand-tuned persona in one tap.
export default function AIConfigView() {
  const tenantId = useActiveTenantId();
  const [config, setConfig] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (tenantId) {
      void fetchConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function fetchConfig() {
    setLoading(true);
    try {
      const data = await Api.tenants.getConfig(tenantId);
      if (!data) {
        // Do NOT fall back to a mock/demo tenant here: this is a real owner's
        // workspace, and loading a foreign tenant's persona (editable, and Save
        // would POST to THAT tenant_id) is a cross-tenant integrity bug. Surface
        // an error instead. MOCK data belongs only to the no-tenant demo path.
        setConfig(null);
        setLoadError(true);
      } else {
        setConfig(data);
        setLoadError(false);
      }
    } catch {
      setConfig(null);
      setLoadError(true);
    }
    setLoading(false);
    setDirty(false);
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);

    try {
      const res = await Api.tenants.updateConfig(config.tenant_id, {
        system_prompt: config.system_prompt,
        voice_id: config.voice_id,
        business_type: config.business_type,
        first_message: config.first_message,
        save_preferences_enabled: config.save_preferences_enabled ?? false,
        preferences_instructions: config.preferences_instructions ?? null,
        tts_voice: config.tts_voice ?? null,
        tts_speed: config.tts_speed ?? null,
        tts_soft: config.tts_soft ?? null,
        tts_cheerful: config.tts_cheerful ?? null,
        tts_formal: config.tts_formal ?? null,
        tts_warm: config.tts_warm ?? null,
        tts_concise: config.tts_concise ?? null,
        // Normalize to clean E.164 for storage so the agent builds a valid
        // tel: URI. Blank/invalid → null (forwarding off → AI takes a message).
        forward_phone: normalizePhone(config.forward_phone),
        // forwarded_from_phone is intentionally NOT in this batched save —
        // GoLivePanel (rendered below) owns that field end-to-end with its
        // own immediate Api.tenants.updateConfig call. Two save paths for
        // the same column on one page would let this batched Save silently
        // clobber whatever GoLivePanel just wrote (or vice versa) until a
        // reload. See docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md §3.
        // Normalize owner notification phone the same way.
        owner_phone: normalizePhone(config.owner_phone),
        default_buffer_minutes: config.default_buffer_minutes ?? 0,
      });
      setSuccess(res.success);
      if (res.success) {
        setDirty(false);
        showToast('AI persona saved');
        setTimeout(() => setSuccess(false), 3000);
      } else {
        // A non-2xx save (validation 400, cross-tenant 403, loop-guard 400)
        // resolves — apiMutate returns { success:false, error } rather than
        // throwing — so without this branch the owner clicks Save and gets
        // ZERO feedback while `dirty` stays true. Surface the backend reason
        // (e.g. the forward-loop message) or a generic fallback.
        showToast(res.error || 'Failed to save', 'error');
      }
    } catch (e) {
      console.error('Failed to save config', e);
      showToast('Failed to save', 'error');
    }
    setSaving(false);
  }

  // Client-side mirror of the backend loop guard (src/services/phoneLoopGuard.ts):
  // a transfer target equal to the forwarded-from line or the AI's own DID would
  // forward the live call straight back into the assistant. Shown inline + blocks
  // Save for instant feedback; the backend remains the source of truth.
  const forwardLoops =
    !!normalizePhone(config?.forward_phone) &&
    (normalizePhone(config?.forward_phone) === normalizePhone(config?.forwarded_from_phone) ||
      normalizePhone(config?.forward_phone) === normalizePhone(config?.inbound_phone));

  if (loading) return <LoadingState message="Loading AI configuration…" />;

  if (!config) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
      >
        <p style={{ color: 'var(--text-secondary)' }}>
          {loadError
            ? "We couldn't load your AI settings. Check your connection and try again."
            : 'No AI settings available.'}
        </p>
        <Button variant="secondary" onClick={() => void fetchConfig()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <header
        className="p-4 md:p-8 flex items-center justify-between sticky top-0 z-10"
        style={{
          borderBottom: '1px solid var(--border-soft)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div className="flex items-center">
          <div
            className="p-2 rounded-lg mr-4 shadow-md"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}
          >
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-display">Voice Settings</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Customize how your AI sounds and what it says. To change your business type, go to
              Business Settings.
            </p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          isLoading={saving}
          variant={success ? 'success' : 'primary'}
          className="px-6 py-2.5"
          disabled={!dirty || saving || forwardLoops}
        >
          {success ? 'Saved!' : 'Save Changes'}
        </Button>
      </header>

      <div className="p-4 md:p-8 space-y-8 max-w-4xl">
        {/* System Prompt Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2
              className="text-lg font-bold flex items-center"
              style={{ color: 'var(--text-primary)' }}
            >
              <MessageSquare className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
              Personality &amp; Instructions
            </h2>
            <span
              className="text-xs font-medium px-2 py-1 rounded"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-raised)' }}
            >
              Advanced
            </span>
          </div>
          <div
            className="border p-4 rounded-xl flex items-start"
            style={{ backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent-muted)' }}
          >
            <Info
              className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0"
              style={{ color: 'var(--accent-soft)' }}
            />
            <p className="text-sm leading-relaxed" style={{ color: 'var(--accent-soft)' }}>
              This prompt defines your AI&apos;s personality. Tell it what to say, what to avoid,
              and how to handle specific situations. The AI will follow these rules on every call.
            </p>
          </div>
          <textarea
            rows={10}
            value={config?.system_prompt || ''}
            onChange={(e) => {
              setConfig((prev) => (prev ? { ...prev, system_prompt: e.target.value } : null));
              setDirty(true);
            }}
            className="w-full p-4 border rounded-xl text-sm md:text-base leading-relaxed focus:ring-2 outline-none shadow-inner font-mono"
            style={{
              borderColor: 'var(--border-soft)',
              backgroundColor: 'var(--bg-raised)',
              color: 'var(--text-primary)',
            }}
            placeholder="Ex: You are a warm, professional assistant for our business. Greet callers, answer their questions, and help them book. Be concise..."
          />
        </section>

        {/* First Message Section */}
        <section className="space-y-4">
          <h2
            className="text-lg font-bold flex items-center"
            style={{ color: 'var(--text-primary)' }}
          >
            <MessageSquare className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            First Message (Greeting)
          </h2>
          <Input
            value={config?.first_message || ''}
            onChange={(e) => {
              setConfig((prev) => (prev ? { ...prev, first_message: e.target.value } : null));
              setDirty(true);
            }}
            placeholder="Ex: Thanks for calling! How can I help you today?"
          />
        </section>

        {/* Go Live — provisioning, test-call verification, and the
            forwarding/porting fork. Owns forwarded_from_phone end-to-end
            (its own immediate save) — deliberately NOT part of this page's
            batched handleSave; see the comment there. */}
        <section className="space-y-4">
          <GoLivePanel />
        </section>

        {/* Forward Calls Section — live transfer to a human (owner cell). */}
        <section className="space-y-4">
          <h2
            className="text-lg font-bold flex items-center"
            style={{ color: 'var(--text-primary)' }}
          >
            <PhoneForwarded className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            Forward Calls to a Person
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            When a caller needs a real person, the assistant can transfer the live call to this
            number (e.g. your cell). Leave blank to have the assistant take a message instead.
          </p>
          <Input
            type="tel"
            label="Forward calls to"
            value={config?.forward_phone || ''}
            onChange={(e) => {
              setConfig((prev) => (prev ? { ...prev, forward_phone: e.target.value } : null));
              setDirty(true);
            }}
            placeholder="Ex: +1 312 555 0100"
          />
          {forwardLoops && (
            <p className="text-sm" style={{ color: 'var(--danger, #dc2626)' }}>
              This can&apos;t be the same as your forwarded-from number or the assistant&apos;s own
              number — the call would loop back to the assistant.
            </p>
          )}
        </section>

        {/* Owner Notification Phone — SMS alert when caller leaves a message */}
        <section className="space-y-4">
          <h2
            className="text-lg font-bold flex items-center"
            style={{ color: 'var(--text-primary)' }}
          >
            <Bell className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            Owner Notification Phone
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            When a caller leaves a message, the AI will send you an SMS alert at this number. Leave
            blank to disable SMS notifications.
          </p>
          <Input
            type="tel"
            label="Notification number"
            value={config?.owner_phone || ''}
            onChange={(e) => {
              setConfig((prev) => (prev ? { ...prev, owner_phone: e.target.value } : null));
              setDirty(true);
            }}
            placeholder="Ex: +1 630 555 0100"
          />
        </section>

        {/* Voice Selection Section */}
        <section className="space-y-4">
          <h2
            className="text-lg font-bold flex items-center"
            style={{ color: 'var(--text-primary)' }}
          >
            <Mic className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
            Voice Identity
          </h2>
          {/* OpenAI TTS voices — the actual voices the live agent uses.
              Selection writes tts_voice; null = platform default (Shimmer). */}
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            role="radiogroup"
            aria-label="Voice selection"
          >
            {[
              { id: 'shimmer', name: 'Shimmer — Female', desc: 'Warm, calm, gentle (default)' },
              { id: 'nova', name: 'Nova — Female', desc: 'Bright, friendly, upbeat' },
              { id: 'alloy', name: 'Alloy — Neutral', desc: 'Balanced, even-toned' },
              { id: 'echo', name: 'Echo — Male', desc: 'Clear, steady' },
              { id: 'onyx', name: 'Onyx — Male', desc: 'Deep, authoritative' },
              { id: 'fable', name: 'Fable — Expressive', desc: 'Animated, storytelling tone' },
            ].map((voice) => (
              <Card
                key={voice.id}
                onClick={() => {
                  setConfig((prev) => (prev ? { ...prev, tts_voice: voice.id } : null));
                  setDirty(true);
                }}
                className={`p-4 cursor-pointer flex items-center justify-between ${config?.tts_voice === voice.id ? 'ring-1' : ''}`}
                style={
                  config?.tts_voice === voice.id
                    ? {
                        borderColor: 'var(--accent)',
                        ['--tw-ring-color' as string]: 'var(--accent)',
                      }
                    : undefined
                }
                role="radio"
                aria-checked={config?.tts_voice === voice.id}
                aria-label={voice.name}
              >
                <div>
                  <p className="font-bold">{voice.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {voice.desc}
                  </p>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border-2`}
                  style={
                    config?.tts_voice === voice.id
                      ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' }
                      : { borderColor: 'var(--border-soft)' }
                  }
                />
              </Card>
            ))}
          </div>

          {/* Delivery — speed slider */}
          <div className="pt-2">
            <label
              htmlFor="tts-speed"
              className="block text-sm font-semibold mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Speaking pace — {(config?.tts_speed ?? 1.0).toFixed(2)}×
            </label>
            <input
              id="tts-speed"
              type="range"
              min={0.7}
              max={1.5}
              step={0.05}
              value={config?.tts_speed ?? 1.0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setConfig((prev) => (prev ? { ...prev, tts_speed: v } : null));
                setDirty(true);
              }}
              className="w-full"
              aria-label="Speaking pace"
            />
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              1.0 is normal pace. Lower = slower and calmer; higher = brisker.
            </p>
          </div>

          {/* Voice style checkboxes */}
          <div className="pt-2">
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Voice style
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  {
                    key: 'tts_formal',
                    label: 'Formal',
                    description: 'Professional, no contractions',
                  },
                  { key: 'tts_warm', label: 'Warm', description: 'Empathetic, caring' },
                  {
                    key: 'tts_concise',
                    label: 'Concise',
                    description: 'Fewer words, faster to the point',
                  },
                  {
                    key: 'tts_soft',
                    label: 'Soft',
                    description: 'Gentle, calm, soothing delivery',
                  },
                  {
                    key: 'tts_cheerful',
                    label: 'Cheerful',
                    description: 'Bright, friendly, upbeat',
                  },
                ] as { key: keyof typeof config; label: string; description: string }[]
              ).map(({ key, label, description }) => (
                <label
                  key={key}
                  className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border"
                  style={{
                    borderColor: config?.[key] ? 'var(--accent)' : 'var(--border-soft)',
                    backgroundColor: config?.[key] ? 'var(--accent-muted)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!config?.[key]}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setConfig((prev) => (prev ? { ...prev, [key]: v } : null));
                      setDirty(true);
                    }}
                    aria-label={label}
                    className="mt-0.5"
                  />
                  <span>
                    <span
                      className="block text-sm font-medium"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {label}
                    </span>
                    <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Customer Preferences Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2
              className="text-lg font-bold flex items-center"
              style={{ color: 'var(--text-primary)' }}
            >
              <Sparkles className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
              Customer Preferences
            </h2>
            {/* Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={config?.save_preferences_enabled ?? false}
              aria-label="Save customer preferences"
              onClick={() => {
                setConfig((prev) =>
                  prev
                    ? {
                        ...prev,
                        save_preferences_enabled: !(prev.save_preferences_enabled ?? false),
                      }
                    : null
                );
                setDirty(true);
              }}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              style={{
                backgroundColor: config?.save_preferences_enabled
                  ? 'var(--accent)'
                  : 'var(--border-soft)',
              }}
            >
              <span
                className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                style={{
                  transform: config?.save_preferences_enabled
                    ? 'translateX(24px)'
                    : 'translateX(4px)',
                }}
              />
            </button>
          </div>
          <div
            className="border p-4 rounded-xl flex items-start"
            style={{ backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent-muted)' }}
          >
            <Info
              className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0"
              style={{ color: 'var(--accent-soft)' }}
            />
            <p className="text-sm leading-relaxed" style={{ color: 'var(--accent-soft)' }}>
              When this is on, your AI remembers things about each customer between calls — their
              favorite service, who served them last, what they like — and uses it to give a
              personal welcome and suggest things they&apos;d genuinely enjoy. Describe below{' '}
              <strong>what</strong> to remember, <strong>why</strong> it matters, and{' '}
              <strong>when</strong> to bring it up, so the AI uses it intelligently instead of
              guessing. Leave it blank to use a sensible default.
            </p>
          </div>
          <textarea
            data-testid="preferences-instructions"
            rows={8}
            disabled={!config?.save_preferences_enabled}
            value={config?.preferences_instructions || ''}
            onChange={(e) => {
              setConfig((prev) =>
                prev ? { ...prev, preferences_instructions: e.target.value } : null
              );
              setDirty(true);
            }}
            className="w-full p-4 border rounded-xl text-sm md:text-base leading-relaxed focus:ring-2 outline-none shadow-inner disabled:opacity-50"
            style={{
              borderColor: 'var(--border-soft)',
              backgroundColor: 'var(--bg-raised)',
              color: 'var(--text-primary)',
            }}
            placeholder={preferencesPlaceholder(config?.business_type)}
          />
        </section>

        {/* Buffer Between Appointments Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2
              className="text-lg font-bold flex items-center"
              style={{ color: 'var(--text-primary)' }}
            >
              <Clock className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
              Buffer Between Appointments
            </h2>
            <div className="flex items-center">
              <input
                data-testid="default-buffer-minutes"
                type="number"
                min={0}
                max={120}
                step={5}
                value={config?.default_buffer_minutes ?? 0}
                onChange={(e) => {
                  // Clamp to the same 0–120 range the backend Zod schema
                  // enforces; an empty field reads back as 0 (no buffer).
                  const raw = Number.parseInt(e.target.value, 10);
                  const clamped = Number.isNaN(raw) ? 0 : Math.min(120, Math.max(0, raw));
                  setConfig((prev) => (prev ? { ...prev, default_buffer_minutes: clamped } : null));
                  setDirty(true);
                }}
                className="w-20 p-2 border rounded-lg text-right text-base focus:ring-2 outline-none"
                style={{
                  borderColor: 'var(--border-soft)',
                  backgroundColor: 'var(--bg-raised)',
                  color: 'var(--text-primary)',
                }}
                aria-label="Default buffer minutes between appointments"
              />
              <span className="ml-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                minutes
              </span>
            </div>
          </div>
          <div
            className="border p-4 rounded-xl flex items-start"
            style={{ backgroundColor: 'var(--accent-muted)', borderColor: 'var(--accent-muted)' }}
          >
            <Info
              className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0"
              style={{ color: 'var(--accent-soft)' }}
            />
            <p className="text-sm leading-relaxed" style={{ color: 'var(--accent-soft)' }}>
              A gap your AI leaves between bookings so you can gather your thoughts, take notes, or
              just breathe between appointments. With a 15-minute buffer, an 8:00–9:00 appointment
              means the next opening your AI offers is 9:15, not 9:00. Set to <strong>0</strong> to
              allow back-to-back bookings. This only affects what your AI books — you can still
              place back-to-back appointments yourself from the schedule.
            </p>
          </div>
        </section>

        {/* Test Section */}
        <section className="pt-8 border-t" style={{ borderColor: 'var(--border-soft)' }}>
          <Card
            className="p-6 flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          >
            <div>
              <h3 className="text-lg font-bold">Ready to test?</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Save your changes and call your business number to hear the new persona.
              </p>
            </div>
            {normalizePhone(config.inbound_phone) ? (
              <Button
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  window.location.href = `tel:${normalizePhone(config.inbound_phone)}`;
                }}
              >
                Call {formatPhone(config.inbound_phone)}
              </Button>
            ) : (
              <p className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>
                No business number set up yet.
              </p>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
