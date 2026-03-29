import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, Check, X, Pencil, ExternalLink, AlertTriangle, ChevronDown } from 'lucide-react'
import { useHITLQueue } from '../../hooks/useHITLQueue'

export function HITLPanel() {
  const { hitlQueue, approve, reject, edit } = useHITLQueue()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  if (hitlQueue.length === 0) return null

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      className="absolute top-4 right-4 w-96 z-50"
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(40,34,16,0.97)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(245,185,66,0.25)',
          boxShadow: '0 0 40px rgba(245,185,66,0.1), 0 20px 40px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-3.5 flex items-center justify-between cursor-pointer"
          style={{ borderBottom: '1px solid rgba(245,185,66,0.1)' }}
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ boxShadow: ['0 0 10px rgba(245,185,66,0.3)', '0 0 25px rgba(245,185,66,0.6)', '0 0 10px rgba(245,185,66,0.3)'] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(245,185,66,0.12)', border: '1px solid rgba(245,185,66,0.25)' }}
            >
              <Shield className="w-4 h-4" style={{ color: '#f5b942' }} />
            </motion.div>
            <div>
              <h3 className="text-sm font-semibold text-white">Human Approval Required</h3>
              <p className="terminal-text text-[10px]" style={{ color: 'rgba(245,185,66,0.7)' }}>
                {hitlQueue.length} pending action{hitlQueue.length !== 1 ? 's' : ''} · Agent is paused
              </p>
            </div>
          </div>
          <motion.div animate={{ rotate: collapsed ? 0 : 180 }}>
            <ChevronDown className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.3)' }} />
          </motion.div>
        </div>

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
                <AnimatePresence>
                  {hitlQueue.map((req) => (
                    <motion.div
                      key={req.hitlId}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 60 }}
                      className="rounded-xl overflow-hidden"
                      style={{
                        background: 'rgba(245,185,66,0.04)',
                        border: '1px solid rgba(245,185,66,0.12)',
                      }}
                    >
                      <div className="p-3.5">
                        {/* Action type badge */}
                        <div className="flex items-center gap-2 mb-2.5">
                          <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#f5b942' }} />
                          <span
                            className="terminal-text text-[11px] font-semibold px-2 py-0.5 rounded"
                            style={{ background: 'rgba(245,185,66,0.1)', color: '#f5b942', border: '1px solid rgba(245,185,66,0.2)' }}
                          >
                            {req.actionType}
                          </span>
                          <span className="terminal-text text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                            {req.agentId.replace('worker-', 'agent-')}
                          </span>
                        </div>

                        {/* Description */}
                        <p className="text-[11px] leading-relaxed mb-2.5 line-clamp-3"
                           style={{ color: 'rgba(255,255,255,0.75)' }}>
                          {req.actionDescription}
                        </p>

                        {/* URL */}
                        {req.url && (
                          <a
                            href={req.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mb-3 transition-colors"
                            style={{ color: 'rgba(212,146,11,0.6)', fontSize: '10px' }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#D4920B')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(212,146,11,0.6)')}
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span className="terminal-text truncate max-w-[280px]">{req.url}</span>
                          </a>
                        )}

                        {/* Edit mode */}
                        {editingId === req.hitlId ? (
                          <div className="space-y-2">
                            <textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              placeholder="Modify the action..."
                              className="w-full h-16 px-3 py-2 rounded-lg terminal-text text-xs resize-none focus:outline-none"
                              style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(212,146,11,0.2)',
                                color: 'white',
                              }}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => { edit(req.hitlId, editValue); setEditingId(null); setEditValue('') }}
                                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                                style={{ background: 'rgba(200,168,78,0.15)', border: '1px solid rgba(200,168,78,0.3)', color: '#C8A84E' }}
                              >
                                Submit Edit
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setEditValue('') }}
                                className="px-3 py-1.5 rounded-lg text-xs transition-all"
                                style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => approve(req.hitlId)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
                              style={{
                                background: 'rgba(76,175,80,0.1)',
                                border: '1px solid rgba(76,175,80,0.25)',
                                color: '#4CAF50',
                              }}
                            >
                              <Check className="w-3.5 h-3.5" />
                              Approve
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => reject(req.hitlId)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
                              style={{
                                background: 'rgba(244,63,94,0.1)',
                                border: '1px solid rgba(244,63,94,0.25)',
                                color: '#f43f5e',
                              }}
                            >
                              <X className="w-3.5 h-3.5" />
                              Reject
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => { setEditingId(req.hitlId); setEditValue(req.actionDescription) }}
                              className="flex items-center justify-center px-3 py-2 rounded-xl text-xs transition-all"
                              style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                color: 'rgba(255,255,255,0.4)',
                              }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </motion.button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
