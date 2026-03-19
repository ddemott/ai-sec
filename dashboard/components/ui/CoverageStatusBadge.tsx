import React from 'react';
import { Badge } from './Badge';

type CoverageStatus = 'full' | 'partial' | 'uncovered' | 'no_staff' | 'no_resource';

interface CoverageStatusBadgeProps {
  status: CoverageStatus;
  className?: string;
}

const statusConfig: Record<CoverageStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
  full: { label: 'Full Coverage', variant: 'success' },
  partial: { label: 'Partial', variant: 'warning' },
  uncovered: { label: 'Uncovered', variant: 'danger' },
  no_staff: { label: 'No Staff', variant: 'danger' },
  no_resource: { label: 'No Resource', variant: 'danger' },
};

export const CoverageStatusBadge: React.FC<CoverageStatusBadgeProps> = ({ status, className }) => {
  const config = statusConfig[status] ?? statusConfig.uncovered;
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
};
