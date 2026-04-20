import React, { useLayoutEffect, useState, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import type { Connection } from './useSkillMapData'

interface SkillMapConnectionsProps {
  connections: Connection[]
  highlightedConnectionIds: Set<string>
  hasSelection: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  onDisconnect?: (connectionId: string) => void
}

interface PathData {
  id: string
  d: string
  midX: number
  midY: number
  isHighlighted: boolean
  isBroken: boolean
}

export default function SkillMapConnections({
  connections, highlightedConnectionIds, hasSelection, containerRef, onDisconnect,
}: SkillMapConnectionsProps) {
  const [paths, setPaths] = useState<PathData[]>([])
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [disconnectPopup, setDisconnectPopup] = useState<{ id: string; x: number; y: number } | null>(null)
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

      let x1: number, y1: number, x2: number, y2: number

      if (conn.side === 'left') {
        x1 = fromRect.right - containerRect.left
        y1 = fromRect.top + fromRect.height / 2 - containerRect.top
        x2 = toRect.left - containerRect.left
        y2 = toRect.top + toRect.height / 2 - containerRect.top
      } else {
        x1 = fromRect.right - containerRect.left
        y1 = fromRect.top + fromRect.height / 2 - containerRect.top
        x2 = toRect.left - containerRect.left
        y2 = toRect.top + toRect.height / 2 - containerRect.top
      }

      const dx = Math.abs(x2 - x1) * 0.4
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`

      // Midpoint for popup placement
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2

      newPaths.push({
        id: conn.id,
        d,
        midX,
        midY,
        isHighlighted: highlightedConnectionIds.has(conn.id),
        isBroken: conn.isBroken,
      })
    }

    setPaths(newPaths)
  }, [connections, highlightedConnectionIds, containerRef])

  useLayoutEffect(() => {
    const timer = requestAnimationFrame(computePaths)
    return () => cancelAnimationFrame(timer)
  }, [computePaths])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      computePaths()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [computePaths, containerRef])

  function handleLineClick(path: PathData, e: React.MouseEvent) {
    if (!onDisconnect) return
    e.stopPropagation()
    setDisconnectPopup(prev =>
      prev?.id === path.id ? null : { id: path.id, x: path.midX, y: path.midY }
    )
  }

  function handleDisconnect() {
    if (!disconnectPopup || !onDisconnect) return
    onDisconnect(disconnectPopup.id)
    setDisconnectPopup(null)
  }

  return (
    <>
      <svg
        ref={svgRef}
        data-testid="skill-map-svg"
        className="absolute inset-0 z-10"
        width={dimensions.width}
        height={dimensions.height}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <style>{`
          @keyframes drawLine {
            from { stroke-dashoffset: 1000; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
        {paths.map(path => {
          const isActive = !hasSelection || path.isHighlighted
          const isHovered = hoveredPath === path.id
          return (
            <g key={path.id}>
              {/* Invisible wide hit area for clicking */}
              {onDisconnect && (
                <path
                  d={path.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={(e) => handleLineClick(path, e)}
                  onMouseEnter={() => setHoveredPath(path.id)}
                  onMouseLeave={() => setHoveredPath(null)}
                />
              )}
              {/* Visible line */}
              <path
                data-testid={`path-${path.id}`}
                d={path.d}
                fill="none"
                stroke={
                  isHovered
                    ? '#ef4444'
                    : path.isBroken
                      ? '#fbbf24'
                      : path.isHighlighted
                        ? '#60a5fa'
                        : '#93c5fd'
                }
                strokeWidth={isHovered ? 3 : path.isHighlighted ? 2.5 : 2}
                strokeOpacity={isActive ? (path.isHighlighted || isHovered ? 1 : 0.7) : 0.15}
                style={{
                  strokeDasharray: path.isBroken ? '4 4' : '1000',
                  strokeDashoffset: 0,
                  animation: path.isBroken ? 'none' : 'drawLine 0.8s ease-out forwards',
                  pointerEvents: 'none',
                  transition: 'stroke 0.15s, stroke-width 0.15s',
                }}
              />
            </g>
          )
        })}
      </svg>

      {/* Disconnect popup */}
      {disconnectPopup && onDisconnect && (
        <>
          <div className="fixed inset-0 z-[19]" onClick={() => setDisconnectPopup(null)} />
          <div
            className="absolute z-20 flex items-center gap-1.5 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl px-3 py-2"
            style={{
              left: disconnectPopup.x - 50,
              top: disconnectPopup.y - 16,
            }}
          >
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400 hover:text-red-700 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </>
      )}
    </>
  )
}
