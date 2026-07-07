'use client';

import React from 'react';

interface Tenant {
  tenant_id: string;
  name: string;
  business_type: string;
}

interface TenantSwitcherDropdownProps {
  allTenants: Tenant[];
  managedTenantId: string | null | undefined;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onSelect: (tenantId: string, name: string) => void;
  onSelectTab: (tab: string) => void;
  activeTab: string;
}

export function TenantSwitcherDropdown({
  allTenants,
  managedTenantId,
  anchorRect,
  onClose,
  onSelect,
  onSelectTab,
  activeTab,
}: TenantSwitcherDropdownProps) {
  return (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div
        data-testid="tenant-switcher-panel"
        className="fixed z-[100] w-64 rounded-xl shadow-2xl border overflow-hidden"
        style={{
          top: anchorRect ? anchorRect.bottom + 4 : 0,
          left: anchorRect ? anchorRect.left : 0,
          backgroundColor: 'var(--bg-raised)',
          color: 'var(--text-primary)',
          borderColor: 'var(--border-soft)',
        }}
      >
        <div
          className="p-2 border-b text-xs font-bold uppercase tracking-widest"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-soft)',
            color: 'var(--text-muted)',
          }}
        >
          Switch Active Business
        </div>
        <div
          className="max-h-60 overflow-y-auto"
          role="listbox"
          aria-label="Select active business"
          onKeyDown={(e) => {
            const items = e.currentTarget.querySelectorAll('[role="option"]');
            const focused = e.currentTarget.querySelector<HTMLElement>(':focus');
            const idx = focused ? Array.from(items).indexOf(focused) : -1;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              (items[idx + 1] as HTMLElement | undefined)?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              (items[idx - 1] as HTMLElement | undefined)?.focus();
            } else if (e.key === 'Enter' && focused) {
              focused.click();
            }
          }}
        >
          {allTenants.map((t) => (
            <button
              key={t.tenant_id}
              role="option"
              aria-selected={managedTenantId === t.tenant_id}
              onClick={() => {
                onSelect(t.tenant_id, t.name);
                onClose();
                if (activeTab === 'all-businesses') onSelectTab('dashboard');
              }}
              className="w-full text-left px-4 py-3 flex flex-col transition-colors border-b hover:brightness-125"
              style={{
                backgroundColor:
                  managedTenantId === t.tenant_id ? 'var(--accent-muted)' : undefined,
                borderColor: 'var(--border-soft)',
              }}
            >
              <span className="text-sm font-bold">{t.name}</span>
              <span className="text-xs opacity-50 uppercase tracking-tighter">
                {t.business_type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
