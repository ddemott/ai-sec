'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Api } from '../lib/api';
import { useActiveTenantId } from '../lib/SessionContext';
import { showToast } from './ui/Toast';
import type { UsageStatementResult } from '../lib/types';

type PlanKey = 'solo' | 'growth' | 'professional';
type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled';

interface BillingStatus {
  subscription_status: SubscriptionStatus;
  subscription_plan: PlanKey | null;
}

const PLANS: {
  key: PlanKey;
  name: string;
  price: number;
  calls: string;
  features: string[];
}[] = [
  {
    key: 'solo',
    name: 'Solo',
    price: 129,
    calls: '150 calls/month',
    features: ['AI receptionist 24/7', 'Appointment booking', 'SMS reminders', 'Knowledge base'],
  },
  {
    key: 'growth',
    name: 'Growth',
    price: 279,
    calls: '500 calls/month',
    features: ['Everything in Solo', 'Call transfer to staff', 'Analytics dashboard', 'Priority support'],
  },
  {
    key: 'professional',
    name: 'Professional',
    price: 449,
    calls: '2,000 calls/month',
    features: ['Everything in Growth', 'Custom AI persona', 'Calendar sync', 'Dedicated onboarding'],
  },
];

function statusBadge(status: SubscriptionStatus) {
  switch (status) {
    case 'active':
      return <Badge variant="success">Active</Badge>;
    case 'past_due':
      return <Badge variant="warning">Past Due</Badge>;
    case 'canceled':
      return <Badge variant="danger">Canceled</Badge>;
    default:
      return <Badge variant="secondary">Free Trial</Badge>;
  }
}

export default function BillingView() {
  const tenantId = useActiveTenantId();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<UsageStatementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<PlanKey | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([Api.billing.status(tenantId), Api.billing.usage(tenantId, 6)])
      .then(([s, u]) => {
        setStatus(s as BillingStatus);
        setUsage(u);
      })
      .catch(() => showToast('Failed to load billing status', 'error'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  // Consume ?billing=success or ?billing=cancel from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('billing');
    if (result === 'success') {
      showToast('Payment successful — your subscription is now active!', 'success');
      params.delete('billing');
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      // Refetch status
      if (tenantId) {
        Api.billing
          .status(tenantId)
          .then((s) => setStatus(s as BillingStatus))
          .catch(() => null);
      }
    } else if (result === 'cancel') {
      showToast('Checkout cancelled — no charge was made.', 'info');
      params.delete('billing');
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  }, [tenantId]);

  const handleUpgrade = useCallback(
    async (plan: PlanKey) => {
      if (!tenantId) return;
      setCheckingOut(plan);
      try {
        const { url } = await Api.billing.checkout(tenantId, plan);
        window.location.href = url;
      } catch {
        showToast('Could not start checkout — try again.', 'error');
        setCheckingOut(null);
      }
    },
    [tenantId]
  );

  const handleManageBilling = useCallback(async () => {
    if (!tenantId) return;
    setOpeningPortal(true);
    try {
      const { url } = await Api.billing.portal(tenantId);
      window.location.href = url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not open billing portal';
      showToast(msg, 'error');
      setOpeningPortal(false);
    }
  }, [tenantId]);

  const currentPlan = status?.subscription_plan ?? null;
  const currentStatus = status?.subscription_status ?? 'inactive';
  const hasActiveAccount = currentStatus === 'active' || currentStatus === 'past_due';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Current plan summary */}
      <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold mb-1">Current Plan</h2>
            {loading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold capitalize">
                  {currentPlan ?? 'Free Trial'}
                </span>
                {statusBadge(currentStatus)}
              </div>
            )}
            {currentStatus === 'past_due' && (
              <p className="text-sm text-amber-400 mt-2">
                Payment failed — update your payment method to keep service active.
              </p>
            )}
            {currentStatus === 'canceled' && (
              <p className="text-sm text-red-400 mt-2">
                Subscription canceled — pick a plan below to resubscribe.
              </p>
            )}
          </div>
          {hasActiveAccount && (
            <Button
              variant="secondary"
              onClick={handleManageBilling}
              isLoading={openingPortal}
              disabled={openingPortal}
            >
              Manage Billing
            </Button>
          )}
        </div>
        {hasActiveAccount && (
          <p className="text-xs text-muted mt-4">
            Update payment method, view invoices, or cancel via the Stripe billing portal.
          </p>
        )}
      </Card>

      {/* Plan cards */}
      <div>
        <h3 className="text-base font-semibold mb-3">
          {currentPlan ? 'Change Plan' : 'Choose a Plan'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.key === currentPlan && currentStatus === 'active';
            return (
              <Card
                key={plan.key}
                className="p-5 flex flex-col gap-4"
                style={{
                  backgroundColor: 'var(--bg-raised)',
                  outline: isCurrent ? '2px solid var(--accent)' : undefined,
                }}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-base">{plan.name}</span>
                    {isCurrent && <Badge variant="success">Current</Badge>}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold">${plan.price}</span>
                    <span className="text-sm text-muted">/mo</span>
                  </div>
                  <p className="text-xs text-muted mt-1">{plan.calls}</p>
                </div>
                <ul className="space-y-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="text-sm flex items-start gap-2">
                      <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={isCurrent ? 'ghost' : 'primary'}
                  className="w-full"
                  disabled={isCurrent || checkingOut !== null}
                  isLoading={checkingOut === plan.key}
                  onClick={() => handleUpgrade(plan.key)}
                >
                  {isCurrent ? 'Current Plan' : 'Upgrade'}
                </Button>
              </Card>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted">
        Payments are processed securely by Stripe. Subscriptions renew monthly and can be canceled
        at any time.
      </p>

      <Card className="p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h3 className="text-base font-semibold">Usage & Statements</h3>
            <p className="text-xs text-muted mt-1">
              Answered calls bill at {usage?.billableMinSeconds ?? 15}+ seconds. Silent or short calls are free.
            </p>
          </div>
        </div>

        {usage?.statements.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b" style={{ borderColor: 'var(--border)' }}>
                  <th className="py-2 pr-3">Month</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Answered</th>
                  <th className="py-2 pr-3">Included</th>
                  <th className="py-2 pr-3">Overage</th>
                  <th className="py-2 pr-3">Packs</th>
                  <th className="py-2 pr-0">Pack Charge</th>
                </tr>
              </thead>
              <tbody>
                {usage.statements.map((statement) => (
                  <tr key={statement.month} className="border-b" style={{ borderColor: 'var(--border-soft)' }}>
                    <td className="py-2 pr-3">{statement.month}</td>
                    <td className="py-2 pr-3">{statement.totalCalls}</td>
                    <td className="py-2 pr-3">{statement.answeredCalls}</td>
                    <td className="py-2 pr-3">{statement.includedCalls ?? '—'}</td>
                    <td className="py-2 pr-3">{statement.overageCalls ?? '—'}</td>
                    <td className="py-2 pr-3">{statement.packsApplied ?? '—'}</td>
                    <td className="py-2 pr-0">
                      {statement.packChargeUsd == null ? '—' : `$${statement.packChargeUsd}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No answered calls yet.</p>
        )}
      </Card>
    </div>
  );
}
