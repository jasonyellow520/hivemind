import { useState, useCallback, useEffect, useRef } from 'react'
import { useWebSocket } from './store/useWebSocket'
import { useMindStore } from './store/useMindStore'
import { MindGraph } from './components/MindMap/HiveGraph'
import { HITLPanel } from './components/HITL/HITLPanel'
import { AgentLogPanel } from './components/Dashboard/AgentLogPanel'
import { VoiceIndicator } from './components/Dashboard/VoiceIndicator'
import { CommandBar } from './components/Dashboard/CommandBar'
import { Sidebar } from './components/Dashboard/Sidebar'
import { TabChips } from './components/Tabs/TabChips'
import { TabPanel } from './components/Tabs/TabPanel'
import { TabGridPanel } from './components/Tabs/TabGridPanel'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Terminal, Layers, Sparkles, X, GripHorizontal, ChevronRight, History, MessageSquare } from 'lucide-react'

function App() {
  useWebSocket()
  const agents = useMindStore((s) => s.agents)
  const task = useMindStore((s) => s.task)
  const hitlQueue = useMindStore((s) => s.hitlQueue)
  const selectedAgentId = useMindStore((s) => s.selectedAgentId)
  const selectAgent = useMindStore((s) => s.selectAgent)
  const completedTasks = useMindStore((s) => s.completedTasks)

  const [showTabPanel, setShowTabPanel] = useState(false)
  const [showLogPanel, setShowLogPanel] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Resizable results panel
  const [resultsHeight, setResultsHeight] = useState(280)
  const [resultTab, setResultTab] = useState<'summary' | string>('summary')
  const resultsDragRef = useRef<{ startY: number; startH: number } | null>(null)

  const onResultsDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resultsDragRef.current = { startY: e.clientY, startH: resultsHeight }
    const onMove = (ev: MouseEvent) => {
      if (!resultsDragRef.current) return
      const delta = resultsDragRef.current.startY - ev.clientY
      setResultsHeight(Math.max(120, Math.min(window.innerHeight * 0.8, resultsDragRef.current.startH + delta)))
    }
    const onUp = () => {
      resultsDragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [resultsHeight])

  const agentList = Object.values(agents)
  const runningCount = agentList.filter((a) => a.status === 'running').length
  const hitlCount = hitlQueue.length

  // Auto-show log panel when agents spawn
  useEffect(() => {
    if (agentList.length > 0 && !showLogPanel) {
      setShowLogPanel(true)
    }
  }, [agentList.length])

  // Auto-show results when task completes
  useEffect(() => {
    if (task.status === 'completed' && task.finalResult) {
      setShowResults(true)
    }
  }, [task.status, task.finalResult])

  // Close log panel if no agents
  useEffect(() => {
    if (agentList.length === 0) {
      setShowLogPanel(false)
      setShowResults(false)
    }
  }, [agentList.length])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.ctrlKey || e.metaKey) return
      if (e.key === 'l' || e.key === 'L') { setShowLogPanel((p) => !p); setShowTabPanel(false) }
      if (e.key === 't' || e.key === 'T') { setShowTabPanel((p) => !p); setShowLogPanel(false) }
      if (e.key === 'g' || e.key === 'G') { setShowGrid((p) => !p) }
      if (e.key === 'v' || e.key === 'V') {
        const store = useMindStore.getState()
        if (store.isLiveVoice) {
          store.setLiveVoice(false, 'idle', '')
        }
        window.dispatchEvent(new CustomEvent('mindd:toggle-live-voice'))
      }
      if (e.key === 'Escape') {
        setShowTabPanel(false)
        setShowLogPanel(false)
        setShowGrid(false)
        selectAgent(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectAgent])

  const [simSending, setSimSending] = useState(false)

  const simulateIMessage = async () => {
    if (simSending) return
    setSimSending(true)
    try {
      const res = await fetch('/api/v1/imessage/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Launch 5 agents to find the latest breaking news: 1) AI and machine learning breakthroughs, 2) global conflicts and war updates, 3) tech industry news and launches, 4) science and space discoveries, 5) financial markets and crypto',
          from_phone: '+15551234567',
          to_phone: '+15559876543',
          message_id: `sim-${Date.now()}`,
          timestamp: new Date().toISOString(),
        }),
      })
      if (res.ok) {
        useMindStore.getState().pushFeed({
          type: 'info',
          text: 'Simulated iMessage received — Dispatcher processing...',
          timestamp: new Date().toISOString(),
        })
      }
    } catch (e) {
      console.error('Simulate failed:', e)
    } finally {
      setSimSending(false)
    }
  }

  const isActive = task.status === 'running' || task.status === 'decomposing'

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: '#1A1608' }}>
      {/* ─── Top Nav Bar (gold theme) ──────────────────────── */}
      <nav
        className="shrink-0 flex items-center justify-between px-5 h-12"
        style={{
          borderBottom: '1px solid rgba(212,146,11,0.2)',
          background: 'rgba(26,22,8,0.95)',
          backdropFilter: 'blur(10px)',
          zIndex: 10,
        }}
      >
        {/* Left: Logo + branding */}
        <div className="flex items-center gap-3">
          <motion.div
            animate={isActive ? {
              boxShadow: [
                '0 0 8px rgba(212,146,11,0.3)',
                '0 0 20px rgba(212,146,11,0.5)',
                '0 0 8px rgba(212,146,11,0.3)',
              ]
            } : {}}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #D4920B, #8B6914)' }}
          >
            <svg width="16" height="18" viewBox="0 0 100 115">
              <path d="M50 2L95 27V77L50 102L5 77V27Z" fill="#1A1608" />
            </svg>
          </motion.div>
          <span style={{ fontWeight: 800, fontSize: 18, color: '#F5E8C8', letterSpacing: 2 }}>
            Hivemind
          </span>
          <div
            style={{
              background: 'rgba(212,146,11,0.15)',
              border: '1px solid rgba(212,146,11,0.3)',
              borderRadius: 6,
              padding: '3px 12px',
              fontSize: 11,
              color: '#D4920B',
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            swarm intelligence
          </div>

          {/* Active task indicator */}
          {task.masterTask && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="hidden md:flex items-center gap-1.5 ml-3 max-w-xs"
            >
              {isActive && (
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: '#D4920B' }}
                />
              )}
              <span className="text-[10px] truncate" style={{ color: '#8B7A4A', fontFamily: 'monospace' }}>
                {task.masterTask}
              </span>
            </motion.div>
          )}
        </div>

        {/* Right: Tab chips + action buttons */}
        <div className="flex items-center gap-3">
          <TabChips onOpenPanel={() => { setShowTabPanel(true); setShowLogPanel(false) }} />

          <div className="w-px h-4" style={{ background: 'rgba(212,146,11,0.15)' }} />

          {/* HITL indicator */}
          <AnimatePresence>
            {hitlCount > 0 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px]"
                style={{
                  background: 'rgba(245,185,66,0.1)',
                  border: '1px solid rgba(245,185,66,0.25)',
                  color: '#f5b942',
                  fontFamily: 'monospace',
                }}
              >
                <motion.div
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: '#f5b942' }}
                />
                {hitlCount} review{hitlCount !== 1 ? 's' : ''}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Agent count */}
          <AnimatePresence>
            {agentList.length > 0 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]"
                style={{
                  background: 'rgba(212,146,11,0.08)',
                  border: '1px solid rgba(212,146,11,0.2)',
                  color: '#D4920B',
                  fontFamily: 'monospace',
                }}
              >
                <Activity className="w-3 h-3" />
                {agentList.length} agent{agentList.length !== 1 ? 's' : ''}
                {runningCount > 0 && (
                  <motion.span
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="ml-1"
                  >
                    · {runningCount} live
                  </motion.span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Simulate iMessage */}
          <button
            onClick={simulateIMessage}
            disabled={simSending}
            title="Simulate iMessage (5 news agents)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] transition-all"
            style={{
              background: simSending ? 'rgba(76,175,80,0.15)' : 'rgba(76,175,80,0.08)',
              border: '1px solid rgba(76,175,80,0.25)',
              color: '#4CAF50',
              opacity: simSending ? 0.6 : 1,
              fontFamily: 'monospace',
            }}
          >
            <MessageSquare className="w-3 h-3" />
            {simSending ? 'Sending...' : 'iMessage'}
          </button>

          <div className="w-px h-4" style={{ background: 'rgba(212,146,11,0.15)' }} />

          {/* Panel toggles */}
          <button
            onClick={() => { setShowLogPanel((p) => !p); setShowTabPanel(false) }}
            title="Toggle Logs (L)"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: showLogPanel ? 'rgba(212,146,11,0.15)' : 'rgba(255,255,255,0.04)',
              border: showLogPanel ? '1px solid rgba(212,146,11,0.3)' : '1px solid rgba(255,255,255,0.06)',
              color: showLogPanel ? '#D4920B' : '#8B7A4A',
            }}
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setShowTabPanel((p) => !p); setShowLogPanel(false) }}
            title="Toggle Tabs (T)"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: showTabPanel ? 'rgba(212,146,11,0.1)' : 'rgba(255,255,255,0.04)',
              border: showTabPanel ? '1px solid rgba(212,146,11,0.25)' : '1px solid rgba(255,255,255,0.06)',
              color: showTabPanel ? '#D4920B' : '#8B7A4A',
            }}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {/* Notification bell */}
          <div style={{ position: 'relative', cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B7A4A" strokeWidth="1.5">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {hitlCount > 0 && (
              <div style={{ position: 'absolute', top: -2, right: -2, width: 6, height: 6, borderRadius: '50%', background: '#E85D24' }} />
            )}
          </div>
        </div>
      </nav>

      {/* ─── Tab Grid Overlay ────────────────────────────────── */}
      {showGrid && <TabGridPanel onClose={() => setShowGrid(false)} />}

      {/* ─── Main Content: Sidebar + Honeycomb ──────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar */}
        <Sidebar />

        {/* Center — Honeycomb Canvas */}
        <div className="flex-1 relative min-h-0" style={{ overflow: 'hidden' }}>
          {/* Background hex grid — large decorative honeycomb */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 800 700" preserveAspectRatio="xMidYMid slice" style={{ opacity: 0.06 }}>
              {/* Row 0 */}
              <polygon points="200,0 280,46 280,138 200,184 120,138 120,46" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="360,0 440,46 440,138 360,184 280,138 280,46" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="520,0 600,46 600,138 520,184 440,138 440,46" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="680,0 760,46 760,138 680,184 600,138 600,46" fill="none" stroke="#D4920B" strokeWidth="2"/>
              {/* Row 1 (offset) */}
              <polygon points="120,138 200,184 200,276 120,322 40,276 40,184" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="280,138 360,184 360,276 280,322 200,276 200,184" fill="#D4920B" fillOpacity="0.03" stroke="#D4920B" strokeWidth="1.5"/>
              <polygon points="440,138 520,184 520,276 440,322 360,276 360,184" fill="#D4920B" fillOpacity="0.03" stroke="#D4920B" strokeWidth="1.5"/>
              <polygon points="600,138 680,184 680,276 600,322 520,276 520,184" fill="none" stroke="#D4920B" strokeWidth="2"/>
              {/* Row 2 */}
              <polygon points="200,276 280,322 280,414 200,460 120,414 120,322" fill="#D4920B" fillOpacity="0.04" stroke="#D4920B" strokeWidth="1.5"/>
              <polygon points="360,276 440,322 440,414 360,460 280,414 280,322" fill="#D4920B" fillOpacity="0.05" stroke="#D4920B" strokeWidth="1.5"/>
              <polygon points="520,276 600,322 600,414 520,460 440,414 440,322" fill="#D4920B" fillOpacity="0.04" stroke="#D4920B" strokeWidth="1.5"/>
              <polygon points="680,276 760,322 760,414 680,460 600,414 600,322" fill="none" stroke="#D4920B" strokeWidth="2"/>
              {/* Row 3 (offset) */}
              <polygon points="120,414 200,460 200,552 120,598 40,552 40,460" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="280,414 360,460 360,552 280,598 200,552 200,460" fill="#D4920B" fillOpacity="0.03" stroke="#D4920B" strokeWidth="1.5"/>
              <polygon points="440,414 520,460 520,552 440,598 360,552 360,460" fill="#D4920B" fillOpacity="0.03" stroke="#D4920B" strokeWidth="1.5"/>
              <polygon points="600,414 680,460 680,552 600,598 520,552 520,460" fill="none" stroke="#D4920B" strokeWidth="2"/>
              {/* Row 4 */}
              <polygon points="200,552 280,598 280,690 200,736 120,690 120,598" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="360,552 440,598 440,690 360,736 280,690 280,598" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="520,552 600,598 600,690 520,736 440,690 440,598" fill="none" stroke="#D4920B" strokeWidth="2"/>
              <polygon points="680,552 760,598 760,690 680,736 600,690 600,598" fill="none" stroke="#D4920B" strokeWidth="2"/>
              {/* Diagonal accent lines */}
              <line x1="0" y1="0" x2="800" y2="700" stroke="#D4920B" strokeWidth="0.5" opacity="0.5"/>
              <line x1="800" y1="0" x2="0" y2="700" stroke="#D4920B" strokeWidth="0.5" opacity="0.5"/>
            </svg>
          </div>

          <MindGraph />

          {/* HITL panel (top-right overlay) */}
          <AnimatePresence>
            {hitlCount > 0 && <HITLPanel />}
          </AnimatePresence>

          {/* Log panel (right side drawer) */}
          <AnimatePresence>
            {showLogPanel && agentList.length > 0 && (
              <AgentLogPanel onClose={() => { setShowLogPanel(false); selectAgent(null) }} />
            )}
          </AnimatePresence>

          {/* Tab panel (right side drawer) */}
          <AnimatePresence>
            {showTabPanel && (
              <TabPanel onClose={() => setShowTabPanel(false)} />
            )}
          </AnimatePresence>

          {/* Results panel (resizable, per-agent output) */}
          <AnimatePresence>
            {showResults && task.finalResult && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-4 left-4 right-4 z-30 flex flex-col"
                style={{ height: resultsHeight }}
              >
                <div
                  className="rounded-2xl overflow-hidden flex flex-col h-full"
                  style={{
                    background: 'rgba(40,34,16,0.97)',
                    border: '1px solid rgba(76,175,80,0.2)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 0 30px rgba(76,175,80,0.08)',
                  }}
                >
                  {/* Drag handle */}
                  <div
                    className="h-3 cursor-row-resize flex items-center justify-center shrink-0 hover:bg-white/5 transition-colors rounded-t-2xl"
                    onMouseDown={onResultsDragStart}
                  >
                    <GripHorizontal className="w-4 h-2.5" style={{ color: 'rgba(255,255,255,0.15)' }} />
                  </div>

                  {/* Header with tab switcher */}
                  <div
                    className="px-4 py-2 flex items-center justify-between shrink-0"
                    style={{ borderBottom: '1px solid rgba(76,175,80,0.1)' }}
                  >
                    <div className="flex items-center gap-2 overflow-x-auto min-w-0">
                      <Sparkles className="w-4 h-4 shrink-0" style={{ color: '#4CAF50' }} />
                      <span className="text-xs font-semibold" style={{ color: '#F5E8C8' }}>Task Complete</span>

                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => setResultTab('summary')}
                          className="px-2 py-0.5 rounded text-[10px] transition-all"
                          style={{
                            background: resultTab === 'summary' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${resultTab === 'summary' ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.06)'}`,
                            color: resultTab === 'summary' ? '#4CAF50' : 'rgba(255,255,255,0.4)',
                            fontFamily: 'monospace',
                          }}
                        >
                          Summary
                        </button>
                        {task.agentResults.map((r, i) => (
                          <button
                            key={r.agentId}
                            onClick={() => setResultTab(r.agentId)}
                            className="px-2 py-0.5 rounded text-[10px] transition-all"
                            style={{
                              background: resultTab === r.agentId ? 'rgba(212,146,11,0.15)' : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${resultTab === r.agentId ? 'rgba(212,146,11,0.3)' : 'rgba(255,255,255,0.06)'}`,
                              color: resultTab === r.agentId ? '#D4920B' : 'rgba(255,255,255,0.4)',
                              fontFamily: 'monospace',
                            }}
                          >
                            Agent {i + 1}
                            <span className="ml-1 opacity-50">({r.stepsTaken}s)</span>
                          </button>
                        ))}

                        {completedTasks.length > 1 && (
                          <button
                            onClick={() => setShowHistory((p) => !p)}
                            className="px-2 py-0.5 rounded text-[10px] transition-all ml-1"
                            style={{
                              background: showHistory ? 'rgba(212,146,11,0.1)' : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${showHistory ? 'rgba(212,146,11,0.2)' : 'rgba(255,255,255,0.06)'}`,
                              color: showHistory ? '#D4920B' : 'rgba(255,255,255,0.3)',
                              fontFamily: 'monospace',
                            }}
                          >
                            <History className="w-2.5 h-2.5 inline mr-0.5" />
                            {completedTasks.length}
                          </button>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setShowResults(false)} className="shrink-0 ml-2" title="Close results">
                      <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.3)' }} />
                    </button>
                  </div>

                  {/* Content area */}
                  <div className="flex-1 overflow-y-auto p-4 min-h-0">
                    {showHistory ? (
                      <div className="space-y-3">
                        {[...completedTasks].reverse().map((ct, i) => (
                          <div key={ct.taskId + i} className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <ChevronRight className="w-3 h-3" style={{ color: '#4CAF50' }} />
                              <span className="text-[11px] font-medium" style={{ color: '#F5E8C8', fontFamily: 'monospace' }}>
                                {ct.masterTask.length > 80 ? ct.masterTask.slice(0, 80) + '...' : ct.masterTask}
                              </span>
                              <span className="text-[9px]" style={{ color: '#8B7A4A', fontFamily: 'monospace' }}>
                                {ct.agentResults.length} agent{ct.agentResults.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
                              {ct.finalResult.length > 300 ? ct.finalResult.slice(0, 300) + '...' : ct.finalResult}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : resultTab === 'summary' ? (
                      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: '#E8D8B0', fontFamily: 'monospace' }}>
                        {task.finalResult}
                      </p>
                    ) : (
                      (() => {
                        const agentResult = task.agentResults.find((r) => r.agentId === resultTab)
                        if (!agentResult) return null
                        const agentState = agents[resultTab]
                        return (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(212,146,11,0.1)', color: '#D4920B', border: '1px solid rgba(212,146,11,0.2)', fontFamily: 'monospace' }}>
                                {agentResult.stepsTaken} steps
                              </span>
                              {agentState?.taskDescription && (
                                <span className="text-[10px] truncate" style={{ color: '#8B7A4A', fontFamily: 'monospace' }}>
                                  {agentState.taskDescription.slice(0, 100)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: '#E8D8B0', fontFamily: 'monospace' }}>
                              {agentResult.result}
                            </p>
                          </div>
                        )
                      })()
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Voice indicator */}
          <VoiceIndicator />
        </div>
      </div>

      {/* ─── Command Bar ─────────────────────────────────────── */}
      <CommandBar
        onOpenTabs={() => { setShowTabPanel(true); setShowLogPanel(false) }}
        onOpenLogs={() => { setShowLogPanel(true); setShowTabPanel(false) }}
      />
    </div>
  )
}

export default App
