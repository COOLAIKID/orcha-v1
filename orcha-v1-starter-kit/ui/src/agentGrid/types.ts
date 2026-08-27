/** Agent Grid domain. Visualization reads these types, not raw runtime payloads. */

export const GRID_SYNTHETIC_LABEL = 'Demo'

export type AgentTeamId =
  | 'orchestrator'
  | 'product'
  | 'engineering'
  | 'quality'
  | 'design'
  | 'growth'
  | 'data'
  | 'business'
  /** Legacy alias retained for older Demo snapshots. */
  | 'operations'

export type AgentStatus = 'working' | 'waiting' | 'complete' | 'experiment' | 'failed'
export type HireState = 'hired' | 'proposed' | 'available'

export type CommType =
  | 'delegation'
  | 'message'
  | 'result'
  | 'revision'
  | 'tool_request'
  | 'artifact_handoff'
  | 'failure'
  | 'retry'

export type AgentTeam = {
  id: AgentTeamId
  name: string
  /** World-space cluster anchor. Orchestrator sits at origin. */
  ax: number
  ay: number
}

export type TaskAssignment = {
  title: string
  progress?: number
  deps: string[]
  blockers: string[]
}

export type ToolExecution = {
  name: string
  at: number
  summary: string
}

export type ArtifactTransfer = {
  name: string
  at: number
  fromId: string
  toId: string
}

export type AgentActivity = {
  summary: string
  at: number
  mark?: string
}

export type GridAgent = {
  id: string
  name: string
  role: string
  team: AgentTeamId
  hired?: HireState
  /** Address-like internal mailbox identity; never implies external email. */
  inboxAddress?: string
  status: AgentStatus
  task: string
  progress?: number
  model?: string
  tool?: string
  unread: boolean
  activity: string
  recentComm?: string
  artifact?: string
  blockers: string[]
  deps: string[]
  toolsCalled: ToolExecution[]
  artifacts: ArtifactTransfer[]
  timeline: AgentActivity[]
  synthetic: boolean
  createdAt: number
  visible: boolean
  kind: 'orchestrator' | 'agent' | 'tool' | 'task'
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  assignedAt?: number
  glowUntil?: number
}

export type AgentEvent = {
  id: string
  type: CommType
  sourceId: string
  destId: string
  summary: string
  task?: string
  at: number
  synthetic: boolean
}

export type AgentConnection = {
  id: string
  sourceId: string
  destId: string
  lastType: CommType
  lastSummary: string
  lastAt: number
  strength: number
}

export type GridPulse = {
  id: string
  sourceId: string
  destId: string
  type: CommType
  born: number
  ttl: number
  label?: string
}

export type DemoClock = {
  playing: boolean
  started: boolean
  step: number
  stepCount: number
}

export type GridSnapshot = {
  objective: string
  agents: GridAgent[]
  connections: AgentConnection[]
  events: AgentEvent[]
  pulses: GridPulse[]
  demo: DemoClock
  synthetic: boolean
  revision: number
}

export type RuntimeInbound =
  | {
      kind: 'objective'
      text: string
    }
  | {
      kind: 'agent.upsert'
      agent: Omit<GridAgent, 'synthetic' | 'unread' | 'toolsCalled' | 'artifacts' | 'timeline' | 'visible'> & {
        unread?: boolean
        visible?: boolean
        toolsCalled?: ToolExecution[]
        artifacts?: ArtifactTransfer[]
        timeline?: AgentActivity[]
      }
    }
  | {
      kind: 'agent.hide'
      id: string
    }
  | {
      kind: 'status'
      id: string
      status?: AgentStatus
      task?: string
      activity?: string
      progress?: number
      model?: string
      tool?: string
      artifact?: string
      blockers?: string[]
      deps?: string[]
      durationMs?: number
      inputTokens?: number
      outputTokens?: number
      checks?: { name: string; pass: boolean }[]
      mark?: string
    }
  | {
      kind: 'comm'
      type: CommType
      sourceId: string
      destId: string
      summary: string
      task?: string
      label?: string
    }
  | {
      kind: 'tool'
      id: string
      name: string
      summary: string
      ok?: boolean
      durationMs?: number
      stdoutPreview?: string
    }
  | {
      kind: 'artifact'
      fromId: string
      toId: string
      name: string
      created?: boolean
      lines?: number
      linesAdded?: number
      linesRemoved?: number
    }

export const TEAMS: Record<AgentTeamId, AgentTeam> = {
  orchestrator: { id: 'orchestrator', name: 'Orchestrator', ax: 0, ay: 0 },
  product: { id: 'product', name: 'Product', ax: -248, ay: -176 },
  engineering: { id: 'engineering', name: 'Engineering', ax: 264, ay: -22 },
  quality: { id: 'quality', name: 'Quality', ax: 118, ay: 248 },
  design: { id: 'design', name: 'Design', ax: -34, ay: -258 },
  growth: { id: 'growth', name: 'Growth', ax: -252, ay: 176 },
  data: { id: 'data', name: 'Data', ax: 266, ay: 194 },
  business: { id: 'business', name: 'Business', ax: -258, ay: -30 },
  operations: { id: 'operations', name: 'Operations', ax: -258, ay: -30 },
}

export const STATUS_COPY: Record<AgentStatus, string> = {
  working: 'Working',
  waiting: 'Waiting',
  complete: 'Complete',
  experiment: 'Experiment',
  failed: 'Failed',
}
