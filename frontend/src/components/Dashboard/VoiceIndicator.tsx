import { motion, AnimatePresence } from 'framer-motion'
import { Volume2, Radio, Mic } from 'lucide-react'
import { useMindStore } from '../../store/useMindStore'

const LIVE_STATE_LABEL: Record<string, string> = {
  listening: 'LISTENING',
  processing: 'PROCESSING',
  speaking: 'SPEAKING',
  idle: 'LIVE',
}

const LIVE_STATE_COLOR: Record<string, string> = {
  listening: '#D4920B',
  processing: '#f5b942',
  speaking: '#C8A84E',
  idle: 'rgba(255,255,255,0.4)',
}

export function VoiceIndicator() {
  const isVoicePlaying = useMindStore((s) => s.isVoicePlaying)
  const voiceText = useMindStore((s) => s.voiceText)
  const isLiveVoice = useMindStore((s) => s.isLiveVoice)
  const liveVoiceState = useMindStore((s) => s.liveVoiceState)
  const liveTranscript = useMindStore((s) => s.liveTranscript)

  const showAnnouncement = isVoicePlaying
  const showLive = isLiveVoice && !showAnnouncement

  return (
    <AnimatePresence>
      {showAnnouncement && (
        <motion.div
          key="announcement"
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          className="fixed top-14 left-1/2 z-50 flex items-center gap-2.5 px-4 py-2 rounded-full"
          style={{
            transform: 'translateX(-50%)',
            background: 'rgba(40,34,16,0.95)',
            border: '1px solid rgba(212,146,11,0.2)',
            boxShadow: '0 0 20px rgba(212,146,11,0.15)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <Volume2 className="w-3.5 h-3.5 animate-pulse" style={{ color: '#D4920B' }} />
          <div className="flex items-center gap-0.5 h-4">
            {[1, 0.5, 0.8, 0.4, 1, 0.6, 0.9, 0.3, 0.7, 1].map((h, i) => (
              <motion.div
                key={i}
                animate={{ scaleY: [h * 0.4, h, h * 0.5, h * 0.8, h * 0.3] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.06, ease: 'easeInOut' }}
                className="w-0.5 rounded-full"
                style={{ height: '14px', transformOrigin: 'center', background: '#D4920B' }}
              />
            ))}
          </div>
          {voiceText && (
            <span className="terminal-text text-[10px] max-w-[200px] truncate" style={{ color: 'rgba(212,146,11,0.8)' }}>
              {voiceText}
            </span>
          )}
        </motion.div>
      )}

      {showLive && (
        <motion.div
          key="live-voice"
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          className="fixed top-14 left-1/2 z-50 flex items-center gap-2.5 px-4 py-2 rounded-full"
          style={{
            transform: 'translateX(-50%)',
            background: 'rgba(40,34,16,0.95)',
            border: `1px solid ${LIVE_STATE_COLOR[liveVoiceState]}40`,
            boxShadow: `0 0 20px ${LIVE_STATE_COLOR[liveVoiceState]}20`,
            backdropFilter: 'blur(20px)',
          }}
        >
          {liveVoiceState === 'listening' && (
            <motion.div animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1, repeat: Infinity }}>
              <Mic className="w-3.5 h-3.5" style={{ color: LIVE_STATE_COLOR.listening }} />
            </motion.div>
          )}
          {liveVoiceState === 'processing' && (
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
              <Radio className="w-3.5 h-3.5" style={{ color: LIVE_STATE_COLOR.processing }} />
            </motion.div>
          )}
          {liveVoiceState === 'speaking' && (
            <Volume2 className="w-3.5 h-3.5 animate-pulse" style={{ color: LIVE_STATE_COLOR.speaking }} />
          )}
          {liveVoiceState === 'idle' && (
            <Radio className="w-3.5 h-3.5" style={{ color: LIVE_STATE_COLOR.idle }} />
          )}

          <span className="terminal-text text-[9px] font-semibold tracking-widest" style={{ color: LIVE_STATE_COLOR[liveVoiceState] }}>
            {LIVE_STATE_LABEL[liveVoiceState]}
          </span>

          <div className="flex items-center gap-0.5 h-4">
            {[0.6, 0.3, 0.9, 0.5, 0.8, 0.4, 0.7].map((h, i) => (
              <motion.div
                key={i}
                animate={liveVoiceState !== 'idle'
                  ? { scaleY: [h * 0.3, h, h * 0.4, h * 0.7, h * 0.2] }
                  : { scaleY: 0.2 }}
                transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.08, ease: 'easeInOut' }}
                className="w-0.5 rounded-full"
                style={{
                  height: '12px',
                  transformOrigin: 'center',
                  background: LIVE_STATE_COLOR[liveVoiceState],
                }}
              />
            ))}
          </div>

          {liveTranscript && (
            <span className="terminal-text text-[10px] max-w-[220px] truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {liveTranscript}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
