import { memo, useState, useRef } from 'react'
import { Handle, Position } from '@xyflow/react'
import { motion } from 'framer-motion'
import { X, BookMarked, Send, Zap } from 'lucide-react'
import { useMindStore } from '../../store/useMindStore'

interface TabNodeData {
  tabId: string
  title: string
  url: string
  instruction: string
  assignedAgentId: string | null
  isSelected: boolean
  dimmed: boolean
  onSelect: (tabId: string) => void
  onActivate: (tabId: string) => void
}

// Normal hex dimensions
const HEX_W = 200
const HEX_H = 174
// Selected rectangle dimensions (larger for usable preview)
const RECT_W = 400
const RECT_H = 300
// Command panel height
const CMD_H = 108

function AgentLogLines({ agentId }: { agentId: string }) {
  const agents = useMindStore((s) => s.agents)
  const agent = agents[agentId]
  if (!agent) return null
  const lastLogs = agent.logs.slice(-3)
  return (
    <div style={{ padding: '6px 10px', flex: 1, overflow: 'hidden' }}>
      <div style={{ fontSize: 9, color: 'rgba(212,146,11,0.7)', fontFamily: 'monospace', marginBottom: 4 }}>
        {agent.status.toUpperCase()} · step {agent.stepsCompleted}
      </div>
      {lastLogs.map((log, i) => (
        <div
          key={i}
          style={{
            fontSize: 8,
            color: 'rgba(255,255,255,0.5)',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
        >
          › {log.message.slice(0, 45)}
        </div>
      ))}
    </div>
  )
}

export const TabNode = memo(function TabNode({ data }: { data: TabNodeData }) {
  const screenshot = useMindStore((s) => s.tabScreenshots[data.tabId] ?? null)
  const [hovered, setHovered] = useState(false)
  const [cmd, setCmd] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { isSelected, dimmed } = data

  const domain = (() => {
    try { return new URL(data.url).hostname.replace('www.', '') }
    catch { return data.url.slice(0, 20) }
  })()

  const hasAgent = !!data.assignedAgentId

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    fetch(`/api/v1/tabs/${data.tabId}`, { method: 'DELETE' }).catch(() => {})
    if (data.assignedAgentId) {
      fetch(`/api/v1/agents/${data.assignedAgentId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const handleSaveMemory = (e: React.MouseEvent) => {
    e.stopPropagation()
    fetch(`/api/v1/tabs/${data.tabId}/save-to-memory`, { method: 'POST' }).catch(() => {})
  }

  const handleSendCmd = async (e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation()
    const trimmed = cmd.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await fetch('/api/v1/tabs/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: [{ tab_id: data.tabId, instruction: trimmed }],
          global_task: trimmed,
        }),
      })
      setCmd('')
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  const glowFilter = isSelected
    ? 'drop-shadow(0 0 3px rgba(200,168,78,0.9)) drop-shadow(0 0 18px rgba(200,168,78,0.4))'
    : hasAgent
      ? 'drop-shadow(0 0 2px rgba(212,146,11,0.6)) drop-shadow(0 0 10px rgba(212,146,11,0.2))'
      : 'drop-shadow(0 0 1px rgba(212,146,11,0.25)) drop-shadow(0 0 6px rgba(212,146,11,0.06))'

  // Outer wrapper dims/size
  const outerW = isSelected ? RECT_W : HEX_W
  const outerH = isSelected ? RECT_H + CMD_H : HEX_H

  return (
    <div
      style={{
        width: outerW,
        height: outerH,
        position: 'relative',
        opacity: dimmed ? 0.22 : 1,
        transition: 'opacity 0.3s, width 0.25s, height 0.25s',
        pointerEvents: dimmed ? 'none' : 'auto',
      }}
    >
      {/* ReactFlow handles */}
      <Handle type="target" position={Position.Top} style={{ top: 0, left: '50%', opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Bottom} style={{ bottom: 0, left: '50%', opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Left} style={{ left: 0, top: '50%', opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Right} style={{ right: 0, top: '50%', opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Top} style={{ top: 0, left: '50%', opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ bottom: 0, left: '50%', opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Left} style={{ left: 0, top: '50%', opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ right: 0, top: '50%', opacity: 0, pointerEvents: 'none' }} />

      {isSelected ? (
        /* ── Rectangle card (selected state) ── */
        <>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            style={{
              position: 'absolute',
              top: 0, left: 0,
              width: RECT_W,
              height: RECT_H,
              borderRadius: 12,
              border: '1px solid rgba(200,168,78,0.4)',
              background: 'rgba(18,8,36,0.98)',
              overflow: 'hidden',
              cursor: 'pointer',
              filter: glowFilter,
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => { e.stopPropagation(); data.onActivate(data.tabId) }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {/* Screenshot as main preview content */}
            {screenshot && (
              <img
                src={screenshot}
                alt={data.title}
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  opacity: 1,
                }}
                draggable={false}
              />
            )}
            {/* Light gradient only at top/bottom for header/footer readability */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(26,22,8,0.85) 0%, transparent 12%, transparent 88%, rgba(26,22,8,0.85) 100%)', pointerEvents: 'none' }} />

            {/* Header strip */}
            <div style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: '1px solid rgba(200,168,78,0.15)',
              background: 'rgba(26,22,8,0.6)',
            }}>
              <span style={{ fontSize: 10, color: 'rgba(200,168,78,0.9)', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                ⬡ {domain}
              </span>
              {hasAgent && (
                <span style={{ fontSize: 8, color: 'rgba(212,146,11,0.7)', fontFamily: 'monospace', letterSpacing: '0.06em' }}>
                  AGENT ACTIVE
                </span>
              )}
            </div>

            {/* Agent log lines or empty state */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {data.assignedAgentId ? (
                <AgentLogLines agentId={data.assignedAgentId} />
              ) : (
                <div style={{ padding: '8px 10px' }}>
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
                    No agent assigned
                  </span>
                </div>
              )}
            </div>

            {/* Bottom strip */}
            <div style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              borderTop: '1px solid rgba(200,168,78,0.1)',
              background: 'rgba(26,22,8,0.6)',
            }}>
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {(data.title || domain).slice(0, 28)}
              </span>
              <span style={{ fontSize: 7, color: 'rgba(200,168,78,0.4)', fontFamily: 'monospace', marginLeft: 8, whiteSpace: 'nowrap' }}>
                dbl-click →
              </span>
            </div>

            {/* Hover action buttons */}
            {hovered && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.25)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
                gap: 6, padding: '10px 12px',
              }}>
                <button
                  onClick={handleSaveMemory}
                  title="Save page to Queen memory"
                  style={{
                    background: 'rgba(200,168,78,0.2)', border: '1px solid rgba(200,168,78,0.35)',
                    borderRadius: 6, padding: '3px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  <BookMarked style={{ width: 11, height: 11, color: 'rgba(200,168,78,0.9)' }} />
                </button>
                <button
                  onClick={handleClose}
                  title="Close tab"
                  style={{
                    background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.3)',
                    borderRadius: 6, padding: '3px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  <X style={{ width: 11, height: 11, color: 'rgba(255,255,255,0.8)' }} />
                </button>
              </div>
            )}
          </motion.div>

          {/* ── Command panel below rectangle ── */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              position: 'absolute',
              top: RECT_H + 4,
              left: 0,
              width: RECT_W,
              background: 'rgba(10,6,24,0.97)',
              border: '1px solid rgba(200,168,78,0.25)',
              borderRadius: 12,
              padding: '8px 10px',
              boxShadow: '0 0 20px rgba(200,168,78,0.12)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
              <Zap style={{ width: 9, height: 9, color: 'rgba(212,146,11,0.6)' }} />
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'rgba(212,146,11,0.5)', letterSpacing: '0.06em' }}>
                AGENT TASK
              </span>
            </div>
            <textarea
              ref={inputRef}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder="Give this tab a task…"
              rows={2}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendCmd() }
              }}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(200,168,78,0.15)',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.8)',
                fontSize: 10, fontFamily: 'monospace',
                padding: '5px 7px',
                resize: 'none', outline: 'none',
                marginBottom: 5,
              }}
            />
            <button
              onClick={handleSendCmd}
              disabled={!cmd.trim() || sending}
              style={{
                width: '100%',
                background: sending ? 'rgba(200,168,78,0.05)' : 'rgba(200,168,78,0.15)',
                border: '1px solid rgba(200,168,78,0.25)',
                borderRadius: 6,
                color: '#C8A84E',
                fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em',
                padding: '4px 0',
                cursor: cmd.trim() && !sending ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}
            >
              <Send style={{ width: 8, height: 8 }} />
              {sending ? 'DISPATCHING…' : '⚡ RUN AGENT'}
            </button>
          </motion.div>
        </>
      ) : (
        /* ── Hexagon (normal state) ── */
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: HEX_W,
            height: HEX_H,
            clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
            overflow: 'hidden',
            background: 'rgba(40,34,16,0.96)',
            cursor: 'pointer',
            filter: glowFilter,
          }}
          onClick={() => data.onSelect(data.tabId)}
          onDoubleClick={(e) => { e.stopPropagation(); data.onActivate(data.tabId) }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Screenshot fill */}
          {screenshot && (
            <img
              src={screenshot}
              alt={data.title}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                opacity: 0.55,
              }}
              draggable={false}
            />
          )}

          {/* Dark gradient overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(26,22,8,0.55) 0%, rgba(26,22,8,0.1) 40%, rgba(26,22,8,0.6) 100%)',
            pointerEvents: 'none',
          }} />

          {/* Top strip — domain */}
          <div style={{
            position: 'absolute',
            top: 18,
            left: '27%', right: '27%',
            textAlign: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{
              fontSize: 9,
              color: 'rgba(212,146,11,0.85)',
              fontFamily: 'monospace',
              letterSpacing: '0.04em',
              textShadow: '0 0 8px rgba(212,146,11,0.4)',
              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {domain}
            </span>
          </div>

          {/* Bottom strip — title */}
          <div style={{
            position: 'absolute',
            bottom: 18,
            left: '18%', right: '18%',
            textAlign: 'center', pointerEvents: 'none',
          }}>
            <span style={{
              fontSize: 8,
              color: 'rgba(255,255,255,0.55)',
              fontFamily: 'monospace',
              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {(data.title || domain).slice(0, 22)}
            </span>
            {data.instruction?.trim() && (
              <span style={{
                fontSize: 7, color: 'rgba(212,146,11,0.5)', fontFamily: 'monospace',
                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginTop: 2,
              }}>
                ⚡ {data.instruction.slice(0, 20)}
              </span>
            )}
          </div>

          {/* Agent pulse dot */}
          {hasAgent && (
            <motion.div
              style={{
                position: 'absolute', top: 16, right: '30%',
                width: 6, height: 6,
                borderRadius: '50%',
                background: '#D4920B', boxShadow: '0 0 8px rgba(212,146,11,0.9)',
              }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}

          {/* Hover action buttons */}
          {hovered && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              gap: 8, paddingTop: 34,
            }}>
              <button
                onClick={handleSaveMemory}
                title="Save page to Queen memory"
                style={{
                  background: 'rgba(200,168,78,0.2)', border: '1px solid rgba(200,168,78,0.35)',
                  borderRadius: 6, padding: '3px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                }}
              >
                <BookMarked style={{ width: 11, height: 11, color: 'rgba(200,168,78,0.9)' }} />
              </button>
              <button
                onClick={handleClose}
                title="Close tab"
                style={{
                  background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.3)',
                  borderRadius: 6, padding: '3px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                }}
              >
                <X style={{ width: 11, height: 11, color: 'rgba(255,255,255,0.8)' }} />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
})
