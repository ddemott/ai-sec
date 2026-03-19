import React from 'react'
import { Users, Award, Wrench, AlertTriangle } from 'lucide-react'
import { CoverageStatusBadge } from '../ui/CoverageStatusBadge'
import type { SkillMapNode as NodeData, CoverageLevel } from './useSkillMapData'

interface SkillMapNodeProps {
  node: NodeData
  isHighlighted: boolean
  isSelected: boolean
  isBroken: boolean
  onClick: () => void
  onFixClick?: () => void
}

const typeConfig = {
  employee: {
    icon: Users,
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-600 dark:text-green-400',
    label: 'Staff',
  },
  skill: {
    icon: Award,
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-600 dark:text-purple-400',
    label: 'Skill',
  },
  resource: {
    icon: Wrench,
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-600 dark:text-blue-400',
    label: 'Resource',
  },
}

function coverageToBadgeStatus(coverage: CoverageLevel): 'full' | 'partial' | 'uncovered' {
  return coverage
}

export default function SkillMapNode({ node, isHighlighted, isSelected, isBroken, onClick, onFixClick }: SkillMapNodeProps) {
  const config = typeConfig[node.type]
  const Icon = config.icon

  const dimmed = !isHighlighted && !isSelected ? 'opacity-40' : ''
  const selectedRing = isSelected ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''
  const brokenBorder = isBroken ? 'border-amber-400 dark:border-amber-500' : 'border-gray-200 dark:border-gray-800'

  return (
    <div
      data-node-id={node.id}
      data-testid={`node-${node.id}`}
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all duration-200
        bg-white dark:bg-[#1a1a1a] hover:shadow-md
        ${brokenBorder} ${selectedRing} ${dimmed}`}
    >
      <div className={`p-1.5 rounded-lg shrink-0 ${config.bgColor} ${config.textColor}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{node.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {node.type === 'skill' && node.coverage && (
            <CoverageStatusBadge status={coverageToBadgeStatus(node.coverage)} />
          )}
          {node.isSynthetic && (
            <span className="text-[9px] text-amber-500 font-medium flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> Not in master list
            </span>
          )}
        </div>
      </div>
      {isBroken && node.type === 'skill' && onFixClick && (
        <button
          data-testid={`fix-${node.id}`}
          onClick={e => { e.stopPropagation(); onFixClick() }}
          className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20
            border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors shrink-0"
        >
          Fix
        </button>
      )}
      {isBroken && (
        <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" data-testid={`broken-dot-${node.id}`} />
      )}
    </div>
  )
}
