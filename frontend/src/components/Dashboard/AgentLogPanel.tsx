import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, Globe, X, Activity, CheckCircle, XCircle, AlertTriangle, Trash2 } from 'lucide-react'
import { useMindStore } from '../../store/useMindStore'

const STATUS_DOT: Record<string, string> = {
  idle: '#4b5563',
  planning: '#3b82f6',
  running: '#D4920B',
  waiting_hitl: '#f5b942',
  completed: '#4CAF50',
  error: '#f43f5e',
}

interface AgentLogPanelProps {
  onClose: () => void
}

export function AgentLogPanel({ onClose }: AgentLogPanelProps) {
  const agents = useMindStore((s) => s.agents)
  const selectedAgentId = useMindStore((s) => s.selectedAgentId)
  const selectAgent = useMindStore((s) => s.selectAgent)
  const killAgent = useMindStore((s) => s.killAgent)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleKill = (agentId: string) => {
    fetch(`/api/v1/agents/${agentId}`, { method: 'DELETE' }).catch(() => {})
    killAgent(agentId)
  }

  const agent = selectedAgentId ? agents[selectedAgentId] : null
  const agentList = Object.values(agents)

  // Auto-select latest spawned agent when none is selected or selected agent no longer exists
  useEffect(() => {
    if (agentList.length === 0) return
    const selectedIsValid = selectedAgentId != null && agents[selectedAgentId] != null
    if (!selectedIsValid) {
      selectAgent(agentList[agentList.length - 1].agentId)
    }
  }, [agentList.length, selectedAgentId, agents])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [agent?.logs])

  if (agentList.length === 0) return null

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      className="absolute right-0 top-0 bottom-0 w-80 flex flex-col"
      style={{
        background: 'rgba(40,34,16,0.97)',
        backdropFilter: 'blur(24px)',
        borderLeft: '1px solid rgba(200,168,78,0.1)',
        zIndex: 40,
      }}
    >
      {/* Header */}
      <div
        className="shrink-0 px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid rgba(200,168,78,0.08)' }}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4" style={{ color: '#C8A84E' }} />
          <span className="text-xs font-semibold text-white">Neural Feed</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Agent selector tabs */}
          <div className="flex items-center gap-1">
            {agentList.map((a) => (
              <div key={a.agentId} className="flex items-center gap-0.5">
                <button
                  onClick={() => selectAgent(a.agentId)}
                  title={`Agent ${a.subtaskIndex + 1}: ${a.taskDescription}`}
                  className="w-6 h-6 rounded-md flex items-center justify-center terminal-text text-[10px] font-bold transition-all"
                  style={{
                    background: selectedAgentId === a.agentId ? 'rgba(200,168,78,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${selectedAgentId === a.agentId ? 'rgba(200,168,78,0.4)' : 'rgba(255,255,255,0.06)'}`,
                    color: selectedAgentId === a.agentId ? '#C8A84E' : 'rgba(255,255,255,0.3)',
                    borderBottom: `2px solid ${STATUS_DOT[a.status]}`,
                  }}
                >
                  {a.subtaskIndex + 1}
                </button>
                {(a.status === 'running' || a.status === 'planning') && (
                  <button
                    onClick={() => handleKill(a.agentId)}
                    title="Kill agent"
                    className="w-4 h-4 rounded flex items-center justify-center transition-colors"
                    style={{ color: 'rgba(244,63,94,0.5)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(244,63,94,1)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(244,63,94,0.5)')}
                  >
                    <Trash2 style={{ width: 10, height: 10 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ color: 'rgba(255,255,255,0.25)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {agent && (
        <>
          {/* Agent info bar */}
          <div
            className="shrink-0 px-4 py-2 flex items-center gap-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
          >
            <motion.div
              animate={{ opacity: agent.status === 'running' ? [0.5, 1, 0.5] : 1 }}
              transition={{ duration: 1, repeat: Infinity }}
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: STATUS_DOT[agent.status] }}
            />
            <p className="terminal-text text-[10px] text-zinc-400 flex-1 truncate">
              {agent.taskDescription}
            </p>
            <span className="terminal-text text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
              {agent.stepsCompleted}s
            </span>
          </div>

          {/* Logs */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-1">
            <AnimatePresence initial={false}>
              {agent.logs.map((log, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="group flex gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] transition-colors"
                >
                  <span
                    className="terminal-text text-[9px] shrink-0 mt-0.5 w-5 text-right"
                    style={{ color: 'rgba(200,168,78,0.4)' }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="terminal-text text-[11px] leading-relaxed break-words"
                       style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {log.message}
                    </p>
                    {log.url && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Globe className="w-2.5 h-2.5 shrink-0" style={{ color: 'rgba(212,146,11,0.3)' }} />
                        <span className="terminal-text text-[9px] truncate" style={{ color: 'rgba(212,146,11,0.35)' }}>
                          {log.url}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {agent.logs.length === 0 && (
              <div className="py-10 text-center">
                <motion.div
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="terminal-text text-[11px]"
                  style={{ color: 'rgba(212,146,11,0.4)' }}
                >
                  Waiting for neural activity...
                </motion.div>
              </div>
            )}

            {/* Result if completed */}
            {agent.result && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 p-3 rounded-xl"
                style={{
                  background: 'rgba(76,175,80,0.05)',
                  border: '1px solid rgba(76,175,80,0.15)',
                }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <CheckCircle className="w-3 h-3" style={{ color: '#4CAF50' }} />
                  <span className="terminal-text text-[10px] font-medium" style={{ color: '#4CAF50' }}>Result</span>
                </div>
                <p className="terminal-text text-[10px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {agent.result.slice(0, 200)}{agent.result.length > 200 ? '...' : ''}
                </p>
              </motion.div>
            )}

            {/* Error if failed */}
            {agent.lastError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 p-2.5 rounded-xl"
                style={{
                  background: 'rgba(244,63,94,0.05)',
                  border: '1px solid rgba(244,63,94,0.15)',
                }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <XCircle className="w-3 h-3" style={{ color: '#f43f5e' }} />
                  <span className="terminal-text text-[10px]" style={{ color: '#f43f5e' }}>Error</span>
                </div>
                <p className="terminal-text text-[10px]" style={{ color: 'rgba(244,63,94,0.7)' }}>
                  {agent.lastError}
                </p>
              </motion.div>
            )}
          </div>
        </>
      )}
    </motion.div>
  )
}
