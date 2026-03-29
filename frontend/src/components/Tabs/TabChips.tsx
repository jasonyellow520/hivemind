import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, Plus, RefreshCw, X, CheckCircle } from 'lucide-react'
import { useMindStore } from '../../store/useMindStore'
import type { BrowserTab } from '../../types/mind.types'

interface TabChipsProps {
  onOpenPanel: () => void
}

export function TabChips({ onOpenPanel }: TabChipsProps) {
  const tabs = useMindStore((s) => s.tabs)
  const setTabs = useMindStore((s) => s.setTabs)
  const [isScanning, setIsScanning] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showUrlInput) inputRef.current?.focus()
  }, [showUrlInput])

  const scanAndUpdate = useCallback(async () => {
    setIsScanning(true)
    try {
      const res = await fetch('/api/v1/tabs/scan')
      const data = await res.json()
      if (data.tabs) {
        setTabs(data.tabs.map((t: any) => ({
          tabId: t.tab_id ?? t.tabId ?? '',
          title: t.title ?? '',
          url: t.url ?? '',
          favicon: t.favicon ?? '',
          instruction: t.instruction ?? '',
          assignedAgentId: t.assigned_agent_id ?? t.assignedAgentId ?? null,
        })))
      }
    } catch {}
    finally { setIsScanning(false) }
  }, [setTabs])

  const openTab = useCallback(async (url: string) => {
    let target = url.trim() || 'about:blank'
    if (target !== 'about:blank' && !target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target
    }
    try {
      await fetch('/api/v1/tabs/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      await scanAndUpdate()
    } catch {}
  }, [scanAndUpdate])

  const domain = (url: string) => {
    try { return new URL(url).hostname.replace('www.', '') }
    catch { return 'tab' }
  }

  const MAX_CHIPS = 5
  const visibleTabs = tabs.slice(0, MAX_CHIPS)
  const extraCount = tabs.length - MAX_CHIPS

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={scanAndUpdate}
        className="flex items-center gap-1 px-2 py-1 rounded-md transition-all terminal-text text-[10px]"
        style={{
          background: 'rgba(212,146,11,0.06)',
          border: '1px solid rgba(212,146,11,0.15)',
          color: 'rgba(212,146,11,0.6)',
        }}
        title="Scan browser tabs"
      >
        <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">Scan</span>
      </button>

      <AnimatePresence>
        {visibleTabs.map((tab, i) => (
          <motion.button
            key={tab.tabId}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ delay: i * 0.03 }}
            onClick={onOpenPanel}
            className="flex items-center gap-1 px-2 py-1 rounded-md transition-all terminal-text text-[10px] max-w-[100px]"
            style={{
              background: tab.instruction ? 'rgba(212,146,11,0.08)' : 'rgba(255,255,255,0.04)',
              border: tab.instruction ? '1px solid rgba(212,146,11,0.2)' : '1px solid rgba(255,255,255,0.08)',
              color: tab.instruction ? '#D4920B' : 'rgba(255,255,255,0.4)',
            }}
            title={tab.title || tab.url}
          >
            {tab.instruction ? (
              <CheckCircle className="w-2.5 h-2.5 shrink-0" />
            ) : (
              <Globe className="w-2.5 h-2.5 shrink-0" style={{ opacity: 0.5 }} />
            )}
            <span className="truncate">
              {tab.title ? tab.title.slice(0, 10) : domain(tab.url).slice(0, 10)}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>

      {extraCount > 0 && (
        <button
          onClick={onOpenPanel}
          className="px-2 py-1 rounded-md terminal-text text-[10px]"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.3)',
          }}
        >
          +{extraCount}
        </button>
      )}

      {/* New tab: inline URL popover */}
      <div className="relative">
        <button
          onClick={() => setShowUrlInput((p) => !p)}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
          style={{
            background: showUrlInput ? 'rgba(212,146,11,0.12)' : 'rgba(255,255,255,0.04)',
            border: showUrlInput ? '1px solid rgba(212,146,11,0.3)' : '1px solid rgba(255,255,255,0.08)',
            color: showUrlInput ? '#D4920B' : 'rgba(255,255,255,0.3)',
          }}
          title="Open new tab"
        >
          {showUrlInput ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
        </button>
        <AnimatePresence>
          {showUrlInput && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              className="absolute right-0 top-full mt-1 z-50 flex items-center gap-1 p-1.5 rounded-lg"
              style={{
                background: 'rgba(40,34,16,0.97)',
                border: '1px solid rgba(212,146,11,0.2)',
                backdropFilter: 'blur(20px)',
                minWidth: 280,
              }}
            >
              <input
                ref={inputRef}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    openTab(newUrl)
                    setNewUrl('')
                    setShowUrlInput(false)
                  }
                  if (e.key === 'Escape') {
                    setShowUrlInput(false)
                    setNewUrl('')
                  }
                }}
                placeholder="Enter URL (e.g. google.com)"
                className="flex-1 px-2.5 py-1.5 rounded-md terminal-text text-[11px] focus:outline-none"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(212,146,11,0.15)',
                  color: 'white',
                }}
              />
              <button
                onClick={() => {
                  openTab(newUrl)
                  setNewUrl('')
                  setShowUrlInput(false)
                }}
                className="px-2.5 py-1.5 rounded-md terminal-text text-[10px] shrink-0"
                style={{
                  background: 'rgba(212,146,11,0.12)',
                  border: '1px solid rgba(212,146,11,0.25)',
                  color: '#D4920B',
                }}
              >
                Open
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
