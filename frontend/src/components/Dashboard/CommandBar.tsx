import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Terminal, ChevronRight, Hash, Globe, X, MessageSquare, Cpu, Clock, Mic, MicOff, GripHorizontal, Radio } from 'lucide-react'
import { useMindStore } from '../../store/useMindStore'

const SLASH_COMMANDS = [
  { cmd: '/scan', desc: 'Scan browser tabs' },
  { cmd: '/tabs', desc: 'Open tab panel' },
  { cmd: '/open', desc: 'Open a new tab [url]' },
  { cmd: '/clear', desc: 'Reset the mind' },
  { cmd: '/help', desc: 'Show available commands' },
]

const EXAMPLE_TASKS = [
  'Research the top 5 AI news stories today and compile a summary',
  'Find flight prices LHR→JFK next week, screenshot cheapest options',
  'Go to news.ycombinator.com and extract the top 10 post titles',
]

interface CommandBarProps {
  onOpenTabs?: () => void
  onOpenLogs?: () => void
}

interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
}

export function CommandBar({ onOpenTabs, onOpenLogs }: CommandBarProps) {
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyItems, setHistoryItems] = useState<{content: string; title: string}[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  // Mode removed — unified orchestrator handles classification
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [liveVoiceMessages, setLiveVoiceMessages] = useState<ChatMsg[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  // Live voice state is stored in Zustand so VoiceIndicator can read it
  const isLiveVoice = useMindStore((s) => s.isLiveVoice)
  const liveVoiceState = useMindStore((s) => s.liveVoiceState)
  const liveTranscript = useMindStore((s) => s.liveTranscript)
  const [chatHeight, setChatHeight] = useState(320)
  const chatDragRef = useRef<{ startY: number; startH: number } | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const liveVoiceWsRef = useRef<WebSocket | null>(null)
  const liveVoiceRecorderRef = useRef<MediaRecorder | null>(null)
  const lastVoiceDispatchRef = useRef<{ text: string; at: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const { task, reset, pushCommand, commandHistory } = useMindStore()
  const selectedTabId = useMindStore((s) => s.selectedTabId)
  const tabs = useMindStore((s) => s.tabs)
  const setSelectedTab = useMindStore((s) => s.setSelectedTab)
  const setLiveVoiceStore = useMindStore((s) => s.setLiveVoice)
  const selectedTab = tabs.find((t) => t.tabId === selectedTabId) ?? null

  const domain = (url: string) => { try { return new URL(url).hostname.replace('www.', '') } catch { return url } }

  const fetchHistory = useCallback(async () => {
    if (historyLoading) return
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/v1/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'recent tasks and conversations', limit: 10 }),
      })
      const data = await res.json()
      if (data.ok && data.results) {
        setHistoryItems(data.results.map((r: any) => ({
          content: r.content || r.summary || '',
          title: r.title || '',
        })).filter((r: any) => r.content))
      }
    } catch {
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }, [historyLoading])

  const toggleHistory = useCallback(() => {
    if (!showHistory) fetchHistory()
    setShowHistory((p) => !p)
  }, [showHistory, fetchHistory])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size === 0) return
        setIsTranscribing(true)
        try {
          const form = new FormData()
          form.append('file', blob, 'recording.webm')
          const res = await fetch('/api/v1/voice/transcribe', { method: 'POST', body: form })
          const data = await res.json()
          if (data.ok && data.text) {
            setInput((prev) => (prev ? prev + ' ' + data.text : data.text))
            inputRef.current?.focus()
          }
        } catch {}
        setIsTranscribing(false)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      setIsRecording(false)
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }, [])

  const toggleMic = useCallback(() => {
    if (isRecording) stopRecording()
    else startRecording()
  }, [isRecording, startRecording, stopRecording])

  const stopLiveVoice = useCallback(() => {
    if (liveVoiceRecorderRef.current) {
      try { liveVoiceRecorderRef.current.stop() } catch {}
    }
    liveVoiceRecorderRef.current = null
    if (liveVoiceWsRef.current) {
      liveVoiceWsRef.current.close()
      liveVoiceWsRef.current = null
    }
    setLiveVoiceStore(false, 'idle', '')
  }, [setLiveVoiceStore])

  const startLiveVoice = useCallback(async () => {
    try {
      setLiveVoiceMessages([])
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const wsUrl = `ws://${window.location.host}/ws/voice`
      const ws = new WebSocket(wsUrl)
      liveVoiceWsRef.current = ws

      ws.onopen = () => {
        setLiveVoiceStore(true, 'listening', '')

        // Capture raw 16-bit PCM at 16kHz for Gemini Live API
        const audioCtx = new AudioContext({ sampleRate: 16000 })
        const source = audioCtx.createMediaStreamSource(stream)
        const processor = audioCtx.createScriptProcessor(4096, 1, 1)
        source.connect(processor)
        processor.connect(audioCtx.destination)

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return
          const float32 = e.inputBuffer.getChannelData(0)
          const int16 = new Int16Array(float32.length)
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]))
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
          }
          ws.send(int16.buffer)
        }

        liveVoiceRecorderRef.current = {
          stop: () => {
            processor.disconnect()
            source.disconnect()
            audioCtx.close()
            stream.getTracks().forEach((t) => t.stop())
          },
        } as any
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'transcript') {
            const text = msg.data?.text ?? ''
            setLiveVoiceStore(true, 'listening', text)
            const role = String(msg.data?.role ?? '').toLowerCase()
            const shouldDispatchVoiceTask =
              Boolean(msg.data?.final) &&
              text.trim().length > 2 &&
              !text.trim().startsWith('(') &&
              role !== 'assistant' &&
              role !== 'model'

            if (shouldDispatchVoiceTask) {
              setLiveVoiceMessages((prev) => [...prev, { role: 'user' as const, text }].slice(-30))
              useMindStore.getState().pushFeed({
                type: 'info',
                text: `User (voice): ${text.slice(0, 160)}`,
                timestamp: new Date().toISOString(),
              })

              // Dedupe near-identical final transcripts arriving close together.
              const now = Date.now()
              const prev = lastVoiceDispatchRef.current
              if (prev && prev.text.trim().toLowerCase() === text.trim().toLowerCase() && now - prev.at < 3000) {
                return
              }
              lastVoiceDispatchRef.current = { text, at: now }

              // Voice commands bypass the text input and dispatch directly.
              void fetch('/api/v1/input/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
              })
                .then(async (res) => {
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  useMindStore.getState().pushFeed({
                    type: 'info',
                    text: `Dispatched (voice): ${text.slice(0, 60)}`,
                    timestamp: new Date().toISOString(),
                  })
                })
                .catch((err) => {
                  useMindStore.getState().pushFeed({
                    type: 'error',
                    text: `Voice dispatch failed: ${String(err).slice(0, 60)}`,
                    timestamp: new Date().toISOString(),
                  })
                })
            }
          } else if (msg.type === 'processing') {
            setLiveVoiceStore(true, 'processing', useMindStore.getState().liveTranscript)
          } else if (msg.type === 'speaking') {
            const spkText = msg.data?.text ?? ''
            setLiveVoiceStore(true, 'speaking', spkText)
            if (spkText) {
              setLiveVoiceMessages((prev) => {
                if (prev.length > 0) {
                  const last = prev[prev.length - 1]
                  if (last.role === 'assistant' && last.text === spkText) return prev
                }
                return [...prev, { role: 'assistant' as const, text: spkText }].slice(-30)
              })
            }
            // Play audio response. For PCM chunks from Live API, prefer browser
            // speech synthesis for clearer/slower output than chunk-by-chunk PCM playback.
            const audioB64 = msg.data?.audio_b64
            if (audioB64) {
              try {
                const mimeType = msg.data?.mime_type || ''
                if (mimeType.startsWith('audio/pcm')) {
                  if (spkText && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel()
                    const utter = new SpeechSynthesisUtterance(spkText)
                    utter.rate = 0.9
                    utter.pitch = 1.0
                    utter.onend = () => setLiveVoiceStore(true, 'listening', '')
                    window.speechSynthesis.speak(utter)
                  }
                } else {
                  const audio = new Audio(`data:audio/mp3;base64,${audioB64}`)
                  audio.onended = () => setLiveVoiceStore(true, 'listening', '')
                  audio.play().catch(() => {})
                }
              } catch {}
            }
            // Push to feed so user sees the response
            if (spkText) {
              useMindStore.getState().pushFeed({
                type: 'info',
                text: `Queen (voice): ${spkText.slice(0, 100)}`,
                timestamp: new Date().toISOString(),
              })
            }
          } else if (msg.type === 'done') {
            setLiveVoiceStore(true, 'listening', '')
          } else if (msg.type === 'error') {
            const errText = typeof msg.data === 'string' ? msg.data : msg.data?.text ?? 'Unknown error'
            console.error('[LiveVoice] Error:', errText)
            stopLiveVoice()
          }
        } catch {}
      }

      ws.onclose = () => {
        setLiveVoiceStore(false, 'idle', '')
        stream.getTracks().forEach((t) => t.stop())
      }

      ws.onerror = () => {
        ws.close()
        stream.getTracks().forEach((t) => t.stop())
        setLiveVoiceStore(false, 'idle', '')
      }
    } catch {
      setLiveVoiceStore(false, 'idle', '')
    }
  }, [stopLiveVoice, setLiveVoiceStore])

  const toggleLiveVoice = useCallback(() => {
    if (isLiveVoice) stopLiveVoice()
    else startLiveVoice()
  }, [isLiveVoice, startLiveVoice, stopLiveVoice])

  // Cleanup live voice on unmount
  useEffect(() => {
    return () => { stopLiveVoice() }
  }, [stopLiveVoice])

  // Listen for V-key toggle event from App.tsx keyboard shortcut
  useEffect(() => {
    const handler = () => { toggleLiveVoice() }
    window.addEventListener('mindd:toggle-live-voice', handler)
    return () => window.removeEventListener('mindd:toggle-live-voice', handler)
  }, [toggleLiveVoice])

  const onChatDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    chatDragRef.current = { startY: e.clientY, startH: chatHeight }
    const onMove = (ev: MouseEvent) => {
      if (!chatDragRef.current) return
      const delta = chatDragRef.current.startY - ev.clientY
      setChatHeight(Math.max(150, Math.min(window.innerHeight * 0.75, chatDragRef.current.startH + delta)))
    }
    const onUp = () => {
      chatDragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [chatHeight])

  const isRunning = task.status === 'running' || task.status === 'decomposing'

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // When a task completes or fails via WebSocket, show the result in the chat panel
  const taskStatus = useMindStore((s) => s.task.status)
  const taskFinalResult = useMindStore((s) => s.task.finalResult)
  const prevTaskStatusRef = useRef(taskStatus)
  useEffect(() => {
    const wasRunning = prevTaskStatusRef.current === 'running' || prevTaskStatusRef.current === 'decomposing'
    if (wasRunning && taskStatus === 'completed' && taskFinalResult) {
      setChatOpen(true)
      setChatMessages((prev) => [...prev, { role: 'assistant' as const, text: taskFinalResult }])
    } else if (wasRunning && taskStatus === 'failed') {
      setChatOpen(true)
      setChatMessages((prev) => [...prev, { role: 'assistant' as const, text: 'Task failed. Check the agent logs for details.' }])
    }
    prevTaskStatusRef.current = taskStatus
  }, [taskStatus, taskFinalResult])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveVoiceMessages])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSlashCommand = useCallback(async (cmd: string) => {
    const parts = cmd.trim().split(' ')
    const base = parts[0].toLowerCase()

    switch (base) {
      case '/scan':
        try { await fetch('/api/v1/tabs/scan') } catch {}
        break
      case '/tabs':
        onOpenTabs?.()
        break
      case '/open': {
        const url = parts.slice(1).join(' ') || 'about:blank'
        try {
          await fetch('/api/v1/tabs/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          })
          await fetch('/api/v1/tabs/scan')
          onOpenTabs?.()
        } catch {}
        break
      }
      case '/clear':
        reset()
        setChatMessages([])
        setChatOpen(false)
        break
      case '/logs':
        onOpenLogs?.()
        break
      case '/help':
        useMindStore.getState().pushFeed({
          type: 'info',
          text: 'Commands: /scan /tabs /open [url] /task /clear /logs /help',
          timestamp: new Date().toISOString(),
        })
        break
      default:
        useMindStore.getState().pushFeed({
          type: 'error',
          text: `Unknown command: ${base}. Type /help for available commands.`,
          timestamp: new Date().toISOString(),
        })
    }
  }, [onOpenTabs, onOpenLogs, reset])

  const sendChat = useCallback(async (message: string) => {
    setChatOpen(true)
    setChatMessages((prev) => [...prev, { role: 'user', text: message }])
    setIsSubmitting(true)

    try {
      // Try SSE streaming endpoint first
      const res = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Stream unavailable')
      }

      // Add empty assistant message that we'll update incrementally
      setChatMessages((prev) => [...prev, { role: 'assistant', text: '' }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullReply = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              if (parsed.text) {
                fullReply += parsed.text
                const reply = fullReply
                setChatMessages((prev) => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', text: reply }
                  return updated
                })
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      useMindStore.getState().pushFeed({
        type: 'log',
        text: `Chat: ${fullReply.slice(0, 60)}`,
        timestamp: new Date().toISOString(),
      })
    } catch {
      // Fallback to non-streaming endpoint
      try {
        const res = await fetch('/api/v1/chat/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
        const data = await res.json()
        setChatMessages((prev) => {
          // Remove empty assistant message if streaming added one, or add new
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant' && last.text === '') {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', text: data.reply || 'No response.' }
            return updated
          }
          return [...prev, { role: 'assistant', text: data.reply || 'No response.' }]
        })
        useMindStore.getState().pushFeed({
          type: 'log',
          text: `Chat: ${(data.reply || '').slice(0, 60)}`,
          timestamp: new Date().toISOString(),
        })
      } catch {
        setChatMessages((prev) => [...prev, { role: 'assistant', text: 'Connection error. Is the backend running?' }])
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [])

  const sendUnified = useCallback(async (message: string) => {
    setChatOpen(true)
    setChatMessages((prev) => [...prev, { role: 'user', text: message }])
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/v1/input/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })

      if (!res.ok || !res.body) throw new Error('Stream unavailable')

      setChatMessages((prev) => [...prev, { role: 'assistant', text: '' }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullReply = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              if (parsed.type === 'text' && parsed.text) {
                fullReply += parsed.text
                const reply = fullReply
                setChatMessages((prev) => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', text: reply }
                  return updated
                })
              } else if (parsed.type === 'task_dispatched') {
                fullReply = parsed.text || 'Working on it...'
                const reply = fullReply
                setChatMessages((prev) => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', text: reply }
                  return updated
                })
                const store = useMindStore.getState()
                store.setTask({
                  masterTask: message,
                  status: 'decomposing',
                  finalResult: null,
                  agentResults: [],
                })
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      useMindStore.getState().pushFeed({
        type: 'log',
        text: `> ${fullReply.slice(0, 60)}`,
        timestamp: new Date().toISOString(),
      })
    } catch {
      // Fallback to old chat endpoint
      try {
        const res = await fetch('/api/v1/chat/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
        const data = await res.json()
        setChatMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant' && last.text === '') {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', text: data.reply || 'No response.' }
            return updated
          }
          return [...prev, { role: 'assistant', text: data.reply || 'No response.' }]
        })
      } catch {
        setChatMessages((prev) => [...prev, { role: 'assistant', text: 'Connection error. Is the backend running?' }])
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [])

  const sendTask = useCallback(async (trimmed: string) => {
    const store = useMindStore.getState()

    // Tab-mode routing
    const curTabId = store.selectedTabId
    const curTab = curTabId ? store.tabs.find((t) => t.tabId === curTabId) ?? null : null
    if (curTabId && curTab) {
      store.updateTabInstruction(curTabId, trimmed)
      store.pushFeed({
        type: 'spawn',
        text: `Tab agent → ${domain(curTab.url)}: ${trimmed.slice(0, 50)}`,
        timestamp: new Date().toISOString(),
      })
      await fetch('/api/v1/tabs/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: [{ tab_id: curTabId, instruction: trimmed }], global_task: '' }),
      })
      store.setSelectedTab(null)
      return
    }

    setIsSubmitting(true)

    // Clear only finished agents — keep running ones alive for concurrent tasks
    const runningIds = Object.keys(store.agents).filter(
      (id) => store.agents[id].status === 'running' || store.agents[id].status === 'planning'
    )
    if (runningIds.length === 0) {
      store.clearAgents()
    }

    store.setTask({
      masterTask: trimmed,
      status: 'decomposing',
      finalResult: null,
      agentResults: [],
    })
    store.pushFeed({
      type: 'info',
      text: `> ${trimmed}`,
      timestamp: new Date().toISOString(),
    })

    try {
      await fetch('/api/v1/tasks/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: trimmed }),
      })
      store.pushFeed({
        type: 'info',
        text: `Dispatched: ${trimmed.slice(0, 60)}`,
        timestamp: new Date().toISOString(),
      })
    } catch {
      store.setTask({ status: 'failed' })
    } finally {
      setIsSubmitting(false)
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isSubmitting) return

    pushCommand(trimmed)
    setInput('')
    setHistoryIdx(-1)
    setShowSuggestions(false)

    if (trimmed.startsWith('/')) {
      await handleSlashCommand(trimmed)
      return
    }

    // Tab-selected mode still routes directly as a task to that specific tab
    if (selectedTab) {
      await sendTask(trimmed)
      return
    }

    // Everything else goes through the unified orchestrator
    await sendUnified(trimmed)
  }, [input, isSubmitting, pushCommand, handleSlashCommand, selectedTab, sendTask, sendUnified])

  const slashMatches = input.startsWith('/')
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase()))
    : []

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(historyIdx + 1, commandHistory.length - 1)
      setHistoryIdx(newIdx)
      setInput(commandHistory[commandHistory.length - 1 - newIdx] || '')
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx <= 0) { setHistoryIdx(-1); setInput(''); return }
      const newIdx = historyIdx - 1
      setHistoryIdx(newIdx)
      setInput(commandHistory[commandHistory.length - 1 - newIdx] || '')
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false)
      if (chatOpen) setChatOpen(false)
      inputRef.current?.blur()
    }
    if (e.key === 'Tab' && slashMatches.length > 0) {
      e.preventDefault()
      setInput(slashMatches[0].cmd + ' ')
    }
  }

  const modeLabel = selectedTab ? `→ ${domain(selectedTab.url)}` : 'MIND'
  const modeColor = '#00d4ff'

  return (
    <div className="relative">
      {/* Live voice popup (overlay above input) */}
      <AnimatePresence>
        {isLiveVoice && liveVoiceMessages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-0 z-45 flex flex-col"
            style={{
              height: 230,
              background: 'rgba(6,8,16,0.97)',
              borderTop: '1px solid rgba(139,92,246,0.16)',
              backdropFilter: 'blur(20px)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-1.5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2">
                <Radio className="w-3.5 h-3.5" style={{ color: '#8b5cf6' }} />
                <span className="terminal-text text-[10px]" style={{ color: 'rgba(139,92,246,0.8)' }}>
                  LIVE VOICE {liveVoiceState !== 'idle' ? `· ${liveVoiceState.toUpperCase()}` : ''}
                </span>
              </div>
              <button onClick={stopLiveVoice} title="Stop live voice">
                <X className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.3)' }} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 space-y-3 flex-1 min-h-0">
              {liveVoiceMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2"
                    style={{
                      background: msg.role === 'user'
                        ? 'rgba(139,92,246,0.14)'
                        : 'rgba(0,212,255,0.06)',
                      border: `1px solid ${msg.role === 'user' ? 'rgba(139,92,246,0.25)' : 'rgba(0,212,255,0.1)'}`,
                    }}
                  >
                    <p
                      className="text-xs leading-relaxed whitespace-pre-wrap"
                      style={{
                        color: msg.role === 'user' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.75)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {msg.text}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat panel (resizable) */}
      <AnimatePresence>
        {chatOpen && chatMessages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-0 z-40 flex flex-col"
            style={{
              height: chatHeight,
              background: 'rgba(6,8,16,0.97)',
              borderTop: '1px solid rgba(0,212,255,0.1)',
              backdropFilter: 'blur(20px)',
            }}
          >
            {/* Drag handle */}
            <div
              className="h-3 cursor-row-resize flex items-center justify-center shrink-0 hover:bg-white/5 transition-colors"
              onMouseDown={onChatDragStart}
            >
              <GripHorizontal className="w-4 h-2.5" style={{ color: 'rgba(255,255,255,0.15)' }} />
            </div>
            <div className="flex items-center justify-between px-4 py-1.5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5" style={{ color: '#00d4ff' }} />
                <span className="terminal-text text-[10px]" style={{ color: 'rgba(0,212,255,0.6)' }}>CHAT</span>
              </div>
              <button onClick={() => setChatOpen(false)} title="Close chat">
                <X className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.3)' }} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 space-y-3 flex-1 min-h-0">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2"
                    style={{
                      background: msg.role === 'user'
                        ? 'rgba(139,92,246,0.12)'
                        : 'rgba(0,212,255,0.06)',
                      border: `1px solid ${msg.role === 'user' ? 'rgba(139,92,246,0.2)' : 'rgba(0,212,255,0.1)'}`,
                    }}
                  >
                    <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{
                      color: msg.role === 'user' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.75)',
                      fontFamily: 'monospace',
                    }}>
                      {msg.text}
                    </p>
                  </div>
                </div>
              ))}
              {isSubmitting && (
                <div className="flex justify-start">
                  <motion.div
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="px-3 py-2 rounded-xl"
                    style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.1)' }}
                  >
                    <span className="terminal-text text-[10px]" style={{ color: '#00d4ff' }}>thinking...</span>
                  </motion.div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Memory history dropdown */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 right-0 mb-0 z-50 overflow-hidden"
            style={{
              maxHeight: 300,
              background: 'rgba(6,8,16,0.97)',
              borderTop: '1px solid rgba(0,212,255,0.1)',
              backdropFilter: 'blur(20px)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" style={{ color: '#00d4ff' }} />
                <span className="terminal-text text-[10px]" style={{ color: 'rgba(0,212,255,0.6)' }}>MEMORY</span>
              </div>
              <button onClick={() => setShowHistory(false)} title="Close">
                <X className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.3)' }} />
              </button>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 255 }}>
              {historyLoading && (
                <div className="px-4 py-6 text-center">
                  <motion.span
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="terminal-text text-[10px]"
                    style={{ color: '#00d4ff' }}
                  >
                    searching memories...
                  </motion.span>
                </div>
              )}
              {!historyLoading && historyItems.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <span className="terminal-text text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    No memories yet. Complete a task or chat to build history.
                  </span>
                </div>
              )}
              {!historyLoading && historyItems.map((item, i) => {
                const firstLine = item.content.split('\n')[0].replace(/^(Task:|User:)\s*/i, '')
                return (
                  <button
                    key={i}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setInput(firstLine.slice(0, 200))
                      setShowHistory(false)
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  >
                    <p className="terminal-text text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {firstLine.slice(0, 100)}
                    </p>
                    {item.title && (
                      <p className="terminal-text text-[9px] mt-0.5 truncate" style={{ color: 'rgba(0,212,255,0.4)' }}>
                        {item.title}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slash command suggestions */}
      <AnimatePresence>
        {showSuggestions && slashMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 right-0 mb-1 glass rounded-xl overflow-hidden z-50"
            style={{ border: '1px solid rgba(0,212,255,0.15)' }}
          >
            {slashMatches.map((c) => (
              <button
                key={c.cmd}
                onMouseDown={(e) => { e.preventDefault(); setInput(c.cmd + ' '); inputRef.current?.focus() }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                <Hash className="w-3 h-3 shrink-0" style={{ color: '#00d4ff' }} />
                <span className="terminal-text text-xs font-medium" style={{ color: '#00d4ff' }}>{c.cmd}</span>
                <span className="text-xs text-zinc-500">{c.desc}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Example task suggestions (idle state only) */}
      <AnimatePresence>
        {task.status === 'idle' && !input && !chatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute bottom-full left-0 mb-2 flex flex-wrap gap-1.5"
          >
            {EXAMPLE_TASKS.map((t) => (
              <button
                key={t}
                onMouseDown={(e) => { e.preventDefault(); setInput(t) }}
                className="px-2.5 py-1 rounded-lg text-[10px] terminal-text transition-all"
                style={{
                  background: 'rgba(0,212,255,0.04)',
                  border: '1px solid rgba(0,212,255,0.1)',
                  color: 'rgba(0,212,255,0.6)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0,212,255,0.08)'
                  e.currentTarget.style.borderColor = 'rgba(0,212,255,0.25)'
                  e.currentTarget.style.color = '#00d4ff'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(0,212,255,0.04)'
                  e.currentTarget.style.borderColor = 'rgba(0,212,255,0.1)'
                  e.currentTarget.style.color = 'rgba(0,212,255,0.6)'
                }}
              >
                {t.length > 42 ? t.slice(0, 42) + '...' : t}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main command input */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          background: 'rgba(10,13,22,0.95)',
          borderTop: '1px solid rgba(0,212,255,0.1)',
        }}
      >
        {/* Mode toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedTab ? (
            <div
              className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-lg"
              style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}
            >
              <Globe className="w-3 h-3" style={{ color: '#00d4ff' }} />
              <span className="terminal-text text-[10px] max-w-[100px] truncate" style={{ color: '#00d4ff' }}>
                {domain(selectedTab.url)}
              </span>
              <button onClick={() => setSelectedTab(null)} className="ml-0.5" title="Deselect tab">
                <X className="w-2.5 h-2.5" style={{ color: 'rgba(255,255,255,0.3)' }} />
              </button>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
              style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}
            >
              <Terminal className="w-3 h-3" style={{ color: '#00d4ff' }} />
              <span className="terminal-text text-[10px] font-semibold" style={{ color: '#00d4ff' }}>
                MIND
              </span>
            </div>
          )}
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="terminal-text font-bold"
            style={{ color: modeColor, fontSize: '14px' }}
          >
            ›
          </motion.span>
        </div>

        {/* Input field */}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setShowSuggestions(true)
            setHistoryIdx(-1)
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedTab
              ? `Give AI a task for ${domain(selectedTab.url)}...`
              : isRunning
                ? 'Mind is processing...'
                : 'Ask anything or give a task... (Ctrl+K)'
          }
          disabled={isSubmitting}
          className="flex-1 bg-transparent focus:outline-none terminal-text"
          style={{
            fontSize: '13px',
            color: isRunning ? 'rgba(0,212,255,0.5)' : 'rgba(255,255,255,0.9)',
            caretColor: modeColor,
          }}
        />

        {/* Hint pills */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          {isRunning && (
            <motion.span
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              className="terminal-text text-[10px] px-2 py-0.5 rounded"
              style={{ background: 'rgba(0,212,255,0.08)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.15)' }}
            >
              processing
            </motion.span>
          )}
          {!isRunning && (
            <button
              onClick={toggleHistory}
              className="terminal-text text-[9px] px-1.5 py-0.5 rounded cursor-pointer transition-all flex items-center gap-1"
              style={{
                background: showHistory ? 'rgba(0,212,255,0.1)' : 'rgba(255,255,255,0.05)',
                color: showHistory ? '#00d4ff' : 'rgba(255,255,255,0.3)',
                border: showHistory ? '1px solid rgba(0,212,255,0.25)' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <Clock className="w-2.5 h-2.5" />
              history
            </button>
          )}
        </div>

        {/* Live Voice transcript overlay */}
        {isLiveVoice && liveTranscript && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute bottom-full left-0 right-0 mb-1 px-4 py-1.5 terminal-text text-[10px] truncate"
            style={{
              background: 'rgba(6,8,16,0.9)',
              borderTop: '1px solid rgba(0,212,255,0.12)',
              color: liveVoiceState === 'speaking' ? '#8b5cf6' : '#00d4ff',
            }}
          >
            {liveVoiceState === 'speaking' ? '◀ ' : '▶ '}{liveTranscript}
          </motion.div>
        )}

        {/* Live Voice button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleLiveVoice}
          disabled={isRecording}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all relative"
          style={{
            background: isLiveVoice ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isLiveVoice ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
            color: isLiveVoice ? '#8b5cf6' : 'rgba(255,255,255,0.3)',
          }}
          title={isLiveVoice ? 'Stop live voice' : 'Start live voice session'}
        >
          {/* Pulsing ring when live */}
          {isLiveVoice && (
            <motion.div
              className="absolute inset-0 rounded-lg"
              animate={{ boxShadow: ['0 0 0 0 rgba(139,92,246,0.4)', '0 0 0 5px rgba(139,92,246,0)', '0 0 0 0 rgba(139,92,246,0.4)'] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
          )}
          <Radio className="w-3.5 h-3.5" />
        </motion.button>

        {/* Mic button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleMic}
          disabled={isTranscribing || isLiveVoice}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
          style={{
            background: isRecording ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isRecording ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`,
            color: isRecording ? '#ef4444' : 'rgba(255,255,255,0.3)',
          }}
          title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : isLiveVoice ? 'Disabled during live voice' : 'Voice input'}
        >
          {isTranscribing ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            >
              <ChevronRight className="w-4 h-4" />
            </motion.div>
          ) : isRecording ? (
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
              <MicOff className="w-3.5 h-3.5" />
            </motion.div>
          ) : (
            <Mic className="w-3.5 h-3.5" />
          )}
        </motion.button>

        {/* Submit button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSubmit}
          disabled={!input.trim() || isSubmitting}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
          style={{
            background: input.trim() ? `${modeColor}18` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${input.trim() ? `${modeColor}40` : 'rgba(255,255,255,0.08)'}`,
            color: input.trim() ? modeColor : 'rgba(255,255,255,0.2)',
          }}
        >
          {isSubmitting ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            >
              <ChevronRight className="w-4 h-4" />
            </motion.div>
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </motion.button>
      </div>
    </div>
  )
}
