'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Phone,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Rocket,
  PhoneForwarded,
  ArrowRightLeft,
  Mail,
} from 'lucide-react';
import { Api } from '../../lib/api';
import { useActiveTenantId } from '../../lib/SessionContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { showToast } from '../ui/Toast';

/**
 * Phone go-live UX — mounted in BOTH Step7GoLive.tsx (the wizard's step 9)
 * and AIConfigView.tsx (the durable post-wizard home), so an owner who
 * leaves the decision unfinished resumes identically wherever they land.
 * See docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md §3.
 *
 * Three stages, in order:
 *   A. Provision — unchanged mechanics (explicit click; never auto-buy).
 *   B. Verify the raw number — replaces the old unconditional "Your AI line
 *      is live" claim with "ready — call it to test," backed by a real
 *      poll against /voice/history. Never render "live" before a real call
 *      actually reaches the AI.
 *   C. The fork — "do you already have a number customers call?" branches
 *      to either a single "you're all set" card (new business, no existing
 *      number) or forwarding (primary, verified the same way as Stage B)
 *      + porting (secondary, a notify-Dale email — no port is ever
 *      executed by us).
 *
 * No persisted go-live-decision column (design doc §3, decision #2) — every
 * render re-derives which stage to show from phone_status +
 * forwarded_from_phone. The trade-off: an owner who already answered "no
 * existing number" sees the question again on a later visit, since that
 * answer itself was never worth persisting (nothing reads it back). An
 * owner who already saved forwarded_from_phone skips straight to Stage C
 * with that card pre-filled — that IS persisted, because it's the same
 * column the voice agent reads live.
 */

const POLL_INTERVAL_MS = 5000;

interface GoLivePanelProps {
  /** Defaults to the active tenant; only pass an override for cross-tenant admin views. */
  tenantId?: string | null;
}

type Status = 'unprovisioned' | 'provisioning' | 'active' | 'failed';

function toStatus(phoneStatus: string | null): Status {
  if (phoneStatus === 'active') return 'active';
  if (phoneStatus === 'provisioning') return 'provisioning';
  if (phoneStatus === 'failed') return 'failed';
  return 'unprovisioned';
}

/**
 * Polls /voice/history for a session that started after `sinceIso`. Used by
 * both Stage B (does the raw Telnyx number answer?) and the forwarding card
 * (does a call to the REAL business number reach the AI?) — same mechanism,
 * different reference timestamp, so an old pre-existing call never falsely
 * satisfies either check.
 */
function useCallDetector(tenantId: string | null, sinceIso: string | null, active: boolean) {
  const [detected, setDetected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setDetected(false);
    if (!active || !tenantId || !sinceIso) return;

    const since = Date.parse(sinceIso);
    const poll = async () => {
      try {
        const res = await Api.voice.getHistory(tenantId, { limit: 1 });
        const latest = res.calls?.[0];
        if (latest && Date.parse(latest.started_at) >= since) {
          setDetected(true);
        }
      } catch {
        // transient fetch failure — next tick retries, nothing to surface
      }
    };
    void poll();
    timerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tenantId, sinceIso, active]);

  return detected;
}

export function GoLivePanel({ tenantId: tenantIdProp }: GoLivePanelProps) {
  const activeTenantId = useActiveTenantId();
  const tenantId = tenantIdProp !== undefined ? tenantIdProp : activeTenantId;

  const [areaCode, setAreaCode] = useState('');
  const [status, setStatus] = useState<Status>('unprovisioned');
  const [inboundPhone, setInboundPhone] = useState<string | null>(null);
  const [forwardedFromPhone, setForwardedFromPhone] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  // Reference timestamp for Stage B's poll — set the moment THIS session
  // sees the number flip to active, so a call from before this visit never
  // falsely counts as "the test call."
  const [activatedAt, setActivatedAt] = useState<string | null>(null);
  const [rawNumberConfirmedThisSession, setRawNumberConfirmedThisSession] = useState(false);

  // Stage C state
  const [hasExistingNumber, setHasExistingNumber] = useState<boolean | null>(null);
  const [forwardInput, setForwardInput] = useState('');
  const [savingForward, setSavingForward] = useState(false);
  const [forwardSavedAt, setForwardSavedAt] = useState<string | null>(null);
  const [portNumber, setPortNumber] = useState('');
  const [portNotes, setPortNotes] = useState('');
  const [portSubmitting, setPortSubmitting] = useState(false);
  const [portSubmitted, setPortSubmitted] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await Api.provisioning.status(tenantId);
      setStatus((prev) => {
        const next = toStatus(data.phone_status);
        // First time this session sees 'active' — anchor the poll window.
        if (next === 'active' && prev !== 'active') setActivatedAt(new Date().toISOString());
        return next;
      });
      setInboundPhone(data.inbound_phone);
      setForwardedFromPhone(data.forwarded_from_phone);
      if (data.forwarded_from_phone) setForwardInput(data.forwarded_from_phone);
    } catch {
      // status poll failure is non-fatal — the panel just stays on
      // whatever it last knew and the next mount/retry tries again
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  async function handleActivate() {
    if (!tenantId) return;
    setActivating(true);
    setActivateError(null);
    setStatus('provisioning');
    try {
      const result = await Api.provisioning.activate(tenantId, areaCode.trim() || undefined);
      setStatus('active');
      setInboundPhone(result.phone_number);
      setActivatedAt(new Date().toISOString());
    } catch (err: unknown) {
      setStatus('failed');
      setActivateError(err instanceof Error ? err.message : 'Failed to activate phone');
    } finally {
      setActivating(false);
    }
  }

  // Stage B: does the raw Telnyx number answer at all?
  const rawNumberDetected = useCallDetector(
    tenantId,
    activatedAt,
    status === 'active' && !rawNumberConfirmedThisSession && !forwardedFromPhone
  );
  useEffect(() => {
    if (rawNumberDetected) setRawNumberConfirmedThisSession(true);
  }, [rawNumberDetected]);

  // Forwarding card: does a call to the OWNER'S REAL number reach the AI?
  const forwardingDetected = useCallDetector(tenantId, forwardSavedAt, !!forwardSavedAt);

  async function handleSaveForwarding() {
    if (!tenantId || !forwardInput.trim()) return;
    setSavingForward(true);
    try {
      const res = await Api.tenants.updateConfig(tenantId, {
        forwarded_from_phone: forwardInput.trim(),
      });
      if (res.success) {
        setForwardedFromPhone(forwardInput.trim());
        setForwardSavedAt(new Date().toISOString());
        showToast('Forwarding number saved');
      } else {
        showToast(res.error || 'Failed to save', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    }
    setSavingForward(false);
  }

  async function handlePortInquiry() {
    if (!tenantId || !portNumber.trim()) return;
    setPortSubmitting(true);
    try {
      const res = await Api.provisioning.portInquiry(
        tenantId,
        portNumber.trim(),
        portNotes.trim() || undefined
      );
      if (res.success) {
        setPortSubmitted(true);
      } else {
        showToast(res.error || 'Failed to submit', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to submit', 'error');
    }
    setPortSubmitting(false);
  }

  // ── Stage A: not yet provisioned ──────────────────────────────────────
  if (status === 'unprovisioned' || status === 'failed') {
    return (
      <div className="space-y-6">
        <PanelHeader />
        <div className="p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1 block">
              Preferred area code (optional)
            </label>
            <Input
              placeholder="e.g. 312"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="max-w-[120px]"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              We&apos;ll try to get a number with this area code. Leave blank for any available
              number.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => void handleActivate()}
            disabled={activating}
            isLoading={activating}
            icon={Phone}
            className="w-full py-3"
          >
            Activate AI Phone Line
          </Button>
        </div>
        {status === 'failed' && activateError && (
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
            <div>
              <div className="font-bold text-red-700 dark:text-red-300 text-sm">
                Activation failed
              </div>
              <div className="text-sm text-red-600 dark:text-red-400 mt-1">{activateError}</div>
            </div>
          </div>
        )}
        {!activateError && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            You can skip this step and activate later from Settings.
          </p>
        )}
      </div>
    );
  }

  // ── Provisioning in flight ─────────────────────────────────────────────
  if (status === 'provisioning') {
    return (
      <div className="space-y-6">
        <PanelHeader />
        <div className="p-6 rounded-xl border border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-950/20 flex items-center gap-4">
          <Loader2 className="w-6 h-6 text-yellow-600 dark:text-yellow-400 animate-spin" />
          <div>
            <div className="font-bold text-yellow-700 dark:text-yellow-300">
              Setting up your phone line...
            </div>
            <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
              This usually takes 10-30 seconds.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Stage B: number is provisioned, prove it actually answers ─────────
  // Skipped entirely for a returning visit where forwarding was already
  // configured — that owner has clearly been through this before.
  const showStageB = !rawNumberConfirmedThisSession && !forwardedFromPhone;
  if (showStageB) {
    return (
      <div className="space-y-6">
        <PanelHeader />
        <div className="p-6 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
            <span className="text-lg font-bold text-green-700 dark:text-green-300">
              Your number is ready
            </span>
          </div>
          <div className="flex items-center gap-3 ml-9 mb-4">
            <Phone className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-xl font-display tracking-wide text-green-800 dark:text-green-200">
              {inboundPhone}
            </span>
          </div>
          <div className="ml-9 flex items-center gap-3 p-3 rounded-lg bg-white/60 dark:bg-black/20">
            <Loader2 className="w-4 h-4 text-green-600 dark:text-green-400 animate-spin shrink-0" />
            <span className="text-sm text-green-700 dark:text-green-300">
              Call this number now — we&apos;ll confirm here the moment your AI receptionist
              answers.
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRawNumberConfirmedThisSession(true)}
          className="text-xs underline-offset-2 hover:underline text-center w-full block"
          style={{ color: 'var(--text-secondary)' }}
        >
          I&apos;ll test it later — continue setup
        </button>
      </div>
    );
  }

  // ── Stage C: the fork ───────────────────────────────────────────────────
  const askQuestion = hasExistingNumber === null && !forwardedFromPhone;

  return (
    <div className="space-y-6">
      <PanelHeader />
      <div className="p-4 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20 flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
        <span className="text-sm text-green-700 dark:text-green-300">
          <strong className="font-display tracking-wide">{inboundPhone}</strong> is live — your AI
          receptionist answers calls to this number.
        </span>
      </div>

      {askQuestion ? (
        <div className="p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 space-y-4">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Do you already have a phone number customers call today?
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setHasExistingNumber(false)}>
              No — this is new
            </Button>
            <Button variant="secondary" onClick={() => setHasExistingNumber(true)}>
              Yes, I have one
            </Button>
          </div>
        </div>
      ) : hasExistingNumber === false ? (
        <div className="p-6 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20 space-y-2">
          <div className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="font-bold text-green-700 dark:text-green-300">
              You&apos;re all set
            </span>
          </div>
          <p className="text-sm text-green-700 dark:text-green-300">
            <strong className="font-display">{inboundPhone}</strong> is your new business number —
            share it with customers whenever you&apos;re ready.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Forwarding — primary path */}
          <div
            className="p-6 rounded-xl border-2 space-y-4"
            style={{ borderColor: 'var(--accent-soft)' }}
          >
            <div className="flex items-center gap-2">
              <PhoneForwarded className="w-5 h-5" style={{ color: 'var(--accent-soft)' }} />
              <span className="font-bold text-gray-900 dark:text-gray-100">
                Forward your existing number
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Keep your real number published. Set up call forwarding on your carrier&apos;s side to{' '}
              <strong className="font-display">{inboundPhone}</strong>, fully reversible any time.
            </p>
            <Input
              type="tel"
              label="Your real business number"
              value={forwardInput}
              onChange={(e) => setForwardInput(e.target.value)}
              placeholder="Ex: +1 608 217 5303"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSaveForwarding()}
              isLoading={savingForward}
              disabled={savingForward || !forwardInput.trim()}
            >
              Save
            </Button>
            {forwardedFromPhone && !forwardingDetected && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
                <Loader2
                  className="w-4 h-4 animate-spin shrink-0"
                  style={{ color: 'var(--accent-soft)' }}
                />
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  Call <strong>{forwardedFromPhone}</strong> now — if the AI answers, forwarding
                  works.
                </span>
              </div>
            )}
            {forwardingDetected && (
              <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
                <CheckCircle2 className="w-4 h-4" />
                Forwarding verified — a call to {forwardedFromPhone} reached your AI.
              </div>
            )}
          </div>

          {/* Porting — secondary path, visually de-emphasized */}
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3 opacity-90">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Want us to take over your number completely?
              </span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Most businesses start with forwarding today and port their number later once
              everything&apos;s working. Porting is a manual process — email us and we&apos;ll help
              you plan next steps. No timeline is promised.
            </p>
            {portSubmitted ? (
              <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sent — we&apos;ll follow up by email.
              </p>
            ) : (
              <div className="space-y-2">
                <Input
                  type="tel"
                  value={portNumber}
                  onChange={(e) => setPortNumber(e.target.value)}
                  placeholder="Number you'd like to port"
                />
                <Input
                  value={portNotes}
                  onChange={(e) => setPortNotes(e.target.value)}
                  placeholder="Anything we should know (optional)"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Mail}
                  onClick={() => void handlePortInquiry()}
                  isLoading={portSubmitting}
                  disabled={portSubmitting || !portNumber.trim()}
                >
                  Email us about porting
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelHeader() {
  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Rocket className="w-5 h-5" style={{ color: 'var(--accent-soft)' }} />
        Go Live
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Get your AI receptionist answering real calls.
      </p>
    </div>
  );
}
