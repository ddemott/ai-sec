'use client';

import React, { useState, useEffect } from 'react';
import { X, Wand2, Search, ChevronRight } from 'lucide-react';
import { Api } from '../../lib/api';
import type { BusinessTemplate } from '../../lib/types';

interface BusinessTypePickerProps {
  onSelect: (businessType: string) => void;
  onClose: () => void;
  onBack: () => void;
}

export function BusinessTypePicker({ onSelect, onClose, onBack }: BusinessTypePickerProps) {
  const [templates, setTemplates] = useState<BusinessTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    Api.templates
      .list()
      .then((data) => {
        setTemplates(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Group by category
  const grouped: Record<string, BusinessTemplate[]> = {};
  const filtered = templates.filter(
    (t) =>
      t.display_name.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase())
  );
  for (const t of filtered) {
    const cat = t.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }
  const categories = Object.keys(grouped).sort();

  // When searching, expand all categories
  const isSearching = search.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="rounded-2xl shadow-xl border max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" style={{ color: 'var(--accent-soft)' }} />
            <h2 className="text-lg font-bold">What kind of business?</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 transition"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              data-shortcut-target="search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search business types..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              autoFocus
            />
          </div>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {loading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading...</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No matching business types found.
            </p>
          ) : (
            <div className="space-y-1">
              {categories.map((cat) => {
                const isExpanded = isSearching || expandedCategory === cat;
                const items = grouped[cat];
                return (
                  <div key={cat}>
                    <button
                      onClick={() => setExpandedCategory(isExpanded && !isSearching ? null : cat)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      <span>{cat}</span>
                      <span className="flex items-center gap-2">
                        <span
                          className="text-xs font-normal"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {items.length}
                        </span>
                        <ChevronRight
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          style={{ color: 'var(--text-secondary)' }}
                        />
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="ml-3 space-y-0.5 mb-2">
                        {items.map((t) => (
                          <button
                            key={t.business_type}
                            data-testid="wizard-biztype-option"
                            onClick={() => onSelect(t.business_type)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors group"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'var(--accent-muted)';
                              e.currentTarget.style.color = 'var(--accent-soft)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '';
                              e.currentTarget.style.color = 'var(--text-primary)';
                            }}
                          >
                            <span className="flex-1 text-left">{t.display_name}</span>
                            <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 border-t shrink-0 flex justify-start"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            onClick={onBack}
            className="text-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
        </div>
      </div>
    </div>
  );
}
