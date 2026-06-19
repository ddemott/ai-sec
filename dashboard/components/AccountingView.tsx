'use client';

/**
 * Accounting tab. When the add-on is off, shows an enable/upsell panel; when on,
 * embeds the MyAccountant dashboard (federated) via an SSO iframe so it feels
 * like one application. MyAccountant is the accounting engine; this is the shell.
 */
import React, { useEffect, useState } from 'react';
import { Api } from '../lib/api';
import { useActiveTenantId } from '../lib/SessionContext';
import { showToast } from './ui/Toast';

export default function AccountingView() {
  const tenantId = useActiveTenantId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [ssoUrl, setSsoUrl] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);

  const loadSso = async () => {
    try {
      const { url } = await Api.accounting.ssoUrl();
      setSsoUrl(url);
    } catch {
      showToast('Could not open accounting', 'error');
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    Api.accounting
      .enabled()
      .then((r) => {
        setEnabled(r.accounting_enabled);
        if (r.accounting_enabled) void loadSso();
      })
      .catch(() => setEnabled(false));
  }, [tenantId]);

  async function enable() {
    setProvisioning(true);
    try {
      await Api.accounting.provision();
      setEnabled(true);
      await loadSso();
      showToast('Accounting enabled', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to enable accounting', 'error');
    } finally {
      setProvisioning(false);
    }
  }

  if (enabled === null) {
    return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  }

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-10 text-center">
        <h2 className="text-xl font-semibold">Accounting add-on</h2>
        <p className="mt-2 max-w-md text-sm text-gray-500">
          Invoicing, payments, expenses, and a full double-entry ledger — built in. Enable it to
          start billing your customers and tracking the books, right inside Secretary HQ.
        </p>
        <button
          onClick={enable}
          disabled={provisioning}
          className="mt-5 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {provisioning ? 'Enabling…' : 'Enable Accounting'}
        </button>
      </div>
    );
  }

  if (!ssoUrl) {
    return <div className="p-8 text-sm text-gray-500">Opening accounting…</div>;
  }

  return (
    <iframe
      src={ssoUrl}
      title="Accounting"
      className="h-full w-full border-0"
      style={{ minHeight: '85vh' }}
    />
  );
}
