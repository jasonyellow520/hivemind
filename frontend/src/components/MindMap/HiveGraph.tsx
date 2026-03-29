import { useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion, AnimatePresence } from 'framer-motion'
import { useAgentNodes } from '../../hooks/useAgentNodes'
import { QueenNode } from './QueenNode'
import { WorkerNode } from './WorkerNode'
import { TabNode } from './TabNode'
import { ClusterLabelNode } from './ClusterLabelNode'
import { useMindStore } from '../../store/useMindStore'
import { Activity, Cpu, Wifi } from 'lucide-react'

const nodeTypes: NodeTypes = {
  queenNode: QueenNode as any,
  workerNode: WorkerNode as any,
  tabNode: TabNode as any,
  clusterLabelNode: ClusterLabelNode as any,
}

function MindGraphInner() {
  const [clusterLabels, setClusterLabels] = useState<Record<string, string>>({})
  const { nodes: graphNodes, edges: graphEdges } = useAgentNodes(clusterLabels)
  const [nodes, setNodes, onNodesChange] = useNodesState(graphNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphEdges)
  const agents = useMindStore((s) => s.agents)
  const task = useMindStore((s) => s.task)
  const tabs = useMindStore((s) => s.tabs)
  const selectedTabId = useMindStore((s) => s.selectedTabId)
  const setSelectedTab = useMindStore((s) => s.setSelectedTab)
  const setTabScreenshot = useMindStore((s) => s.setTabScreenshot)

  const { fitView } = useReactFlow()
  const prevNodeCountRef = useRef(0)

  useEffect(() => {
    setNodes(graphNodes)
    setEdges(graphEdges)
  }, [graphNodes, graphEdges, setNodes, setEdges])

  // Only fitView when node count actually changes
  useEffect(() => {
    const count = graphNodes.length
    if (count > 0 && count !== prevNodeCountRef.current) {
      prevNodeCountRef.current = count
      const timer = setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 150)
      return () => clearTimeout(timer)
    }
  }, [graphNodes.length, fitView])

  // Screenshot polling (sequential, 5s interval — only active Chrome tab succeeds)
  useEffect(() => {
    if (tabs.length === 0) return
    const validTabs = tabs.filter((t) => t.tabId != null && t.tabId !== '')
    if (validTabs.length === 0) return

    let cancelled = false
    const pollSequential = async () => {
      for (const tab of validTabs) {
        if (cancelled) break
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 3000)
          const res = await fetch(`/api/v1/tabs/${tab.tabId}/screenshot`, { signal: controller.signal })
          clearTimeout(timer)
          if (res.ok) {
            const d = await res.json()
            if (d.screenshot_b64) setTabScreenshot(tab.tabId, `data:image/jpeg;base64,${d.screenshot_b64}`)
          }
        } catch {}
      }
    }
    pollSequential()
    const id = setInterval(pollSequential, 10000)
    return () => { cancelled = true; clearInterval(id) }
  }, [tabs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch AI cluster labels for domains with ≥2 tabs
  useEffect(() => {
    const byDomain = new Map<string, typeof tabs[0][]>()
    for (const tab of tabs) {
      try {
        const domain = new URL(tab.url).hostname
        const group = byDomain.get(domain) ?? []
        group.push(tab)
        byDomain.set(domain, group)
      } catch {}
    }
    byDomain.forEach((group, domain) => {
      if (group.length < 2 || clusterLabels[domain]) return
      const titles = group.map((t) => t.title).filter(Boolean).slice(0, 5).join(', ')
      fetch('/api/v1/tabs/cluster-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, titles }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.label) setClusterLabels((prev) => ({ ...prev, [domain]: d.label }))
        })
        .catch(() => {})
    })
  }, [tabs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const agentList = Object.values(agents)
  const runningCount = agentList.filter((a) => a.status === 'running').length
  const hitlCount = agentList.filter((a) => a.status === 'waiting_hitl').length
  const completedCount = agentList.filter((a) => a.status === 'completed').length
  const isActive = task.status === 'running' || task.status === 'decomposing'

  const defaultEdgeOptions = {
    type: 'smoothstep',
    animated: false,
    style: { stroke: 'rgba(212,146,11,0.2)', strokeWidth: 1.5 },
  }

  return (
    <div className="w-full h-full relative neural-bg">
      <div
        className="absolute pointer-events-none"
        style={{
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '60%', height: '60%',
          background: 'radial-gradient(ellipse at center, rgba(212,146,11,0.04) 0%, rgba(200,168,78,0.03) 40%, transparent 70%)',
        }}
      />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.25, minZoom: 0.3, maxZoom: 1.2 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
        onPaneClick={() => { if (selectedTabId) setSelectedTab(null) }}
      >
        {/* Background dots removed — honeycomb SVG shows through from App.tsx */}
        <Controls
          showInteractive={false}
          className="!bottom-4 !left-4"
        />
      </ReactFlow>

      {/* Top-left status cluster */}
      <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-2">
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-cyan rounded-lg px-3 py-2 flex items-center gap-2.5"
        >
          <motion.div
            animate={isActive ? {
              boxShadow: ['0 0 0 0 rgba(212,146,11,0.4)', '0 0 0 6px rgba(212,146,11,0)', '0 0 0 0 rgba(212,146,11,0.4)']
            } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-2 h-2 rounded-full"
            style={{ background: isActive ? '#D4920B' : hitlCount > 0 ? '#f5b942' : tabs.length > 0 ? '#4CAF50' : '#6B5A2A' }}
          />
          <span className="terminal-text text-[10px] font-medium" style={{ color: isActive ? '#D4920B' : tabs.length > 0 ? '#4CAF50' : 'rgba(255,255,255,0.4)' }}>
            {isActive ? 'NEURAL ACTIVE' : hitlCount > 0 ? 'AWAITING INPUT' : tabs.length > 0 ? `${tabs.length} TABS SYNCED` : 'STANDBY'}
          </span>
        </motion.div>

        <AnimatePresence>
          {agentList.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex flex-col gap-1"
            >
              {runningCount > 0 && (
                <div className="glass rounded-md px-2.5 py-1 flex items-center gap-1.5">
                  <Cpu className="w-3 h-3 animate-pulse" style={{ color: '#D4920B' }} />
                  <span className="terminal-text text-[10px]" style={{ color: '#D4920B' }}>
                    {runningCount} executing
                  </span>
                </div>
              )}
              {hitlCount > 0 && (
                <div className="glass rounded-md px-2.5 py-1 flex items-center gap-1.5">
                  <Activity className="w-3 h-3" style={{ color: '#f5b942' }} />
                  <span className="terminal-text text-[10px]" style={{ color: '#f5b942' }}>
                    {hitlCount} awaiting approval
                  </span>
                </div>
              )}
              {completedCount > 0 && (
                <div className="glass rounded-md px-2.5 py-1 flex items-center gap-1.5">
                  <Wifi className="w-3 h-3" style={{ color: '#4CAF50' }} />
                  <span className="terminal-text text-[10px]" style={{ color: '#4CAF50' }}>
                    {completedCount} complete
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Empty state */}
      <AnimatePresence>
        {agentList.length === 0 && task.status === 'idle' && tabs.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="text-center space-y-3">
              <motion.div
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="w-24 h-24 mx-auto rounded-full"
                style={{
                  border: '1px dashed rgba(212,146,11,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <motion.div
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                  className="w-16 h-16 rounded-full"
                  style={{ border: '1px dashed rgba(200,168,78,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div className="w-2 h-2 rounded-full" style={{ background: 'rgba(212,146,11,0.4)' }} />
                </motion.div>
              </motion.div>
              <p className="terminal-text text-[11px]" style={{ color: 'rgba(212,146,11,0.3)' }}>
                TYPE A COMMAND BELOW TO ACTIVATE THE MIND
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function MindGraph() {
  return (
    <ReactFlowProvider>
      <MindGraphInner />
    </ReactFlowProvider>
  )
}
