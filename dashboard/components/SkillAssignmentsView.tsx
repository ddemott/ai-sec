'use client';

import React, { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LayoutGrid, GitBranch } from 'lucide-react';
import SkillMatrixView from './SkillMatrixView';
import SkillRelationshipMap from './skill-map/SkillRelationshipMap';

/**
 * SkillAssignmentsView — single sub-tab that consolidates the former
 * "Service Assignments" (SkillMatrixView) and "Skill Map"
 * (SkillRelationshipMap) tabs into one surface with a Grid/Map view
 * toggle in the top-right (B1, 2026-05-17).
 *
 * Both views operate on the same underlying data (service_employee +
 * service_resource mappings) and answer the same operator question —
 * "who/what can do this service?" — just at different zoom levels:
 *   - Grid: row-per-staff/resource, column-per-service, check/X cells.
 *           Best for bulk editing.
 *   - Map: node-and-edge graph showing how employees → skills →
 *          services → resources connect. Best for spotting orphaned
 *          relationships and broken chains.
 *
 * Persistence: the active view is mirrored to `?view=grid|map` on the
 * URL so deep-links survive page reloads and tab switches. Stale
 * `?subtab=skill-map` bookmarks are remapped by MyTeamView to
 * `?subtab=skills&view=map`.
 */
type ViewMode = 'grid' | 'map';

export default function SkillAssignmentsView() {
  const searchParams = useSearchParams();
  const initialView: ViewMode = searchParams.get('view') === 'map' ? 'map' : 'grid';
  const [view, setView] = useState<ViewMode>(initialView);

  const handleViewChange = useCallback((next: ViewMode) => {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'map') {
      params.set('view', 'map');
    } else {
      // Default is grid — strip the param to keep URLs short.
      params.delete('view');
    }
    const qs = params.toString();
    window.history.replaceState(
      {},
      '',
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toggle bar — anchored top-right, themed against CSS vars so it
          reads as part of the chrome rather than the content body. */}
      <div
        className="px-4 py-2 border-b flex items-center justify-end gap-1"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
      >
        <span
          className="text-xs uppercase tracking-widest font-bold mr-2"
          style={{ color: 'var(--text-muted)' }}
        >
          View
        </span>
        <ToggleButton
          icon={LayoutGrid}
          label="Grid"
          isActive={view === 'grid'}
          onClick={() => handleViewChange('grid')}
        />
        <ToggleButton
          icon={GitBranch}
          label="Map"
          isActive={view === 'map'}
          onClick={() => handleViewChange('map')}
        />
      </div>

      <div className="flex-1 overflow-hidden">
        {view === 'grid' ? <SkillMatrixView /> : <SkillRelationshipMap />}
      </div>
    </div>
  );
}

interface ToggleButtonProps {
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function ToggleButton({ icon: Icon, label, isActive, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
      style={{
        backgroundColor: isActive ? 'var(--accent-muted)' : 'transparent',
        color: isActive ? 'var(--accent-soft)' : 'var(--text-secondary)',
        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-soft)'}`,
      }}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
