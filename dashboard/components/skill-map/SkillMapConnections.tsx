import React, { useLayoutEffect, useState, useCallback, useRef } from 'react'
import type { Connection } from './useSkillMapData'

interface SkillMapConnectionsProps {
  connections: Connection[]
  highlightedConnectionIds: Set<string>
  hasSelection: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
}

interface PathData {
  id: string
  d: string
  isHighlighted: boolean
  isBroken: boolean
}

export default function SkillMapConnections({ connections, highlightedConnectionIds, hasSelection, containerRef }: SkillMapConnectionsProps) {
  const [paths, setPaths] = useState<PathData[]>([])
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  const computePaths = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    setDimensions({ width: containerRect.width, height: containerRect.height })

    const newPaths: PathData[] = []

    for (const conn of connections) {
      const fromEl = container.querySelector(`[data-node-id="${conn.from}"]`)
      const toEl = container.querySelector(`[data-node-id="${conn.to}"]`)
      if (!fromEl || !toEl) continue

      const fromRect = fromEl.getBoundingClientRect()
      const toRect = toEl.getBoundingClientRect()

      // Anchors: right edge of "from", left edge of "to" for left-side connections
      // Right edge of "from", left edge of "to" for right-side connections
      let x1: number, y1: number, x2: number, y2: number

      if (conn.side === 'left') {
        // Employee (right edge) -> Skill (left edge)
        x1 = fromRect.right - containerRect.left
        y1 = fromRect.top + fromRect.height / 2 - containerRect.top
        x2 = toRect.left - containerRect.left
        y2 = toRect.top + toRect.height / 2 - containerRect.top
      } else {
        // Skill (right edge) -> Resource (left edge)
        x1 = fromRect.right - containerRect.left
        y1 = fromRect.top + fromRect.height / 2 - containerRect.top
        x2 = toRect.left - containerRect.left
        y2 = toRect.top + toRect.height / 2 - containerRect.top
      }

      // Cubic bezier control points at ~40% of horizontal gap
      const dx = Math.abs(x2 - x1) * 0.4
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`

      newPaths.push({
        id: conn.id,
        d,
        isHighlighted: highlightedConnectionIds.has(conn.id),
        isBroken: conn.isBroken,
      })
    }

    setPaths(newPaths)
  }, [connections, highlightedConnectionIds, containerRef])

  useLayoutEffect(() => {
    // Compute on mount and after paint
    const timer = requestAnimationFrame(computePaths)
    return () => cancelAnimationFrame(timer)
  }, [computePaths])

  // Observe container resize
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      computePaths()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [computePaths, containerRef])

  return (
    <svg
      ref={svgRef}
      data-testid="skill-map-svg"
      className="absolute inset-0 pointer-events-none z-10"
      width={dimensions.width}
      height={dimensions.height}
      style={{ overflow: 'visible' }}
    >
      <style>{`
        @keyframes drawLine {
          from { stroke-dashoffset: 1000; }
          to { stroke-dashoffset: 0; }
        }
        .skill-map-line {
          animation: drawLine 0.8s ease-out forwards;
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
        }
      `}</style>
      {paths.map(path => {
        const isActive = !hasSelection || path.isHighlighted
        return (
          <path
            key={path.id}
            data-testid={`path-${path.id}`}
            d={path.d}
            fill="none"
            className="skill-map-line"
            stroke={
              path.isBroken
                ? '#f59e0b'
                : path.isHighlighted
                  ? '#3b82f6'
                  : '#93c5fd'
            }
            strokeWidth={path.isHighlighted ? 2.5 : 1.5}
            strokeOpacity={isActive ? (path.isHighlighted ? 1 : 0.4) : 0.1}
            strokeDasharray={path.isBroken ? '4 4' : undefined}
            style={path.isBroken ? { animation: 'none', strokeDashoffset: 0 } : undefined}
          />
        )
      })}
    </svg>
  )
}
