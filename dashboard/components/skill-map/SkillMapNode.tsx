import React from 'react'
import { Users, BookOpen, Cog, Link } from 'lucide-react'
import { CoverageStatusBadge } from '../ui/CoverageStatusBadge'
import type { SkillMapNode as NodeData, CoverageLevel } from './useSkillMapData'

interface SkillMapNodeProps {
  node: NodeData
  isHighlighted: boolean
  isSelected: boolean
  isBroken: boolean
  isLinkSource?: boolean
  isLinkTarget?: boolean
  isLinking?: boolean
  onClick: () => void
  onFixClick?: () => void
  onLinkStart?: () => void
}

const typeConfig = {
  employee: {
    icon: Users,
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-600 dark:text-green-400',
    label: 'Staff',
  },
  skill: {
    icon: BookOpen,
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-600 dark:text-purple-400',
    label: 'Skill',
  },
  resource: {
    icon: Cog,
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-600 dark:text-blue-400',
    label: 'Resource',
  },
}

function coverageToBadgeStatus(coverage: CoverageLevel): 'full' | 'partial' | 'uncovered' {
  return coverage
}

export default function SkillMapNode({
  node, isHighlighted, isSelected, isBroken,
  isLinkSource, isLinkTarget, isLinking,
  onClick, onFixClick, onLinkStart,
}: SkillMapNodeProps) {
  const config = typeConfig[node.type]
  const Icon = config.icon

  const dimmed = isLinking
    ? (!isLinkSource && !isLinkTarget ? 'opacity-30' : '')
    : (!isHighlighted && !isSelected ? 'opacity-40' : '')
  const selectedRing = isSelected ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''
  const linkSourceRing = isLinkSource ? 'ring-2 ring-emerald-500 dark:ring-emerald-400' : ''
  const linkTargetStyle = isLinkTarget
    ? 'ring-2 ring-dashed ring-emerald-400 dark:ring-emerald-500 animate-pulse cursor-crosshair'
    : ''
  const brokenBorder = isBroken ? 'border-amber-400 dark:border-amber-500' : 'border-gray-200 dark:border-gray-800'

  return (
    <div
      data-node-id={node.id}
      data-testid={`node-${node.id}`}
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all duration-200
        bg-white dark:bg-[#1a1a1a] hover:shadow-md
        ${brokenBorder} ${selectedRing} ${linkSourceRing} ${linkTargetStyle} ${dimmed}`}
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
        </div>
      </div>
      {!isLinking && onLinkStart && (
        <button
          onClick={e => { e.stopPropagation(); onLinkStart() }}
          title="Connect to another node"
          className="text-gray-400 hover:text-emerald-500 transition-colors shrink-0 p-0.5"
        >
          <Link className="w-3.5 h-3.5" />
        </button>
      )}
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
