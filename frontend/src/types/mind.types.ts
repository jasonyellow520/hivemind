export type AgentStatus = 'idle' | 'planning' | 'running' | 'waiting_hitl' | 'completed' | 'error'

export interface BrowserTab {
  tabId: string
  title: string
  url: string
  favicon: string
  instruction: string
  assignedAgentId: string | null
}

export interface AgentState {
  agentId: string
  subtaskId: string
  taskDescription: string
  status: AgentStatus
  currentUrl: string
  stepsCompleted: number
  lastError: string | null
  result: string | null
  subtaskIndex: number
  globalIndex: number
  taskId: string | null
  logs: AgentLog[]
  tabId: string | null
}

export interface AgentLog {
  message: string
  url: string
  action: string
  timestamp: string
}

export interface HITLRequestData {
  agentId: string
  hitlId: string
  actionType: string
  actionDescription: string
  url: string
  previewHtml: string
}

export interface AgentResult {
  agentId: string
  subtaskId: string
  result: string
  stepsTaken: number
}

export interface TaskState {
  taskId: string | null
  masterTask: string
  subtaskCount: number
  status: 'idle' | 'decomposing' | 'running' | 'completed' | 'failed'
  finalResult: string | null
  agentResults: AgentResult[]
}

export interface CompletedTask {
  taskId: string
  masterTask: string
  finalResult: string
  agentResults: AgentResult[]
  completedAt: string
}

export type EventType =
  | 'TASK_ACCEPTED'
  | 'AGENT_SPAWNED'
  | 'AGENT_STATUS'
  | 'AGENT_LOG'
  | 'AGENT_COMPLETED'
  | 'AGENT_FAILED'
  | 'HITL_REQUEST'
  | 'HITL_RESOLVED'
  | 'TASK_COMPLETE'
  | 'TASK_FAILED'
  | 'VOICE_ANNOUNCEMENT'
  | 'QUEEN_COMMENTARY'
  | 'TABS_UPDATE'
  | 'IMESSAGE_RECEIVED'
  | 'IMESSAGE_SENT'
  | 'IMESSAGE_STATUS_UPDATE'
  | 'PING'

export interface WSEvent {
  type: EventType
  data: Record<string, any>
  timestamp: string
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#4b5563',
  planning: '#3b82f6',
  running: '#00d4ff',
  waiting_hitl: '#f5b942',
  completed: '#10d9a0',
  error: '#f43f5e',
}

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  planning: 'Planning',
  running: 'Running',
  waiting_hitl: 'Awaiting Approval',
  completed: 'Completed',
  error: 'Error',
}
