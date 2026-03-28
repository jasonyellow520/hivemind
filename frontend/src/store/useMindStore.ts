import { create } from 'zustand'
import type {
  AgentState, AgentLog, HITLRequestData, TaskState, AgentStatus,
  BrowserTab, AgentResult, CompletedTask,
} from '../types/mind.types'

export interface FeedEvent {
  id: string
  type: 'log' | 'hitl' | 'complete' | 'spawn' | 'error' | 'info'
  text: string
  agentId?: string
  timestamp: string
}

const SCREENSHOT_CACHE_LIMIT = 50

export type LiveVoiceState = 'listening' | 'processing' | 'speaking' | 'idle'

interface MindStore {
  agents: Record<string, AgentState>
  /** Full multi-task record, keyed by taskId */
  tasks: Record<string, TaskState>
  /** The currently viewed / most recent task id */
  activeTaskId: string | null
  /** Backward-compat computed getter — returns active task or idle placeholder */
  task: TaskState
  completedTasks: CompletedTask[]
  hitlQueue: HITLRequestData[]
  selectedAgentId: string | null
  isVoicePlaying: boolean
  voiceText: string
  /** Live voice session state */
  isLiveVoice: boolean
  liveVoiceState: LiveVoiceState
  liveTranscript: string
  tabs: BrowserTab[]
  eventFeed: FeedEvent[]
  commandHistory: string[]
  selectedTabId: string | null
  tabScreenshots: Record<string, string>

  setLiveVoice: (active: boolean, state?: LiveVoiceState, transcript?: string) => void
  /** Update or create a task entry. If taskId is omitted, updates the active task. */
  setTask: (task: Partial<TaskState>, taskId?: string) => void
  /** Create a brand-new task entry (does not clobber running tasks) */
  upsertTask: (taskId: string, partial: Partial<TaskState>) => void
  addAgent: (agentId: string, taskDescription: string, subtaskIndex: number, tabId?: string | null, taskId?: string | null, globalIndex?: number) => void
  updateAgentStatus: (agentId: string, status: AgentStatus, step?: number) => void
  addAgentLog: (agentId: string, log: AgentLog) => void
  completeAgent: (agentId: string, result: string, stepsTaken: number) => void
  failAgent: (agentId: string, error: string) => void
  killAgent: (agentId: string) => void
  addHITL: (req: HITLRequestData) => void
  resolveHITL: (hitlId: string) => void
  selectAgent: (agentId: string | null) => void
  setVoice: (playing: boolean, text?: string) => void
  setTabs: (tabs: BrowserTab[]) => void
  updateTabInstruction: (tabId: string, instruction: string) => void
  pushFeed: (event: Omit<FeedEvent, 'id'>) => void
  pushCommand: (cmd: string) => void
  setSelectedTab: (tabId: string | null) => void
  setTabScreenshot: (tabId: string, b64: string) => void
  addCompletedTask: (ct: CompletedTask) => void
  clearAgents: () => void
  reset: () => void
}

const initialTask: TaskState = {
  taskId: null,
  masterTask: '',
  subtaskCount: 0,
  status: 'idle',
  finalResult: null,
  agentResults: [],
}

let feedCounter = 0
const feedId = () => `feed-${++feedCounter}`

/** Return the computed `task` field from the current store state */
function deriveTask(tasks: Record<string, TaskState>, activeTaskId: string | null): TaskState {
  if (activeTaskId && tasks[activeTaskId]) return tasks[activeTaskId]
  const ids = Object.keys(tasks)
  if (ids.length > 0) return tasks[ids[ids.length - 1]]
  return initialTask
}

export const useMindStore = create<MindStore>((set) => ({
  agents: {},
  tasks: {},
  activeTaskId: null,
  task: initialTask,
  completedTasks: [],
  hitlQueue: [],
  selectedAgentId: null,
  isVoicePlaying: false,
  voiceText: '',
  isLiveVoice: false,
  liveVoiceState: 'idle' as LiveVoiceState,
  liveTranscript: '',
  tabs: [],
  eventFeed: [],
  commandHistory: [],
  selectedTabId: null,
  tabScreenshots: {},

  setTask: (partial, taskId) =>
    set((s) => {
      const targetId = taskId ?? s.activeTaskId
      if (targetId && s.tasks[targetId]) {
        const updated = { ...s.tasks[targetId], ...partial }
        const tasks = { ...s.tasks, [targetId]: updated }
        return {
          tasks,
          task: deriveTask(tasks, s.activeTaskId),
        }
      }
      // Fallback: update the legacy `task` field directly (e.g., before first TASK_ACCEPTED)
      const updatedTask = { ...s.task, ...partial }
      return { task: updatedTask }
    }),

  upsertTask: (taskId, partial) =>
    set((s) => {
      const existing = s.tasks[taskId] ?? {
        ...initialTask,
        taskId,
      }
      const updated = { ...existing, ...partial }
      const tasks = { ...s.tasks, [taskId]: updated }
      return {
        tasks,
        activeTaskId: taskId,
        task: deriveTask(tasks, taskId),
      }
    }),

  addAgent: (agentId, taskDescription, subtaskIndex, tabId = null, taskId = null, globalIndex = 0) =>
    set((s) => ({
      agents: {
        ...s.agents,
        [agentId]: {
          agentId,
          subtaskId: agentId.replace('worker-', ''),
          taskDescription,
          status: 'idle' as AgentStatus,
          currentUrl: '',
          stepsCompleted: 0,
          lastError: null,
          result: null,
          subtaskIndex,
          globalIndex,
          taskId,
          logs: [],
          tabId,
        },
      },
    })),

  updateAgentStatus: (agentId, status, step) =>
    set((s) => {
      const agent = s.agents[agentId]
      if (!agent) return s
      return {
        agents: {
          ...s.agents,
          [agentId]: {
            ...agent,
            status,
            stepsCompleted: step ?? agent.stepsCompleted,
          },
        },
      }
    }),

  addAgentLog: (agentId, log) =>
    set((s) => {
      const agent = s.agents[agentId]
      if (!agent) return s
      const newFeed: FeedEvent[] = [
        ...s.eventFeed,
        {
          id: feedId(),
          type: 'log' as const,
          text: log.message.slice(0, 80),
          agentId,
          timestamp: log.timestamp || new Date().toISOString(),
        },
      ].slice(-50)
      return {
        agents: {
          ...s.agents,
          [agentId]: {
            ...agent,
            logs: [...agent.logs, log],
            currentUrl: log.url || agent.currentUrl,
          },
        },
        eventFeed: newFeed,
      }
    }),

  completeAgent: (agentId, result, stepsTaken) =>
    set((s) => {
      const agent = s.agents[agentId]
      if (!agent) return s
      const label = agent.globalIndex || agent.subtaskIndex + 1
      return {
        agents: {
          ...s.agents,
          [agentId]: { ...agent, status: 'completed', result, stepsCompleted: stepsTaken },
        },
        eventFeed: [
          ...s.eventFeed,
          {
            id: feedId(),
            type: 'complete' as const,
            text: `Agent ${label} completed (${stepsTaken} steps)`,
            agentId,
            timestamp: new Date().toISOString(),
          },
        ].slice(-50),
      }
    }),

  failAgent: (agentId, error) =>
    set((s) => {
      const agent = s.agents[agentId]
      if (!agent) return s
      const label = agent.globalIndex || agent.subtaskIndex + 1
      return {
        agents: {
          ...s.agents,
          [agentId]: { ...agent, status: 'error', lastError: error },
        },
        eventFeed: [
          ...s.eventFeed,
          {
            id: feedId(),
            type: 'error' as const,
            text: `Agent ${label} failed: ${error.slice(0, 60)}`,
            agentId,
            timestamp: new Date().toISOString(),
          },
        ].slice(-50),
      }
    }),

  killAgent: (agentId) =>
    set((s) => {
      const { [agentId]: _, ...rest } = s.agents
      return {
        agents: rest,
        eventFeed: [
          ...s.eventFeed,
          {
            id: feedId(),
            type: 'error' as const,
            text: `Agent ${agentId} killed by user`,
            agentId,
            timestamp: new Date().toISOString(),
          },
        ].slice(-50),
        selectedAgentId: s.selectedAgentId === agentId ? null : s.selectedAgentId,
      }
    }),

  addHITL: (req) =>
    set((s) => ({
      hitlQueue: [...s.hitlQueue, req],
      eventFeed: [
        ...s.eventFeed,
        {
          id: feedId(),
          type: 'hitl' as const,
          text: `⚠ Agent needs approval: ${req.actionType}`,
          agentId: req.agentId,
          timestamp: new Date().toISOString(),
        },
      ].slice(-50),
    })),

  resolveHITL: (hitlId) =>
    set((s) => ({ hitlQueue: s.hitlQueue.filter((h) => h.hitlId !== hitlId) })),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  setVoice: (playing, text) =>
    set({ isVoicePlaying: playing, voiceText: text ?? '' }),

  setLiveVoice: (active, state = 'idle', transcript = '') =>
    set({ isLiveVoice: active, liveVoiceState: state, liveTranscript: transcript }),

  setTabs: (tabs) =>
    set((s) => {
      const tabIds = new Set(tabs.map((t) => t.tabId))
      // Prune agents whose tab was closed and are no longer actively running
      const activeStatuses = new Set(['running', 'planning', 'waiting_hitl'])
      const prunedAgents: Record<string, AgentState> = {}
      for (const [id, agent] of Object.entries(s.agents)) {
        const hasTab = !agent.tabId || tabIds.has(agent.tabId)
        const isActive = activeStatuses.has(agent.status)
        if (hasTab || isActive) {
          prunedAgents[id] = agent
        }
      }
      return { tabs, agents: prunedAgents }
    }),

  updateTabInstruction: (tabId, instruction) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.tabId === tabId ? { ...t, instruction } : t
      ),
    })),

  pushFeed: (event) =>
    set((s) => ({
      eventFeed: [
        ...s.eventFeed,
        { ...event, id: feedId() },
      ].slice(-50),
    })),

  pushCommand: (cmd) =>
    set((s) => ({
      commandHistory: [...s.commandHistory.filter((c) => c !== cmd), cmd].slice(-30),
    })),

  setSelectedTab: (tabId) => set({ selectedTabId: tabId }),

  setTabScreenshot: (tabId, b64) =>
    set((s) => {
      const current = s.tabScreenshots
      const updated = { ...current, [tabId]: b64 }
      const keys = Object.keys(updated)
      // LRU eviction: keep only the most recent SCREENSHOT_CACHE_LIMIT entries
      if (keys.length > SCREENSHOT_CACHE_LIMIT) {
        const toRemove = keys.slice(0, keys.length - SCREENSHOT_CACHE_LIMIT)
        for (const k of toRemove) {
          delete updated[k]
        }
      }
      return { tabScreenshots: updated }
    }),

  addCompletedTask: (ct) =>
    set((s) => ({ completedTasks: [...s.completedTasks, ct].slice(-20) })),

  clearAgents: () =>
    set({ agents: {}, selectedAgentId: null }),

  reset: () =>
    set({
      agents: {},
      tasks: {},
      activeTaskId: null,
      task: initialTask,
      hitlQueue: [],
      selectedAgentId: null,
      isVoicePlaying: false,
      voiceText: '',
      isLiveVoice: false,
      liveVoiceState: 'idle',
      liveTranscript: '',
      eventFeed: [],
    }),
}))
