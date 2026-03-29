import { useState } from 'react'
import { useMindStore } from '../../store/useMindStore'
import { Globe, Zap, X } from 'lucide-react'

interface TabGridPanelProps {
  onClose: () => void
}

export function TabGridPanel({ onClose }: TabGridPanelProps) {
  const tabs = useMindStore((s) => s.tabs)
  const tabScreenshots = useMindStore((s) => s.tabScreenshots)
  const [swarmInstruction, setSwarmInstruction] = useState('')
  const [swarmRunning, setSwarmRunning] = useState(false)

  const domain = (url: string) => {
    try {
      return new URL(url).hostname.replace('www.', '')
    } catch {
      return url
    }
  }

  const handleTabClick = (tabId: string) => {
    fetch(`/api/v1/tabs/${tabId}/activate`, { method: 'POST' }).catch(() => {})
    onClose()
  }

  const runOnAllTabs = async () => {
    const trimmed = swarmInstruction.trim()
    if (!trimmed || tabs.length === 0) return
    setSwarmRunning(true)
    try {
      await fetch('/api/v1/tabs/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: tabs.map((t) => ({ tab_id: t.tabId, instruction: trimmed })),
          global_task: '',
        }),
      })
      setSwarmInstruction('')
    } finally {
      setSwarmRunning(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'rgba(26,22,8,0.97)', backdropFilter: 'blur(20px)' }}
    >
      {/* Header */}
      <div
        className="flex flex-col shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="terminal-text text-xs text-cyan-400">GRID VIEW</span>
          <span className="text-white/20 text-xs">{tabs.length} tabs</span>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded hover:bg-white/10 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-white/30 hover:text-white/60" />
          </button>
        </div>
        {/* Run on all tabs (swarm) */}
        {tabs.length > 0 && (
          <div className="flex items-center gap-2 px-5 pb-3">
            <input
              value={swarmInstruction}
              onChange={(e) => setSwarmInstruction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runOnAllTabs()}
              placeholder="Task for all tabs (Enter to run swarm)"
              className="flex-1 bg-white/5 rounded-lg px-3 py-1.5 text-xs outline-none border border-cyan-500/20 text-white/80 placeholder-white/30"
            />
            <button
              onClick={runOnAllTabs}
              disabled={!swarmInstruction.trim() || swarmRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs terminal-text bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              title="Run this task on every tab in parallel"
            >
              <Zap className="w-3.5 h-3.5" />
              {swarmRunning ? 'Running…' : 'Run on all'}
            </button>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {tabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-white/20">
            <Globe className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm text-center">
              No tabs synced. Open Chrome with{' '}
              <span className="terminal-text text-white/30">--remote-debugging-port=9222 --remote-allow-origins=*</span>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {tabs.map((tab) => {
              const src = tabScreenshots[tab.tabId]
              const isActive = !!tab.assignedAgentId
              return (
                <div
                  key={tab.tabId}
                  onClick={() => handleTabClick(tab.tabId)}
                  className="cursor-pointer rounded-xl overflow-hidden transition-all hover:scale-[1.02]"
                  style={{
                    border: isActive
                      ? '1px solid rgba(212,146,11,0.4)'
                      : '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  {/* Screenshot */}
                  <div className="h-36 overflow-hidden bg-black/20 relative">
                    {src ? (
                      <img
                        src={src}
                        alt={tab.title}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Globe className="w-8 h-8 text-white/10" />
                      </div>
                    )}
                    {isActive && (
                      <div
                        className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded"
                        style={{
                          background: 'rgba(212,146,11,0.15)',
                          border: '1px solid rgba(212,146,11,0.3)',
                        }}
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span className="text-[9px] terminal-text text-cyan-400">AGENT</span>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-3 py-2">
                    <div className="text-xs font-medium text-white/80 truncate">
                      {tab.title || domain(tab.url)}
                    </div>
                    <div className="text-[10px] text-white/30 truncate terminal-text mt-0.5">
                      {domain(tab.url)}
                    </div>
                    {tab.instruction && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <Zap className="w-2.5 h-2.5 text-amber-400/60" />
                        <span className="text-[9px] text-amber-400/60 truncate">
                          {tab.instruction}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
