'use client';

/**
 * "AI Usage — this month" card showing per-model token/audio/TTS breakdown
 * and total estimated cost. Extracted from AnalyticsView.tsx.
 */

import React from 'react';
import { ListChecks } from 'lucide-react';
import type { AiCostSummary } from '../../lib/types';

export function AiUsageCard({ aiCost }: { aiCost: AiCostSummary | null }) {
  return (
    <div
      className="mt-6 p-4 rounded-xl"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-soft)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <ListChecks className="w-4 h-4" style={{ color: 'var(--accent-soft)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          AI Usage — this month (estimated)
        </span>
      </div>
      {aiCost && aiCost.breakdown.length > 0 ? (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ color: 'var(--text-primary)' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-2 pr-4">Provider / Model</th>
                  <th className="text-left pb-2 pr-4">Source</th>
                  <th className="text-right pb-2 pr-4">Input tokens</th>
                  <th className="text-right pb-2 pr-4">Output tokens</th>
                  <th className="text-right pb-2 pr-4">STT audio</th>
                  <th className="text-right pb-2 pr-4">TTS chars</th>
                  <th className="text-right pb-2">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {aiCost.breakdown.map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-1 pr-4 font-mono">
                      {row.provider}/{row.model}
                    </td>
                    <td className="py-1 pr-4">{row.source.replace(/_/g, ' ')}</td>
                    <td className="py-1 pr-4 text-right">
                      {row.input_tokens.toLocaleString()}
                    </td>
                    <td className="py-1 pr-4 text-right">
                      {row.output_tokens.toLocaleString()}
                    </td>
                    <td className="py-1 pr-4 text-right">
                      {row.audio_duration_ms > 0
                        ? `${(row.audio_duration_ms / 60000).toFixed(1)} min`
                        : '—'}
                    </td>
                    <td className="py-1 pr-4 text-right">
                      {row.characters_count > 0 ? row.characters_count.toLocaleString() : '—'}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {row.estimated_cost_usd > 0
                        ? `$${row.estimated_cost_usd.toFixed(4)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-soft)' }}>
                  <td colSpan={6} className="pt-2 text-right font-semibold pr-4">
                    Total estimated
                  </td>
                  <td className="pt-2 text-right font-mono font-semibold">
                    ${aiCost.total_estimated_cost_usd.toFixed(4)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Rates: GPT-4o-mini $0.15/$0.60 per 1M tokens · Deepgram $0.0043/min · OpenAI TTS
            (chars tracked)
          </p>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No AI usage recorded this month yet. Costs appear after live calls complete.
        </p>
      )}
    </div>
  );
}
