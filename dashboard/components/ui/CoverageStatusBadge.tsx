import React from 'react';
import { Badge } from './Badge';

type CoverageStatus = 'full' | 'partial' | 'uncovered' | 'no_staff' | 'no_resource';

interface CoverageStatusBadgeProps {
  status: CoverageStatus;
  className?: string;
}

// Neutral factual labels — no pass/fail color semantics.
// Product rule: show state data, don't grade the business.
// 2026-05-28 UX audit #9, DESIGN_HANDOFF.md:284.
const statusConfig: Record<
  CoverageStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }
> = {
  full: { label: 'Assigned', variant: 'secondary' },
  partial: { label: 'Partly assigned', variant: 'secondary' },
  uncovered: { label: 'Not yet assigned', variant: 'secondary' },
  no_staff: { label: 'No staff assigned', variant: 'secondary' },
  no_resource: { label: 'No resource assigned', variant: 'secondary' },
};

export const CoverageStatusBadge: React.FC<CoverageStatusBadgeProps> = ({ status, className }) => {
  const config = statusConfig[status] ?? statusConfig.uncovered;
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
};
