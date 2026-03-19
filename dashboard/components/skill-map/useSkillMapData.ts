import { useMemo, useState, useCallback } from 'react'
import { Api } from '../../lib/api'

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

export type LinkingState = {
  fromNodeId: string
  fromType: NodeType
} | null

export function useSkillMapData(
  employees: any[],
  resources: any[],
  skills: any[],
  tenantId: string | null,
  onDataChanged?: () => void
) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [linking, setLinking] = useState<LinkingState>(null)
  const [saving, setSaving] = useState(false)

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
          isBroken: false,
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

    if (selectedNodeId.startsWith('emp-')) {
      for (const conn of connections) {
        if (conn.side === 'left' && conn.from === selectedNodeId) {
          highlighted.add(conn.to)
          for (const c2 of connections) {
            if (c2.side === 'right' && c2.from === conn.to) {
              highlighted.add(c2.to)
            }
          }
        }
      }
    } else if (selectedNodeId.startsWith('res-')) {
      for (const conn of connections) {
        if (conn.side === 'right' && conn.to === selectedNodeId) {
          highlighted.add(conn.from)
          for (const c2 of connections) {
            if (c2.side === 'left' && c2.to === conn.from) {
              highlighted.add(c2.from)
            }
          }
        }
      }
    } else if (selectedNodeId.startsWith('skill-')) {
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

  // --- Linking mode ---

  const validLinkTargets = useMemo(() => {
    if (!linking) return new Set<string>()
    const targets = new Set<string>()

    if (linking.fromType === 'employee') {
      // Employee can link to skills
      for (const sk of skillNodes) targets.add(sk.id)
    } else if (linking.fromType === 'resource') {
      // Resource can link to skills
      for (const sk of skillNodes) targets.add(sk.id)
    } else if (linking.fromType === 'skill') {
      // Skill can link to employees or resources
      for (const emp of employeeNodes) targets.add(emp.id)
      for (const res of resourceNodes) targets.add(res.id)
    }

    return targets
  }, [linking, skillNodes, employeeNodes, resourceNodes])

  const startLinking = useCallback((nodeId: string, nodeType: NodeType) => {
    setLinking({ fromNodeId: nodeId, fromType: nodeType })
    setSelectedNodeId(null)
  }, [])

  const cancelLinking = useCallback(() => {
    setLinking(null)
  }, [])

  const completeLinking = useCallback(async (targetNodeId: string) => {
    if (!linking || !tenantId || saving) return

    // Determine what connection to make
    let employeeNode: SkillMapNode | undefined
    let skillNode: SkillMapNode | undefined
    let resourceNode: SkillMapNode | undefined

    const fromNode = [...employeeNodes, ...skillNodes, ...resourceNodes].find(n => n.id === linking.fromNodeId)
    const toNode = [...employeeNodes, ...skillNodes, ...resourceNodes].find(n => n.id === targetNodeId)

    if (!fromNode || !toNode) return

    // Sort out which is which
    for (const n of [fromNode, toNode]) {
      if (n.type === 'employee') employeeNode = n
      if (n.type === 'skill') skillNode = n
      if (n.type === 'resource') resourceNode = n
    }

    if (!skillNode) return // Must involve a skill

    setSaving(true)
    try {
      if (employeeNode && skillNode) {
        // Add skill to employee
        const emp = employees.find((e: any) => `emp-${e.id}` === employeeNode!.id)
        if (!emp) return
        const currentSkills: string[] = Array.isArray(emp.skills) ? emp.skills : []
        if (currentSkills.includes(skillNode.name)) return // Already connected
        await Api.employees.update(emp.id, {
          tenant_id: tenantId,
          skills: [...currentSkills, skillNode.name],
        })
      } else if (resourceNode && skillNode) {
        // Add capability to resource
        const res = resources.find((r: any) => `res-${r.id}` === resourceNode!.id)
        if (!res) return
        const currentCaps: string[] = Array.isArray(res.capabilities) ? res.capabilities : []
        if (currentCaps.includes(skillNode.name)) return // Already connected
        await Api.resources.update(res.id, {
          capabilities: [...currentCaps, skillNode.name],
        }, tenantId)
      }
      onDataChanged?.()
    } catch (err) {
      console.error('Failed to create connection:', err)
    } finally {
      setSaving(false)
      setLinking(null)
    }
  }, [linking, tenantId, saving, employees, resources, employeeNodes, skillNodes, resourceNodes, onDataChanged])

  // --- Disconnect ---

  const disconnectConnection = useCallback(async (connectionId: string) => {
    if (!tenantId || saving) return

    const conn = connections.find(c => c.id === connectionId)
    if (!conn) return

    setSaving(true)
    try {
      if (conn.side === 'left') {
        // Employee -> Skill: remove skill from employee's skills array
        const empNode = employeeNodes.find(e => e.id === conn.from)
        if (!empNode) return
        const emp = employees.find((e: any) => `emp-${e.id}` === empNode.id)
        if (!emp) return
        const skillName = conn.to.replace('skill-', '')
        const newSkills = (emp.skills || []).filter((s: string) => s !== skillName)
        await Api.employees.update(emp.id, {
          tenant_id: tenantId,
          skills: newSkills,
        })
      } else {
        // Skill -> Resource: remove capability from resource's capabilities array
        const resNode = resourceNodes.find(r => r.id === conn.to)
        if (!resNode) return
        const res = resources.find((r: any) => `res-${r.id}` === resNode.id)
        if (!res) return
        const capName = conn.from.replace('skill-', '')
        const newCaps = (res.capabilities || []).filter((c: string) => c !== capName)
        await Api.resources.update(res.id, {
          capabilities: newCaps,
        }, tenantId)
      }
      onDataChanged?.()
    } catch (err) {
      console.error('Failed to disconnect:', err)
    } finally {
      setSaving(false)
    }
  }, [tenantId, saving, connections, employeeNodes, resourceNodes, employees, resources, onDataChanged])

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
    // Linking
    linking,
    validLinkTargets,
    startLinking,
    cancelLinking,
    completeLinking,
    // Disconnect
    disconnectConnection,
    saving,
  }
}
