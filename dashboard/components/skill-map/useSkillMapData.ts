import { useMemo, useState, useCallback } from 'react'

export type NodeType = 'employee' | 'skill' | 'resource'
export type CoverageLevel = 'full' | 'partial' | 'uncovered'

export interface SkillMapNode {
  id: string
  type: NodeType
  name: string
  rawId: number | string
  skills?: string[]
  capabilities?: string[]
  coverage?: CoverageLevel
  isSynthetic?: boolean
}

export interface Connection {
  id: string
  from: string
  to: string
  side: 'left' | 'right'
  isBroken: boolean
}

export interface BrokenChain {
  skillId: string
  skillName: string
  missingEmployees: boolean
  missingResources: boolean
}

export function useSkillMapData(
  employees: any[],
  resources: any[],
  skills: any[]
) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const { employeeNodes, skillNodes, resourceNodes, connections, coverageBySkill, brokenChains } = useMemo(() => {
    // Build employee nodes (filter out user-type)
    const empNodes: SkillMapNode[] = (employees || [])
      .filter(e => e.type !== 'user')
      .map(e => ({
        id: `emp-${e.id}`,
        type: 'employee' as NodeType,
        name: e.name,
        rawId: e.id,
        skills: Array.isArray(e.skills) ? e.skills : [],
      }))

    // Build resource nodes
    const resNodes: SkillMapNode[] = (resources || []).map(r => ({
      id: `res-${r.id}`,
      type: 'resource' as NodeType,
      name: r.name,
      rawId: r.id,
      capabilities: Array.isArray(r.capabilities) ? r.capabilities : [],
    }))

    // Collect all skill names from master list + employee skills + resource capabilities
    const masterSkillNames = new Set((skills || []).map((s: any) => s.name))
    const allSkillNames = new Set(masterSkillNames)

    for (const e of empNodes) {
      for (const s of e.skills || []) allSkillNames.add(s)
    }
    for (const r of resNodes) {
      for (const c of r.capabilities || []) allSkillNames.add(c)
    }

    // Build skill nodes
    const skNodes: SkillMapNode[] = Array.from(allSkillNames).sort().map(name => ({
      id: `skill-${name}`,
      type: 'skill' as NodeType,
      name,
      rawId: name,
      isSynthetic: !masterSkillNames.has(name),
    }))

    // Build connections
    const conns: Connection[] = []

    // Left side: employee -> skill
    for (const emp of empNodes) {
      for (const skillName of emp.skills || []) {
        conns.push({
          id: `${emp.id}--skill-${skillName}`,
          from: emp.id,
          to: `skill-${skillName}`,
          side: 'left',
          isBroken: false, // updated below
        })
      }
    }

    // Right side: skill -> resource
    for (const res of resNodes) {
      for (const cap of res.capabilities || []) {
        conns.push({
          id: `skill-${cap}--${res.id}`,
          from: `skill-${cap}`,
          to: res.id,
          side: 'right',
          isBroken: false,
        })
      }
    }

    // Compute coverage per skill
    const coverage: Record<string, CoverageLevel> = {}
    const broken: BrokenChain[] = []

    for (const sk of skNodes) {
      const hasEmployees = conns.some(c => c.side === 'left' && c.to === sk.id)
      const hasResources = conns.some(c => c.side === 'right' && c.from === sk.id)

      if (hasEmployees && hasResources) {
        coverage[sk.id] = 'full'
      } else if (hasEmployees || hasResources) {
        coverage[sk.id] = 'partial'
        broken.push({
          skillId: sk.id,
          skillName: sk.name,
          missingEmployees: !hasEmployees,
          missingResources: !hasResources,
        })
      } else {
        coverage[sk.id] = 'uncovered'
        broken.push({
          skillId: sk.id,
          skillName: sk.name,
          missingEmployees: true,
          missingResources: true,
        })
      }

      sk.coverage = coverage[sk.id]
    }

    // Mark broken connections
    for (const chain of broken) {
      for (const conn of conns) {
        if (
          (conn.side === 'left' && conn.to === chain.skillId && chain.missingResources) ||
          (conn.side === 'right' && conn.from === chain.skillId && chain.missingEmployees)
        ) {
          conn.isBroken = true
        }
      }
    }

    return {
      employeeNodes: empNodes,
      skillNodes: skNodes,
      resourceNodes: resNodes,
      connections: conns,
      coverageBySkill: coverage,
      brokenChains: broken,
    }
  }, [employees, resources, skills])

  // Compute highlighted node IDs based on selection
  const highlightedNodeIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>()

    const highlighted = new Set<string>([selectedNodeId])

    // Find all connected nodes transitively through skills
    if (selectedNodeId.startsWith('emp-')) {
      // Employee selected -> highlight connected skills -> highlight resources connected to those skills
      for (const conn of connections) {
        if (conn.side === 'left' && conn.from === selectedNodeId) {
          highlighted.add(conn.to) // skill
          for (const c2 of connections) {
            if (c2.side === 'right' && c2.from === conn.to) {
              highlighted.add(c2.to) // resource
            }
          }
        }
      }
    } else if (selectedNodeId.startsWith('res-')) {
      // Resource selected -> highlight connected skills -> highlight employees connected to those skills
      for (const conn of connections) {
        if (conn.side === 'right' && conn.to === selectedNodeId) {
          highlighted.add(conn.from) // skill
          for (const c2 of connections) {
            if (c2.side === 'left' && c2.to === conn.from) {
              highlighted.add(c2.from) // employee
            }
          }
        }
      }
    } else if (selectedNodeId.startsWith('skill-')) {
      // Skill selected -> highlight connected employees and resources
      for (const conn of connections) {
        if (conn.side === 'left' && conn.to === selectedNodeId) highlighted.add(conn.from)
        if (conn.side === 'right' && conn.from === selectedNodeId) highlighted.add(conn.to)
      }
    }

    return highlighted
  }, [selectedNodeId, connections])

  const highlightedConnectionIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>()

    const highlighted = new Set<string>()
    for (const conn of connections) {
      if (highlightedNodeIds.has(conn.from) && highlightedNodeIds.has(conn.to)) {
        highlighted.add(conn.id)
      }
    }
    return highlighted
  }, [selectedNodeId, connections, highlightedNodeIds])

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(prev => prev === nodeId ? null : nodeId)
  }, [])

  return {
    employeeNodes,
    skillNodes,
    resourceNodes,
    connections,
    coverageBySkill,
    brokenChains,
    selectedNodeId,
    highlightedNodeIds,
    highlightedConnectionIds,
    selectNode,
  }
}
