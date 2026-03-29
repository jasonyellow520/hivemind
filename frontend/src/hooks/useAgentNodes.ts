import { useMemo, useCallback } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { useMindStore } from '../store/useMindStore'
import type { AgentState } from '../types/mind.types'

const QUEEN_ID = 'queen-node'

const EDGE_COLORS: Record<string, string> = {
  idle: 'rgba(75,85,99,0.3)',
  planning: 'rgba(59,130,246,0.4)',
  running: 'rgba(212,146,11,0.5)',
  waiting_hitl: 'rgba(245,185,66,0.5)',
  completed: 'rgba(76,175,80,0.45)',
  error: 'rgba(244,63,94,0.45)',
}

// Flat-top hex axial → pixel center
const HEX_SIZE = 100
const HEX_W = 200
const HEX_H = 174

function axialToPixel(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * (3 / 2) * q,
    y: HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r),
  }
}

// Flat-top hex spiral enumeration
function hexSpiral(maxRings: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [[0, 0]]
  const dirs: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
  for (let ring = 1; ring <= maxRings; ring++) {
    let q = 0, r = -ring
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        cells.push([q, r])
        q += dirs[side][0]
        r += dirs[side][1]
      }
    }
  }
  return cells
}

function getDomain(url: string): string {
  try { return new URL(url).hostname }
  catch { return url }
}

function prettifyDomain(d: string): string {
  const sld = d.replace('www.', '').split('.')[0]
  return sld.charAt(0).toUpperCase() + sld.slice(1)
}

export function useAgentNodes(clusterLabels: Record<string, string> = {}) {
  const agents = useMindStore((s) => s.agents)
  const task = useMindStore((s) => s.task)
  const tabs = useMindStore((s) => s.tabs)
  const selectedTabId = useMindStore((s) => s.selectedTabId)
  const setSelectedTab = useMindStore((s) => s.setSelectedTab)

  const handleTabActivate = useCallback((tabId: string) => {
    fetch(`/api/v1/tabs/${tabId}/activate`, { method: 'POST' }).catch(() => {})
    const tab = tabs.find((t) => t.tabId === tabId)
    if (tab?.url && tab.url !== 'about:blank') {
      window.open(tab.url, '_blank')
    }
  }, [tabs])

  return useMemo(() => {
    const agentList = Object.values(agents)
    const agentCount = agentList.length

    const PROTECTED_HOSTS = [
      'localhost:5173', 'localhost:5174', 'localhost:3000',
      'localhost:8080', 'localhost:8081',
      '127.0.0.1:5173', '127.0.0.1:5174',
      '127.0.0.1:3000', '127.0.0.1:8080', '127.0.0.1:8081',
    ]
    const safeTabs = tabs.filter(
      (t) => !PROTECTED_HOSTS.some((h) => (t.url || '').includes(h))
    )

    const nodes: Node[] = []
    const edges: Edge[] = []

    // --- Queen at hex grid origin ---
    const queenPx = axialToPixel(0, 0)
    const QUEEN_SIZE = 90
    nodes.push({
      id: QUEEN_ID,
      type: 'queenNode',
      position: { x: queenPx.x - QUEEN_SIZE, y: queenPx.y - QUEEN_SIZE },
      data: {
        label: 'Mind',
        task: task.masterTask || 'Awaiting task...',
        status: task.status,
        subtaskCount: task.subtaskCount,
      },
      draggable: true,
    })

    // --- Domain-clustered tab ordering ---
    const byDomain = new Map<string, typeof tabs>()
    for (const tab of safeTabs) {
      const domain = getDomain(tab.url)
      const group = byDomain.get(domain) ?? []
      group.push(tab)
      byDomain.set(domain, group)
    }
    const orderedTabs = [...byDomain.values()]
      .sort((a, b) => b.length - a.length)
      .flat()

    const tabCount = orderedTabs.length
    const domainCount = byDomain.size
    const gapCells = Math.max(0, domainCount - 1)
    const totalCells = tabCount + gapCells
    const RINGS = Math.ceil(Math.sqrt(totalCells / 6)) + 2
    const spiralCells = hexSpiral(RINGS)

    // Track pixel positions per domain for centroid label computation
    const domainPositions = new Map<string, { x: number; y: number }[]>()

    let cellIndex = 1
    let prevDomain = ''

    for (const tab of orderedTabs) {
      const domain = getDomain(tab.url)

      // Insert a gap (skip one spiral cell) when the domain changes
      if (prevDomain && domain !== prevDomain) cellIndex++
      prevDomain = domain

      if (cellIndex >= spiralCells.length) break;

      const [q, r] = spiralCells[cellIndex]
      const { x, y } = axialToPixel(q, r)

      // Track for centroid labels
      const dps = domainPositions.get(domain) ?? []
      dps.push({ x, y })
      domainPositions.set(domain, dps)

      const isSelected = selectedTabId === tab.tabId
      const hasAgent = !!tab.assignedAgentId
      const hasInstruction = !!tab.instruction?.trim()

      const dimmed = !!selectedTabId && !isSelected

      nodes.push({
        id: `tab-${tab.tabId}`,
        type: 'tabNode',
        position: { x: x - HEX_W / 2, y: y - HEX_H / 2 },
        draggable: !isSelected,
        zIndex: isSelected ? 100 : 1,
        data: {
          tabId: tab.tabId,
          title: tab.title,
          url: tab.url,
          instruction: tab.instruction,
          assignedAgentId: tab.assignedAgentId,
          isSelected,
          dimmed,
          onSelect: setSelectedTab,
          onActivate: handleTabActivate,
        },
      })

      if (hasInstruction || hasAgent) {
        const agent = hasAgent
          ? agentList.find((a) => a.agentId === tab.assignedAgentId)
          : null
        const agentStatus = agent?.status || (hasAgent ? 'running' : 'idle')
        const edgeColor = EDGE_COLORS[agentStatus] || 'rgba(212,146,11,0.4)'
        const isAnimated = agentStatus === 'running' || agentStatus === 'planning'

        edges.push({
          id: `edge-mind-tab-${tab.tabId}`,
          source: QUEEN_ID,
          target: `tab-${tab.tabId}`,
          animated: isAnimated,
          style: {
            stroke: edgeColor,
            strokeWidth: isAnimated ? 2.5 : 1.5,
            filter: isAnimated ? `drop-shadow(0 0 6px ${edgeColor})` : undefined,
          },
          type: 'smoothstep',
        })
      }

      cellIndex++
    }

    // --- Cluster centroid label nodes (for domains with ≥2 tabs) ---
    domainPositions.forEach((positions, domain) => {
      if (positions.length < 2) return
      const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length
      const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length
      const label = clusterLabels[domain] || prettifyDomain(domain)
      nodes.push({
        id: `cluster-${domain}`,
        type: 'clusterLabelNode',
        position: { x: cx - 55, y: cy - 40 },
        data: { domain, label, count: positions.length },
        draggable: false,
        selectable: false,
        zIndex: 0,
      })
    })

    // --- Worker agent nodes (clustered by task_id) ---
    const AGENT_W = 60
    const AGENT_H = 70

    // Filter out stale agents: completed/failed agents whose tab no longer exists
    const tabIdSet = new Set(safeTabs.map((t) => t.tabId))
    const activeStatuses = new Set(['running', 'planning', 'waiting_hitl'])
    const liveAgents = agentList.filter((agent) => {
      if (activeStatuses.has(agent.status)) return true
      if (!agent.tabId) return true // no tab assigned, still show (e.g. decomposing)
      return tabIdSet.has(agent.tabId)
    })

    // Group agents by taskId
    const taskGroups = new Map<string, AgentState[]>()
    for (const agent of liveAgents) {
      const tid = agent.taskId || 'unassigned'
      const group = taskGroups.get(tid) ?? []
      group.push(agent)
      taskGroups.set(tid, group)
    }

    // Sort task groups by their tabs' domains for adjacency of similar tasks
    const taskIds = [...taskGroups.keys()].sort((a, b) => {
      const aTabs = taskGroups.get(a)?.map(ag => ag.tabId).filter(Boolean) ?? []
      const bTabs = taskGroups.get(b)?.map(ag => ag.tabId).filter(Boolean) ?? []
      const aDomain = aTabs.length > 0
        ? getDomain(tabs.find(t => t.tabId === aTabs[0])?.url || '')
        : ''
      const bDomain = bTabs.length > 0
        ? getDomain(tabs.find(t => t.tabId === bTabs[0])?.url || '')
        : ''
      return aDomain.localeCompare(bDomain)
    })

    const sectorSize = (2 * Math.PI) / Math.max(taskIds.length, 1)
    const AGENT_RADIUS = agentCount <= 3 ? 180 : agentCount <= 6 ? 210 : 250

    taskIds.forEach((taskId, taskIndex) => {
      const sectorStart = sectorSize * taskIndex - Math.PI / 2
      const workers = taskGroups.get(taskId)!

      workers.forEach((agent: AgentState, i: number) => {
        const angle = sectorStart + (sectorSize / (workers.length + 1)) * (i + 1)
        const x = queenPx.x + AGENT_RADIUS * Math.cos(angle) - AGENT_W
        const y = queenPx.y + AGENT_RADIUS * Math.sin(angle) - AGENT_H

        nodes.push({
          id: agent.agentId,
          type: 'workerNode',
          position: { x, y },
          data: {
            ...agent,
            label: `Agent ${agent.globalIndex || agent.subtaskIndex + 1}`,
          },
          draggable: true,
        })

        const isAnimated = agent.status === 'running' || agent.status === 'planning'
        const edgeColor = EDGE_COLORS[agent.status] || 'rgba(212,146,11,0.2)'

        edges.push({
          id: `edge-${QUEEN_ID}-${agent.agentId}`,
          source: QUEEN_ID,
          target: agent.agentId,
          animated: isAnimated,
          style: {
            stroke: edgeColor,
            strokeWidth: isAnimated ? 2 : 1.5,
            filter: isAnimated ? `drop-shadow(0 0 4px ${edgeColor})` : undefined,
          },
          type: 'smoothstep',
        })

        if (agent.tabId && tabs.find((t) => t.tabId === agent.tabId)) {
          edges.push({
            id: `edge-agent-tab-${agent.agentId}`,
            source: agent.agentId,
            target: `tab-${agent.tabId}`,
            animated: agent.status === 'running',
            style: {
              stroke: EDGE_COLORS[agent.status] || 'rgba(212,146,11,0.3)',
              strokeWidth: 1.5,
              strokeDasharray: '5 3',
            },
            type: 'smoothstep',
          })
        }
      })
    })

    return { nodes, edges }
  }, [agents, task, tabs, selectedTabId, setSelectedTab, handleTabActivate, clusterLabels])
}
