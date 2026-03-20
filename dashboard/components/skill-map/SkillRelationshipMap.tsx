'use client'

import React, { useRef, useState } from 'react'
import { Users, BookOpen, Cog, GitBranch, X } from 'lucide-react'
import { useSession, useStaticData } from '../../lib/hooks'
import { useVocabulary } from '@/lib/VocabularyContext'
import { useSkillMapData } from './useSkillMapData'
import SkillMapColumn from './SkillMapColumn'
import SkillMapNode from './SkillMapNode'
import SkillMapConnections from './SkillMapConnections'
import SkillMapFixPanel from './SkillMapFixPanel'
import type { BrokenChain } from './useSkillMapData'

export default function SkillRelationshipMap({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId)
  const { employees, resources, services, loading, refresh } = useStaticData(tenantId)
  const vocab = useVocabulary()
  const {
    employeeNodes,
    skillNodes,
    resourceNodes,
    connections,
    brokenChains,
    selectedNodeId,
    highlightedNodeIds,
    highlightedConnectionIds,
    selectNode,
    linking,
    validLinkTargets,
    startLinking,
    cancelLinking,
    completeLinking,
    disconnectConnection,
    saving,
    empMappings,
    resMappings,
  } = useSkillMapData(employees, resources, services, tenantId, refresh)

  const containerRef = useRef<HTMLDivElement>(null)
  const [fixingChain, setFixingChain] = useState<BrokenChain | null>(null)

  const hasSelection = selectedNodeId !== null

  function handleFixClick(chain: BrokenChain) {
    setFixingChain(prev => prev?.skillId === chain.skillId ? null : chain)
  }

  function handleFixed() {
    setFixingChain(null)
    refresh()
  }

  function handleNodeClick(nodeId: string) {
    if (linking) {
      if (nodeId === linking.fromNodeId) {
        cancelLinking()
      } else if (validLinkTargets.has(nodeId)) {
        completeLinking(nodeId)
      }
    } else {
      selectNode(nodeId)
    }
  }

  if (loading && employeeNodes.length === 0 && skillNodes.length === 0 && resourceNodes.length === 0) {
    return <div className="p-8 text-gray-500 italic">Loading skill map...</div>
  }

  const brokenSet = new Set(brokenChains.map(b => b.skillId))
  const fullCount = skillNodes.filter(s => s.coverage === 'full').length
  const partialCount = skillNodes.filter(s => s.coverage === 'partial').length
  const uncoveredCount = skillNodes.filter(s => s.coverage === 'uncovered').length

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-hidden text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-6 shrink-0">
        <div className="flex items-center mb-2">
          <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg mr-4 text-purple-600 dark:text-purple-400">
            <GitBranch className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Skill Relationship Map</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Click the link icon on any node to connect it. Click a line to disconnect.
            </p>
          </div>
        </div>
      </header>

      {/* Linking mode banner */}
      {linking && (
        <div className="mb-4 shrink-0 flex items-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Click a <span className="font-bold">
              {linking.fromType === 'skill' ? 'staff member or resource' : 'skill'}
            </span> to connect
          </span>
          <button
            onClick={cancelLinking}
            className="ml-auto text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          {saving && <span className="text-xs text-emerald-500 italic">Saving...</span>}
        </div>
      )}

      {/* Fix panel */}
      {fixingChain && (
        <div className="mb-4 shrink-0">
          <SkillMapFixPanel
            chain={fixingChain}
            employees={employees}
            resources={resources}
            tenantId={tenantId}
            empMappings={empMappings}
            resMappings={resMappings}
            onFixed={handleFixed}
            onClose={() => setFixingChain(null)}
          />
        </div>
      )}

      {/* 3-column map */}
      <div ref={containerRef} className="flex-1 overflow-auto relative" data-testid="skill-map-container">
        <div className="flex gap-8 min-h-full p-2">
          <SkillMapColumn
            title={vocab.employee_plural}
            icon={Users}
            iconColor="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
            count={employeeNodes.length}
          >
            {employeeNodes.map(node => (
              <SkillMapNode
                key={node.id}
                node={node}
                isHighlighted={!hasSelection || highlightedNodeIds.has(node.id)}
                isSelected={selectedNodeId === node.id}
                isBroken={false}
                isLinking={!!linking}
                isLinkSource={linking?.fromNodeId === node.id}
                isLinkTarget={!!linking && validLinkTargets.has(node.id)}
                onClick={() => handleNodeClick(node.id)}
                onLinkStart={() => startLinking(node.id, 'employee')}
              />
            ))}
          </SkillMapColumn>

          <SkillMapColumn
            title="Services"
            icon={BookOpen}
            iconColor="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
            count={skillNodes.length}
          >
            {skillNodes.map(node => {
              const isBroken = brokenSet.has(node.id)
              const chain = brokenChains.find(b => b.skillId === node.id)
              return (
                <SkillMapNode
                  key={node.id}
                  node={node}
                  isHighlighted={!hasSelection || highlightedNodeIds.has(node.id)}
                  isSelected={selectedNodeId === node.id}
                  isBroken={isBroken}
                  isLinking={!!linking}
                  isLinkSource={linking?.fromNodeId === node.id}
                  isLinkTarget={!!linking && validLinkTargets.has(node.id)}
                  onClick={() => handleNodeClick(node.id)}
                  onLinkStart={() => startLinking(node.id, 'skill')}
                  onFixClick={isBroken && chain ? () => handleFixClick(chain) : undefined}
                />
              )
            })}
          </SkillMapColumn>

          <SkillMapColumn
            title={vocab.resource_plural}
            icon={Cog}
            iconColor="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            count={resourceNodes.length}
          >
            {resourceNodes.map(node => (
              <SkillMapNode
                key={node.id}
                node={node}
                isHighlighted={!hasSelection || highlightedNodeIds.has(node.id)}
                isSelected={selectedNodeId === node.id}
                isBroken={false}
                isLinking={!!linking}
                isLinkSource={linking?.fromNodeId === node.id}
                isLinkTarget={!!linking && validLinkTargets.has(node.id)}
                onClick={() => handleNodeClick(node.id)}
                onLinkStart={() => startLinking(node.id, 'resource')}
              />
            ))}
          </SkillMapColumn>
        </div>

        <SkillMapConnections
          connections={connections}
          highlightedConnectionIds={highlightedConnectionIds}
          hasSelection={hasSelection}
          containerRef={containerRef}
          onDisconnect={disconnectConnection}
        />
      </div>

      {/* Footer legend + stats */}
      <footer className="mt-4 flex items-center justify-between text-xs text-gray-400 font-medium shrink-0 px-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <div className="w-6 h-0.5 bg-blue-400 mr-2 rounded" /> Connected
          </div>
          <div className="flex items-center">
            <div className="w-6 h-0.5 bg-amber-400 mr-2 rounded border-dashed" style={{ borderTop: '2px dashed #f59e0b', height: 0, background: 'none' }} /> Broken chain
          </div>
          <div className="flex items-center">
            <div className="w-6 h-0.5 bg-red-400 mr-2 rounded" /> Hover to disconnect
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-green-500 font-bold">{fullCount} full</span>
          <span className="text-amber-500 font-bold">{partialCount} partial</span>
          <span className="text-red-500 font-bold">{uncoveredCount} uncovered</span>
        </div>
      </footer>
    </div>
  )
}
