import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMindStore } from '../../store/useMindStore'

const TYPE_COLOR: Record<string, string> = {
  log: 'rgba(212,146,11,0.5)',
  hitl: '#f5b942',
  complete: '#4CAF50',
  spawn: '#C8A84E',
  error: '#f43f5e',
  info: 'rgba(255,255,255,0.35)',
}

const TYPE_PREFIX: Record<string, string> = {
  log: '›',
  hitl: '⚠',
  complete: '✓',
  spawn: '+',
  error: '✗',
  info: '#',
}

export function EventFeed() {
  const feed = useMindStore((s) => s.eventFeed)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth
    }
  }, [feed])

  if (feed.length === 0) return null

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-3 overflow-x-auto px-4 py-1 select-none"
      style={{
        background: 'rgba(0,0,0,0.3)',
        borderTop: '1px solid rgba(212,146,11,0.06)',
        scrollbarWidth: 'none',
      }}
    >
      <style>{`.event-feed-scroll::-webkit-scrollbar { display: none; }`}</style>
      <AnimatePresence initial={false}>
        {feed.slice(-20).map((event) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="shrink-0 flex items-center gap-1.5"
          >
            <span
              className="terminal-text text-[9px] font-bold"
              style={{ color: TYPE_COLOR[event.type] || 'rgba(255,255,255,0.3)' }}
            >
              {TYPE_PREFIX[event.type] || '·'}
            </span>
            <span
              className="terminal-text text-[10px] whitespace-nowrap"
              style={{ color: TYPE_COLOR[event.type] || 'rgba(255,255,255,0.3)', opacity: 0.9 }}
            >
              {event.text}
            </span>
            {/* Separator */}
            <span style={{ color: 'rgba(255,255,255,0.08)', fontSize: '10px' }}>│</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
