import { useEffect, useRef, useCallback } from 'react'
import { useMindStore } from './useMindStore'
import type { WSEvent, AgentStatus } from '../types/mind.types'

const WS_URL = `ws://${window.location.host}/ws`

function mapTab(t: Record<string, any>): import('../types/mind.types').BrowserTab {
  return {
    tabId: t.tab_id ?? t.tabId ?? '',
    title: t.title ?? '',
    url: t.url ?? '',
    favicon: t.favicon ?? t.faviconUrl ?? '',
    instruction: t.instruction ?? '',
    assignedAgentId: t.assigned_agent_id ?? t.assignedAgentId ?? null,
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const attemptRef = useRef(0)

  const handleEvent = useCallback((event: WSEvent) => {
    const { type, data } = event
    const store = useMindStore.getState()

    switch (type) {
      case 'TASK_ACCEPTED': {
        const taskId: string = data.task_id ?? `task-${Date.now()}`
        // Create or update this specific task entry — never clobbers other running tasks
        store.upsertTask(taskId, {
          taskId,
          masterTask: data.master_task ?? '',
          subtaskCount: data.subtask_count ?? 0,
          status: 'running',
          finalResult: null,
          agentResults: [],
        })
        store.pushFeed({
          type: 'info',
          text: `Task ${taskId} accepted · ${data.subtask_count} agents queued`,
          timestamp: event.timestamp,
        })
        break
      }

      case 'AGENT_SPAWNED': {
        const gIdx = data.global_index ?? data.subtask_index + 1
        store.addAgent(
          data.agent_id, data.task_description, data.subtask_index,
          data.tab_id ?? null, data.task_id ?? null, gIdx,
        )
        store.pushFeed({
          type: 'spawn',
          text: `Agent ${gIdx} spawned: ${data.task_description.slice(0, 50)}`,
          agentId: data.agent_id,
          timestamp: event.timestamp,
        })
        break
      }

      case 'TABS_UPDATE':
        store.setTabs((data.tabs ?? []).map(mapTab))
        break

      case 'AGENT_STATUS':
        store.updateAgentStatus(data.agent_id, data.status as AgentStatus, data.step)
        break

      case 'AGENT_LOG':
        store.addAgentLog(data.agent_id, {
          message: data.message,
          url: data.url,
          action: data.action,
          timestamp: event.timestamp,
        })
        break

      case 'AGENT_COMPLETED':
        store.completeAgent(data.agent_id, data.result, data.steps_taken)
        break

      case 'AGENT_FAILED':
        store.failAgent(data.agent_id, data.error)
        break

      case 'HITL_REQUEST':
        store.addHITL({
          agentId: data.agent_id,
          hitlId: data.hitl_id,
          actionType: data.action_type,
          actionDescription: data.action_description,
          url: data.url,
          previewHtml: data.preview_html,
        })
        break

      case 'HITL_RESOLVED':
        store.resolveHITL(data.hitl_id)
        store.pushFeed({
          type: 'info',
          text: `HITL ${data.resolution}: ${data.hitl_id}`,
          agentId: data.agent_id,
          timestamp: event.timestamp,
        })
        break

      case 'TASK_COMPLETE': {
        const agentResults = (data.agent_results || []).map((r: any) => ({
          agentId: r.agent_id ?? '',
          subtaskId: r.subtask_id ?? '',
          result: r.result ?? '',
          stepsTaken: r.steps_taken ?? 0,
        }))

        const taskId: string | null = data.task_id ?? null
        const masterTask = data.master_task || (taskId ? store.tasks[taskId]?.masterTask : null) || store.task.masterTask || ''

        store.addCompletedTask({
          taskId: taskId ?? '',
          masterTask,
          finalResult: data.final_result ?? '',
          agentResults,
          completedAt: event.timestamp,
        })

        if (taskId) {
          store.upsertTask(taskId, {
            status: 'completed',
            finalResult: data.final_result,
            agentResults,
          })
        } else {
          // Fallback: update the active task
          store.setTask({
            status: 'completed',
            finalResult: data.final_result,
            agentResults,
          })
        }

        store.pushFeed({
          type: 'complete',
          text: `Task finished · ${agentResults.length} agent(s)`,
          timestamp: event.timestamp,
        })
        break
      }

      case 'TASK_FAILED': {
        const taskId: string | null = data.task_id ?? null
        const errorMsg: string = data.error ?? 'Unknown error'

        if (taskId) {
          store.upsertTask(taskId, { status: 'failed', finalResult: null })
        } else {
          store.setTask({ status: 'failed' })
        }

        store.pushFeed({
          type: 'error',
          text: `Task failed: ${errorMsg.slice(0, 80)}`,
          timestamp: event.timestamp,
        })
        break
      }

      case 'QUEEN_COMMENTARY':
        // Show Queen reasoning inside the Neural Link panel (per-agent logs)
        // in addition to the global event feed ticker.
        if (data.agent_id && store.agents[data.agent_id]) {
          store.addAgentLog(data.agent_id, {
            message: `Queen: ${data.message ?? ''}`,
            url: '',
            action: 'queen-commentary',
            timestamp: event.timestamp,
          })
        }
        store.pushFeed({
          type: 'info',
          text: `Queen: ${data.message?.slice(0, 120) ?? ''}`,
          agentId: data.agent_id,
          timestamp: event.timestamp,
        })
        break

      case 'IMESSAGE_RECEIVED':
        store.pushFeed({
          type: 'info',
          text: `iMessage from ${data.from_phone || 'unknown'}: ${(data.text || '').slice(0, 80)}`,
          timestamp: event.timestamp,
        })
        break

      case 'IMESSAGE_SENT':
        store.pushFeed({
          type: 'info',
          text: `iMessage sent to ${data.to_phone || 'unknown'}: ${(data.text || '').slice(0, 80)}`,
          timestamp: event.timestamp,
        })
        break

      case 'IMESSAGE_STATUS_UPDATE':
        store.pushFeed({
          type: 'info',
          text: `iMessage status: ${data.status || ''} (${data.phone_number || ''})`,
          timestamp: event.timestamp,
        })
        break

      case 'VOICE_ANNOUNCEMENT':
        if (data.audio_b64) {
          store.setVoice(true, data.text)
          const audio = new Audio(`data:audio/mp3;base64,${data.audio_b64}`)
          audio.onended = () => useMindStore.getState().setVoice(false)
          audio.play().catch(() => useMindStore.getState().setVoice(false))
        }
        break

      case 'PING':
        break
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected to Mind backend')
      attemptRef.current = 0 // Reset backoff on successful connection
      useMindStore.getState().pushFeed({
        type: 'info',
        text: 'Neural link established',
        timestamp: new Date().toISOString(),
      })
      // Trigger an immediate Chrome tab scan so mindspace populates instantly
      fetch('/api/v1/tabs/scan').catch(() => {})
    }

    ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data)
        handleEvent(event)
      } catch (err) {
        console.error('[WS] Parse error:', err)
      }
    }

    ws.onclose = () => {
      const delay = Math.min(30000, 1000 * Math.pow(2, attemptRef.current))
      attemptRef.current += 1
      console.log(`[WS] Disconnected, reconnecting in ${delay}ms (attempt ${attemptRef.current})...`)
      reconnectRef.current = setTimeout(connect, delay)
    }

    ws.onerror = (err) => {
      console.error('[WS] Error:', err)
      ws.close()
    }
  }, [handleEvent])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return wsRef
}
