import { memo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, AlertTriangle, Loader2, Clock, Cpu, Trash2 } from 'lucide-react'
import type { AgentStatus } from '../../types/mind.types'
import { STATUS_COLORS, STATUS_LABELS } from '../../types/mind.types'
import { useMindStore } from '../../store/useMindStore'

interface WorkerNodeData {
  agentId: string
  label: string
  taskDescription: string
  status: AgentStatus
  stepsCompleted: number
  currentUrl: string
  lastError: string | null
  subtaskIndex: number
}

const COLOR_MAP: Record<AgentStatus, string> = {
  idle: '#4b5563',
  planning: '#3b82f6',
  running: '#D4920B',
  waiting_hitl: '#f5b942',
  completed: '#4CAF50',
  error: '#f43f5e',
}

const StatusIcon = ({ status, size = 12 }: { status: AgentStatus; size?: number }) => {
  const s = `w-${size === 12 ? 3 : 4} h-${size === 12 ? 3 : 4}`
  switch (status) {
    case 'completed': return <CheckCircle className={s} />
    case 'error': return <XCircle className={s} />
    case 'waiting_hitl': return <AlertTriangle className={s} />
    case 'running': return <Loader2 className={`${s} animate-spin`} />
    case 'planning': return <Clock className={s} />
    default: return <Cpu className={s} />
  }
}

export const WorkerNode = memo(({ data }: { data: WorkerNodeData }) => {
  const selectAgent = useMindStore((s) => s.selectAgent)
  const selectedAgentId = useMindStore((s) => s.selectedAgentId)
  const killAgent = useMindStore((s) => s.killAgent)
  const isSelected = selectedAgentId === data.agentId
  const [hovered, setHovered] = useState(false)

  const handleKill = (e: React.MouseEvent) => {
    e.stopPropagation()
    fetch(`/api/v1/agents/${data.agentId}`, { method: 'DELETE' }).catch(() => {})
    killAgent(data.agentId)
  }
  const color = COLOR_MAP[data.status]
  const isRunning = data.status === 'running'
  const isHitl = data.status === 'waiting_hitl'
  const isActive = isRunning || data.status === 'planning'
  const agentNum = data.subtaskIndex + 1

  const domain = (() => {
    if (!data.currentUrl) return null
    try { return new URL(data.currentUrl).hostname.replace('www.', '') }
    catch { return null }
  })()

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 22, delay: 0.05 * data.subtaskIndex }}
      onClick={() => selectAgent(data.agentId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative cursor-pointer"
      style={{ width: 120, height: 140 }}
    >
      {/* HITL pulse ring */}
      <AnimatePresence>
        {isHitl && (
          <motion.div
            key="hitl-ring"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.7, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="absolute rounded-full"
            style={{
              width: 90, height: 90,
              top: 0, left: 15,
              border: '2px solid #f5b942',
            }}
          />
        )}
      </AnimatePresence>

      {/* Selected glow */}
      {isSelected && (
        <motion.div
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="absolute rounded-full"
          style={{
            width: 100, height: 100,
            top: -5, left: 10,
            background: 'radial-gradient(circle, rgba(200,168,78,0.2) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Outer rotating ring (running) */}
      {isActive && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: isRunning ? 2 : 4, repeat: Infinity, ease: 'linear' }}
          className="absolute rounded-full"
          style={{
            width: 96, height: 96,
            top: -3, left: 12,
            border: `1.5px dashed ${color}50`,
          }}
        />
      )}

      {/* Main circle */}
      <motion.div
        animate={isActive ? {
          boxShadow: [
            `0 0 15px ${color}30`,
            `0 0 30px ${color}50`,
            `0 0 15px ${color}30`,
          ]
        } : {}}
        transition={{ duration: 1.8, repeat: Infinity }}
        className="absolute rounded-full flex items-center justify-center"
        style={{
          width: 90, height: 90,
          top: 0, left: 15,
          background: 'linear-gradient(135deg, rgba(40,34,16,0.98), rgba(13,16,32,0.95))',
          border: `2px solid ${color}${isSelected ? '80' : '40'}`,
          boxShadow: isSelected ? `0 0 20px ${color}30` : undefined,
        }}
      >
        {/* Inner content */}
        <div className="flex flex-col items-center gap-0.5">
          {/* Agent number */}
          <motion.span
            className="terminal-text font-bold"
            style={{ fontSize: '22px', lineHeight: 1, color, opacity: isActive ? 1 : 0.7 }}
            animate={isActive ? { opacity: [0.7, 1, 0.7] } : {}}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            {agentNum.toString().padStart(2, '0')}
          </motion.span>
          {/* Status icon */}
          <div style={{ color }}>
            <StatusIcon status={data.status} />
          </div>
        </div>

        {/* Running spinner inner ring */}
        {isRunning && (
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-2 rounded-full"
            style={{ border: `1px solid ${color}20`, borderTopColor: `${color}60` }}
          />
        )}
      </motion.div>

      {/* Task label below circle */}
      <div className="absolute left-0 right-0 text-center" style={{ top: 98 }}>
        {/* Domain chip */}
        {domain && (
          <div
            className="inline-block px-1.5 py-0.5 rounded-md mb-0.5 terminal-text"
            style={{
              fontSize: '8px',
              background: `${color}15`,
              color: `${color}90`,
              border: `1px solid ${color}20`,
            }}
          >
            {domain.length > 12 ? domain.slice(0, 12) + '…' : domain}
          </div>
        )}
        {/* Task description */}
        <p
          className="text-center leading-tight px-2"
          style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)', lineHeight: '1.3' }}
        >
          {data.taskDescription.length > 28
            ? data.taskDescription.slice(0, 28) + '…'
            : data.taskDescription}
        </p>
        {/* Step count */}
        {data.stepsCompleted > 0 && (
          <span
            className="terminal-text"
            style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)' }}
          >
            {data.stepsCompleted} steps
          </span>
        )}
      </div>

      {/* HITL badge */}
      <AnimatePresence>
        {isHitl && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: '#f5b942', zIndex: 10 }}
          >
            <AlertTriangle className="w-3 h-3 text-black" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kill button on hover (only for running/planning agents) */}
      <AnimatePresence>
        {hovered && (data.status === 'running' || data.status === 'planning') && (
          <motion.button
            key="kill-btn"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={handleKill}
            title="Kill agent"
            className="absolute -top-2 -left-2 w-5 h-5 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(244,63,94,0.85)',
              border: '1px solid rgba(244,63,94,0.5)',
              zIndex: 20,
              cursor: 'pointer',
            }}
          >
            <Trash2 style={{ width: 10, height: 10, color: 'white' }} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Selected indicator */}
      {isSelected && (
        <div
          className="absolute -bottom-1 left-1/2 w-4 h-0.5 rounded-full"
          style={{ transform: 'translateX(-50%)', background: '#C8A84E' }}
        />
      )}

      <Handle type="target" position={Position.Top} style={{ opacity: 0, width: 6, height: 6, top: 0, left: '50%' }} />
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0, width: 6, height: 6 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6, top: '33%' }} />
      <Handle type="target" position={Position.Right} style={{ opacity: 0, width: 6, height: 6, top: '33%' }} />
    </motion.div>
  )
})

WorkerNode.displayName = 'WorkerNode'
