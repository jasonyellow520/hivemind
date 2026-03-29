import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Globe, RefreshCw, Play, Plus, Pencil, ExternalLink,
  Layers, Zap, X, CheckCircle, Navigation, Trash2,
  Wifi, WifiOff, Camera
} from 'lucide-react'
import { useMindStore } from '../../store/useMindStore'
import type { BrowserTab } from '../../types/mind.types'

interface TabPanelProps {
  onClose: () => void
}

export function TabPanel({ onClose }: TabPanelProps) {
  const tabs = useMindStore((s) => s.tabs)
  const updateTabInstruction = useMindStore((s) => s.updateTabInstruction)
  const setTabs = useMindStore((s) => s.setTabs)
  const taskStatus = useMindStore((s) => s.task.status)
  const [globalTask, setGlobalTask] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [cdpConnected, setCdpConnected] = useState(false)
  const [openUrl, setOpenUrl] = useState('')

  const scanTabs = useCallback(async () => {
    setIsScanning(true)
    try {
      const res = await fetch('/api/v1/tabs/scan')
      const data = await res.json()
      setCdpConnected(data.cdp_connected || false)
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

  // Auto-scan when panel opens
  useEffect(() => {
    scanTabs()
  }, [])

  const openNewTab = useCallback(async () => {
    let url = openUrl.trim() || 'about:blank'
    if (url !== 'about:blank' && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    try {
      await fetch('/api/v1/tabs/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      setOpenUrl('')
      await scanTabs()
    } catch {}
  }, [openUrl, scanTabs])

  const closeTab = useCallback(async (tabId: string) => {
    try {
      await fetch(`/api/v1/tabs/${tabId}`, { method: 'DELETE' })
      await scanTabs()
    } catch {}
  }, [scanTabs])

  const navigateTab = useCallback(async (tabId: string, url: string) => {
    if (!url.trim()) return
    try {
      await fetch(`/api/v1/tabs/${tabId}/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
    } catch {}
  }, [])

  const executeTab = useCallback(async (tabId: string, instruction: string) => {
    if (!instruction.trim()) return
    await fetch('/api/v1/tabs/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions: [{ tab_id: tabId, instruction }], global_task: '' }),
    })
  }, [])

  const executeAll = useCallback(async () => {
    const withInstructions = tabs.filter((t) => t.instruction.trim())
    if (withInstructions.length === 0) return
    setIsExecuting(true)
    try {
      await fetch('/api/v1/tabs/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: withInstructions.map((t) => ({
            tab_id: t.tabId,
            instruction: t.instruction,
          })),
          global_task: globalTask,
        }),
      })
    } catch {}
    finally { setIsExecuting(false) }
  }, [tabs, globalTask])

  const tabsWithInstructions = tabs.filter((t) => t.instruction.trim())

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
        borderLeft: '1px solid rgba(212,146,11,0.1)',
        zIndex: 40,
      }}
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 flex items-center justify-between"
           style={{ borderBottom: '1px solid rgba(212,146,11,0.08)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
               style={{ background: 'rgba(212,146,11,0.1)', border: '1px solid rgba(212,146,11,0.2)' }}>
            <Layers className="w-3.5 h-3.5" style={{ color: '#D4920B' }} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-white">Browser Tabs</span>
              {/* CDP status */}
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 rounded terminal-text text-[8px]"
                style={{
                  background: cdpConnected ? 'rgba(76,175,80,0.08)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${cdpConnected ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.08)'}`,
                  color: cdpConnected ? '#4CAF50' : 'rgba(255,255,255,0.3)',
                }}
                title={cdpConnected ? 'Connected to your Chrome browser' : 'Using managed browser. Launch Chrome with --remote-debugging-port=9222 --remote-allow-origins=* to connect to your existing browser.'}
              >
                {cdpConnected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                {cdpConnected ? 'Live' : 'Managed'}
              </div>
            </div>
            <p className="terminal-text text-[9px]" style={{ color: 'rgba(212,146,11,0.5)' }}>
              {tabs.length} open · {tabsWithInstructions.length} queued
            </p>
          </div>
        </div>
        <button onClick={onClose} className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ color: 'rgba(255,255,255,0.3)' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* CDP hint (if not connected) */}
      {!cdpConnected && (
        <div className="shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg"
             style={{ background: 'rgba(212,146,11,0.04)', border: '1px solid rgba(212,146,11,0.1)' }}>
          <p className="terminal-text text-[9px] leading-relaxed" style={{ color: 'rgba(212,146,11,0.5)' }}>
            💡 To control your real Chrome tabs, launch Chrome with:<br/>
            <span style={{ color: 'rgba(212,146,11,0.7)' }}>--remote-debugging-port=9222 --remote-allow-origins=*</span>
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="shrink-0 px-3 py-2 flex items-center gap-2"
           style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <button
          onClick={scanTabs}
          disabled={isScanning}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-50"
          style={{ background: 'rgba(212,146,11,0.06)', border: '1px solid rgba(212,146,11,0.15)', color: 'rgba(212,146,11,0.7)' }}
        >
          <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
          Scan
        </button>
        <div className="flex-1 flex items-center gap-1">
          <input
            value={openUrl}
            onChange={(e) => setOpenUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && openNewTab()}
            placeholder="URL or blank"
            className="flex-1 px-2 py-1.5 rounded-lg terminal-text text-[10px] focus:outline-none min-w-0"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'white',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'rgba(212,146,11,0.25)' }}
            onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.08)' }}
          />
          <button
            onClick={openNewTab}
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all"
            style={{ background: 'rgba(212,146,11,0.08)', border: '1px solid rgba(212,146,11,0.15)', color: '#D4920B' }}
            title="Open new tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tabs.length === 0 ? (
          <div className="py-12 text-center">
            <Globe className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(212,146,11,0.15)' }} />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>No tabs detected</p>
            <button
              onClick={scanTabs}
              className="mt-2 px-3 py-1.5 rounded-lg terminal-text text-[10px] transition-all"
              style={{ background: 'rgba(212,146,11,0.06)', border: '1px solid rgba(212,146,11,0.15)', color: 'rgba(212,146,11,0.7)' }}
            >
              Scan Now
            </button>
          </div>
        ) : (
          tabs.map((tab) => (
            <TabCard
              key={tab.tabId}
              tab={tab}
              onInstructionChange={(val) => updateTabInstruction(tab.tabId, val)}
              onClose={() => closeTab(tab.tabId)}
              onNavigate={(url) => navigateTab(tab.tabId, url)}
              onExecute={() => executeTab(tab.tabId, tab.instruction)}
            />
          ))
        )}
      </div>

      {/* Execute section */}
      {tabs.length > 0 && (
        <div className="shrink-0 p-3 space-y-2"
             style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <input
            type="text"
            value={globalTask}
            onChange={(e) => setGlobalTask(e.target.value)}
            placeholder="Global context for all tab agents..."
            className="w-full px-3 py-2 rounded-lg terminal-text text-xs focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
            onFocus={(e) => { e.target.style.borderColor = 'rgba(212,146,11,0.25)' }}
            onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.08)' }}
          />
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={executeAll}
            disabled={tabsWithInstructions.length === 0 || isExecuting || taskStatus === 'running'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, rgba(212,146,11,0.12), rgba(200,168,78,0.12))',
              border: '1px solid rgba(212,146,11,0.25)',
              color: '#D4920B',
            }}
          >
            {isExecuting ? (
              <Zap className="w-3.5 h-3.5 animate-pulse" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Run {tabsWithInstructions.length} Tab{tabsWithInstructions.length !== 1 ? 's' : ''} in Parallel
          </motion.button>
        </div>
      )}
    </motion.div>
  )
}


function TabCard({
  tab,
  onInstructionChange,
  onClose,
  onNavigate,
  onExecute,
}: {
  tab: BrowserTab
  onInstructionChange: (val: string) => void
  onClose: () => void
  onNavigate: (url: string) => void
  onExecute: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [navUrl, setNavUrl] = useState('')
  const [showNav, setShowNav] = useState(false)

  const domain = (() => {
    try { return new URL(tab.url).hostname.replace('www.', '') }
    catch { return tab.url }
  })()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      layout
      className="rounded-xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: tab.instruction ? '1px solid rgba(212,146,11,0.15)' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="p-3">
        {/* Tab header */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"
               style={{ background: 'rgba(255,255,255,0.06)' }}>
            {tab.instruction
              ? <CheckCircle className="w-3 h-3" style={{ color: '#D4920B' }} />
              : <Globe className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.3)' }} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-white truncate">{tab.title || 'Untitled'}</p>
            <div className="flex items-center gap-1">
              <span className="terminal-text text-[9px]" style={{ color: 'rgba(212,146,11,0.4)' }}>
                {domain}
              </span>
              {tab.url !== 'about:blank' && (
                <a href={tab.url} target="_blank" rel="noopener noreferrer"
                   style={{ color: 'rgba(255,255,255,0.2)' }}>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setShowNav(!showNav)}
              title="Navigate to URL"
              className="w-5 h-5 rounded flex items-center justify-center transition-all"
              style={{ color: showNav ? '#D4920B' : 'rgba(255,255,255,0.2)' }}
            >
              <Navigation className="w-3 h-3" />
            </button>
            <button
              onClick={onClose}
              title="Close tab"
              className="w-5 h-5 rounded flex items-center justify-center transition-all"
              style={{ color: 'rgba(244,63,94,0.4)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#f43f5e' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(244,63,94,0.4)' }}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Navigate input (collapsible) */}
        <AnimatePresence>
          {showNav && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-2 overflow-hidden"
            >
              <div className="flex gap-1">
                <input
                  value={navUrl}
                  onChange={(e) => setNavUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { onNavigate(navUrl); setNavUrl(''); setShowNav(false) }
                    if (e.key === 'Escape') setShowNav(false)
                  }}
                  placeholder="https://..."
                  autoFocus
                  className="flex-1 px-2 py-1 rounded-md terminal-text text-[10px] focus:outline-none"
                  style={{
                    background: 'rgba(212,146,11,0.06)',
                    border: '1px solid rgba(212,146,11,0.2)',
                    color: 'white',
                  }}
                />
                <button
                  onClick={() => { onNavigate(navUrl); setNavUrl(''); setShowNav(false) }}
                  className="px-2 py-1 rounded-md text-[10px] transition-all"
                  style={{ background: 'rgba(212,146,11,0.1)', color: '#D4920B', border: '1px solid rgba(212,146,11,0.2)' }}
                >
                  Go
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Instruction textarea */}
        <textarea
          value={tab.instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onExecute()
            }
          }}
          placeholder="What should the agent do on this tab?  (Enter to run)"
          rows={isEditing ? 3 : 1}
          className="w-full px-2.5 py-1.5 rounded-lg terminal-text resize-none focus:outline-none transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: isEditing ? '1px solid rgba(212,146,11,0.2)' : '1px solid rgba(255,255,255,0.06)',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.8)',
          }}
        />
      </div>
    </motion.div>
  )
}
