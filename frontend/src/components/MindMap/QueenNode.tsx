import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Zap, Activity } from 'lucide-react'

interface QueenNodeData {
  label: string
  task: string
  status: string
  subtaskCount: number
}

export const QueenNode = memo(({ data }: { data: QueenNodeData }) => {
  const isActive = data.status === 'running' || data.status === 'decomposing'
  const isDone = data.status === 'completed'

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 180, damping: 18 }}
      className="relative flex items-center justify-center"
      style={{ width: 180, height: 180 }}
    >
      {/* Outermost pulse ring (only when active) */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            key="pulse-outer"
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 1.9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full"
            style={{ border: '1px solid rgba(212,146,11,0.4)' }}
          />
        )}
      </AnimatePresence>

      {/* Rotating outer dashed ring */}
      <motion.div
        animate={{ rotate: isActive ? 360 : 0 }}
        transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-0 rounded-full"
        style={{
          border: '1px dashed rgba(212,146,11,0.25)',
          borderRadius: '50%',
        }}
      />

      {/* Counter-rotating middle ring */}
      <motion.div
        animate={{ rotate: isActive ? -360 : 0 }}
        transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
        className="absolute rounded-full"
        style={{
          inset: '18px',
          border: '1px solid rgba(200,168,78,0.3)',
          borderTopColor: 'rgba(200,168,78,0.8)',
          borderRadius: '50%',
        }}
      />

      {/* Core circle */}
      <motion.div
        animate={isActive ? {
          boxShadow: [
            '0 0 30px rgba(212,146,11,0.2), 0 0 0 0 rgba(212,146,11,0)',
            '0 0 50px rgba(212,146,11,0.4), 0 0 80px rgba(212,146,11,0.1)',
            '0 0 30px rgba(212,146,11,0.2), 0 0 0 0 rgba(212,146,11,0)',
          ]
        } : isDone ? {
          boxShadow: '0 0 30px rgba(76,175,80,0.3)'
        } : {}}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute rounded-full flex flex-col items-center justify-center"
        style={{
          inset: '28px',
          background: 'linear-gradient(135deg, rgba(212,146,11,0.08) 0%, rgba(40,34,16,0.98) 40%, rgba(200,168,78,0.06) 100%)',
          border: `1.5px solid ${isDone ? 'rgba(76,175,80,0.4)' : 'rgba(212,146,11,0.35)'}`,
          borderRadius: '50%',
        }}
      >
        {/* Brain icon */}
        <motion.div
          animate={isActive ? { scale: [1, 1.08, 1] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="flex flex-col items-center gap-1"
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{
              background: isDone
                ? 'linear-gradient(135deg, rgba(76,175,80,0.2), rgba(40,34,16,0.9))'
                : 'linear-gradient(135deg, rgba(212,146,11,0.15), rgba(200,168,78,0.15))',
            }}
          >
            {isActive ? (
              <Activity
                className="w-5 h-5 animate-pulse"
                style={{ color: '#D4920B' }}
              />
            ) : isDone ? (
              <Brain className="w-5 h-5" style={{ color: '#4CAF50' }} />
            ) : (
              <Brain className="w-5 h-5" style={{ color: 'rgba(212,146,11,0.7)' }} />
            )}
          </div>

          <span
            className="text-[9px] font-bold tracking-[0.2em] uppercase terminal-text"
            style={{ color: isDone ? '#4CAF50' : '#D4920B' }}
          >
            {isDone ? 'DONE' : 'MIND'}
          </span>

          {isActive && (
            <motion.div
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="flex items-center gap-0.5"
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ scaleY: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                  className="w-0.5 rounded-full"
                  style={{ height: '8px', background: '#D4920B' }}
                />
              ))}
            </motion.div>
          )}

          {data.subtaskCount > 0 && !isActive && (
            <span className="text-[9px] terminal-text" style={{ color: 'rgba(212,146,11,0.5)' }}>
              {data.subtaskCount} agents
            </span>
          )}
        </motion.div>
      </motion.div>

      {/* Orbital dots when active */}
      {isActive && [0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{ rotate: 360 }}
          transition={{
            duration: 3 + i * 0.8,
            repeat: Infinity,
            ease: 'linear',
            delay: i * 0.4,
          }}
          className="absolute inset-0 rounded-full"
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              top: '50%',
              left: '-3px',
              transform: 'translateY(-50%)',
              background: i === 0 ? '#D4920B' : i === 1 ? '#C8A84E' : '#4CAF50',
              boxShadow: `0 0 6px ${i === 0 ? '#D4920B' : i === 1 ? '#C8A84E' : '#4CAF50'}`,
            }}
          />
        </motion.div>
      ))}

      <Handle type="source" position={Position.Top} style={{ opacity: 0, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Left} style={{ opacity: 0, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 8, height: 8 }} />
    </motion.div>
  )
})

QueenNode.displayName = 'QueenNode'
