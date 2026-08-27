import type { AgentTeamId, RuntimeInbound } from './agentGrid/types'

export type DomainEvent = { event_type: string; sequence: number; data: Record<string, unknown> }

const ROLE_TEAMS: Record<string, AgentTeamId> = {
  product: 'product',
  research: 'product',
  design: 'design',
  engineering: 'engineering',
  qa: 'quality',
  quality: 'quality',
  growth: 'growth',
  data: 'data',
  business: 'business',
}

const TEAM_IDS = new Set<AgentTeamId>(['orchestrator', 'product', 'engineering', 'quality', 'design', 'growth', 'data', 'business', 'operations'])

function teamFromEvent(event: DomainEvent, role: string): AgentTeamId {
  const team = event.data.team
  return typeof team === 'string' && TEAM_IDS.has(team as AgentTeamId)
    ? team as AgentTeamId
    : ROLE_TEAMS[role] ?? 'business'
}

const ROLE_PHASE: Record<string, string> = {
  research: 'Researching',
  product: 'Defining the product',
  design: 'Designing',
  engineering: 'Building',
  qa: 'Testing',
  growth: 'Positioning',
  data: 'Measuring',
}

export function isRealRuntimeEvent(event: DomainEvent) {
  return (
    event.event_type.startsWith('sandbox.')
    || event.event_type.startsWith('agent.')
    || event.event_type.startsWith('task.')
    || event.event_type.startsWith('plan.')
    || event.event_type.startsWith('company.')
    || event.event_type.startsWith('preview.')
    || event.event_type.startsWith('verification.')
    ||     event.event_type.startsWith('tool.')
    || event.event_type.startsWith('command.')
    || event.event_type.startsWith('model.')
    || event.event_type.startsWith('cost.')
    || event.event_type.startsWith('recovery.')
    || event.event_type.startsWith('escalation.')
    || event.event_type === 'revision.requested'
    || event.event_type === 'file.created'
    || event.event_type === 'file.changed'
    || event.event_type === 'artifact.created'
  )
}

export function companyPreviewUrl(companyId: string) {
  return `/v1/companies/${companyId}/preview/index.html`
}

export function previewFromEvent(event: DomainEvent, companyId: string) {
  const artifact = typeof event.data.artifact === 'string' ? event.data.artifact : ''
  if (event.event_type === 'preview.ready') return companyPreviewUrl(companyId)
  if ((event.event_type === 'file.created' || event.event_type === 'artifact.created') && artifact === 'app/index.html') {
    return companyPreviewUrl(companyId)
  }
  return null
}

export function phaseFromEvent(event: DomainEvent) {
  if (event.event_type === 'plan.generated' || event.event_type === 'company.started' || event.event_type === 'company.cycle_started') return 'Planning'
  if (event.event_type === 'company.cycle_scheduled') return 'Next slice shortly'
  if (event.event_type === 'task.started' || event.event_type === 'agent.started') {
    const role = typeof event.data.role === 'string' ? event.data.role : roleFromAgent(event)
    return ROLE_PHASE[role] || 'Working'
  }
  if (event.event_type === 'revision.requested') return 'Revising'
  if (event.event_type === 'recovery.started') return event.data.recoveryType === 'qa_revision' ? 'Revising' : 'Recovering'
  if (event.event_type === 'recovery.completed') return 'Recovered'
  if (event.event_type === 'escalation.created') return 'Escalated'
  if (event.event_type === 'verification.passed') return 'Testing'
  if (event.event_type === 'preview.ready') return 'Preview ready'
  return null
}

function roleFromAgent(event: DomainEvent) {
  if (typeof event.data.role === 'string') return event.data.role
  return agentId(event).replace(/^agent_/, '').replace(/_[a-f0-9]{6,}$/i, '').replace(/_/g, ' ') || 'specialist'
}

function agentId(event: DomainEvent) {
  if (typeof event.data.agentId === 'string' && event.data.agentId === 'agent_local_engineer') return 'agent_local_engineer'
  const role = typeof event.data.role === 'string'
    ? event.data.role
    : typeof event.data.agentId === 'string'
      ? event.data.agentId.replace(/^agent_/, '').replace(/_[a-f0-9]{6,}$/i, '')
      : ''
  if (role && role !== 'orcha-runtime') return `specialist_${role}`
  if (typeof event.data.agentId === 'string' && event.data.agentId) return event.data.agentId
  return 'orcha-runtime'
}

function targetAgentId(event: DomainEvent) {
  if (typeof event.data.targetAgentId === 'string' && event.data.targetAgentId && event.data.targetAgentId !== 'orchestrator') {
    return event.data.targetAgentId
  }
  return 'orcha-runtime'
}

function summary(event: DomainEvent) {
  return typeof event.data.summary === 'string' ? event.data.summary : event.event_type.replace(/\./g, ' ')
}

function num(data: Record<string, unknown>, key: string) {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function filePulseLabel(artifact: string, added?: number, removed?: number) {
  const file = artifact.split('/').pop() || artifact
  return [
    added != null && added > 0 ? `+${added}` : '',
    removed != null && removed > 0 ? `−${removed}` : '',
    file,
  ].filter(Boolean).join(' ')
}

function bool(data: Record<string, unknown>, key: string) {
  return typeof data[key] === 'boolean' ? data[key] as boolean : undefined
}

function hireState(data: Record<string, unknown>) {
  return data.hired === 'hired' || data.hired === 'proposed' || data.hired === 'available'
    ? data.hired
    : undefined
}

function activityText(event: DomainEvent) {
  if (typeof event.data.activity === 'string' && event.data.activity) return event.data.activity
  return summary(event)
}

function upsertSpecialist(event: DomainEvent): RuntimeInbound {
  const id = agentId(event)
  const role = roleFromAgent(event)
  const title = typeof event.data.title === 'string' ? event.data.title : undefined
  return {
    kind: 'agent.upsert',
    agent: {
      id,
      name: role.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      role: `${role} specialist`,
      team: teamFromEvent(event, role),
      hired: hireState(event.data),
      inboxAddress: typeof event.data.inboxAddress === 'string' ? event.data.inboxAddress : undefined,
      status: 'waiting',
      task: title || 'Waiting for the orchestrator',
      activity: 'Available for verified company work',
      blockers: [],
      deps: Array.isArray(event.data.depends_on) ? event.data.depends_on.filter((item): item is string => typeof item === 'string') : [],
      createdAt: Date.now(),
      visible: true,
      kind: 'agent',
    },
  }
}

function orchestrator(objective: string, activity = 'Coordinating the company'): RuntimeInbound {
  return {
    kind: 'agent.upsert',
    agent: {
      id: 'orcha-runtime',
      name: 'Orcha',
      role: 'Orchestrator',
      team: 'orchestrator',
      status: 'waiting',
      task: activity,
      activity,
      blockers: [],
      deps: [],
      createdAt: Date.now(),
      visible: true,
      kind: 'orchestrator',
    },
  }
}

export function workspaceBaseAgents(objective: string): RuntimeInbound[] {
  const at = Date.now()
  return [
    { kind: 'objective', text: objective },
    orchestrator(objective, 'Waiting for a workspace task'),
    {
      kind: 'agent.upsert',
      agent: {
        id: 'agent_local_engineer',
        name: 'Workspace',
        role: 'Engineering',
        team: 'engineering',
        status: 'waiting',
        task: 'Standing by',
        activity: 'Local Workspace ready',
        blockers: [],
        deps: [],
        createdAt: at,
        visible: true,
        kind: 'agent',
      },
    },
  ]
}

export function mapRuntimeEvent(event: DomainEvent, objective: string): RuntimeInbound[] {
  const text = summary(event)
  const assignedAgent = agentId(event)
  const inbound: RuntimeInbound[] = []
  const type = event.event_type

  if (type === 'company.started' || type === 'plan.generated' || type === 'company.cycle_started') {
    inbound.push(orchestrator(objective, text))
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: 'working', task: text, activity: text, progress: 0.08 })
  }
  if (type === 'task.created') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'comm', type: 'delegation', sourceId: 'orcha-runtime', destId: assignedAgent, summary: text, task: text })
  }
  if (type === 'agent.created') inbound.push(upsertSpecialist(event))
  if (type === 'agent.started') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: text, activity: text, progress: 0.1, model: typeof event.data.model === 'string' ? event.data.model : undefined })
    inbound.push({ kind: 'comm', type: 'delegation', sourceId: 'orcha-runtime', destId: assignedAgent, summary: text, task: text })
  }
  if (type === 'agent.blocked') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'status', id: assignedAgent, status: 'waiting', task: 'Waiting for provider configuration', activity: text, blockers: ['Server-side provider configuration'] })
  }
  if (type === 'agent.status_changed') {
    inbound.push(upsertSpecialist(event))
    const status = event.data.status
    const mapped = status === 'completed' ? 'complete'
      : status === 'failed' ? 'failed'
        : status === 'blocked' || status === 'stopped' || status === 'waiting' || status === 'created' ? 'waiting'
          : 'working'
    inbound.push({
      kind: 'status',
      id: assignedAgent,
      status: mapped,
      task: text,
      activity: text,
      model: typeof event.data.model === 'string' ? event.data.model : undefined,
      tool: typeof event.data.tool === 'string' ? event.data.tool : undefined,
    })
  }
  if (type === 'agent.completed') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'status', id: assignedAgent, status: 'complete', task: 'Specialist note complete', activity: text, progress: 1 })
    inbound.push({ kind: 'comm', type: 'result', sourceId: assignedAgent, destId: 'orcha-runtime', summary: text, task: 'Specialist work note' })
  }
  if (type === 'agent.failed') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'status', id: assignedAgent, status: 'failed', task: 'Verified task failed', activity: text })
    inbound.push({ kind: 'comm', type: 'failure', sourceId: assignedAgent, destId: 'orcha-runtime', summary: text, task: text })
  }
  if (type === 'agent.message_sent') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'comm', type: 'result', sourceId: assignedAgent, destId: targetAgentId(event), summary: text, task: 'Verified agent handoff' })
  }
  if (type === 'sandbox.connected') {
    inbound.push({ kind: 'status', id: assignedAgent === 'orcha-runtime' ? 'agent_local_engineer' : assignedAgent, status: 'working', task: 'Connected to Local Workspace', activity: text, progress: 0.08 })
  }
  if (type === 'task.started') {
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: 'working', task: text, activity: text, progress: 0.12 })
    if (assignedAgent !== 'orcha-runtime') {
      inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: text, activity: text, progress: 0.22 })
      inbound.push({ kind: 'comm', type: 'delegation', sourceId: 'orcha-runtime', destId: assignedAgent, summary: text, task: text })
    }
  }
  if (type === 'tool.started' || type === 'tool.completed' || type === 'command.started' || type === 'command.completed') {
    inbound.push({
      kind: 'tool',
      id: assignedAgent,
      name: typeof event.data.tool === 'string'
        ? event.data.tool
        : typeof event.data.command === 'string'
          ? event.data.command
          : type.startsWith('command.') ? 'command' : 'workspace.write_file',
      summary: text,
      ok: type === 'tool.completed' || type === 'command.completed'
        ? event.data.ok !== false && (typeof event.data.exitCode !== 'number' || event.data.exitCode === 0)
        : undefined,
      durationMs: num(event.data, 'durationMs'),
      stdoutPreview: typeof event.data.stdout === 'string' && event.data.stdout ? event.data.stdout.slice(0, 2000) : undefined,
    })
  }
  if (type === 'tool.denied') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'failed', task: text, activity: activityText(event), mark: '×' })
  }
  if (type === 'file.created' || type === 'file.changed') {
    const artifact = typeof event.data.artifact === 'string' ? event.data.artifact : 'workspace file'
    inbound.push({
      kind: 'artifact',
      fromId: assignedAgent,
      toId: 'orcha-runtime',
      name: artifact,
      created: bool(event.data, 'created'),
      lines: num(event.data, 'lines'),
      linesAdded: num(event.data, 'linesAdded'),
      linesRemoved: num(event.data, 'linesRemoved'),
    })
    inbound.push({ kind: 'comm', type: 'artifact_handoff', sourceId: assignedAgent, destId: 'orcha-runtime', summary: text, task: 'Verified artifact', label: filePulseLabel(artifact, num(event.data, 'linesAdded'), num(event.data, 'linesRemoved')) })
    inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: activityText(event), activity: text, progress: 0.82, artifact, mark: type === 'file.created' ? '+' : '~' })
  }
  if (type === 'artifact.created') {
    inbound.push(upsertSpecialist(event))
    const artifact = typeof event.data.artifact === 'string' ? event.data.artifact : 'verified artifact'
    inbound.push({
      kind: 'artifact',
      fromId: assignedAgent,
      toId: 'orcha-runtime',
      name: artifact,
      created: bool(event.data, 'created'),
      lines: num(event.data, 'lines'),
      linesAdded: num(event.data, 'linesAdded'),
      linesRemoved: num(event.data, 'linesRemoved'),
    })
  }
  if (type === 'preview.ready') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: 'Preview ready', activity: text, progress: 0.9, artifact: 'app/index.html', mark: '✓' })
    inbound.push({ kind: 'comm', type: 'artifact_handoff', sourceId: assignedAgent, destId: 'orcha-runtime', summary: text, task: 'Preview', label: 'preview' })
  }
  if (type === 'verification.passed' || type === 'verification.skipped' || type === 'verification.failed') {
    const checks = Array.isArray(event.data.checks)
      ? event.data.checks.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as { name?: unknown; pass?: unknown }
          return typeof row.name === 'string' ? [{ name: row.name, pass: row.pass === true }] : []
        })
      : undefined
    inbound.push({
      kind: 'status',
      id: assignedAgent,
      status: type === 'verification.passed' ? 'complete' : type === 'verification.failed' ? 'failed' : 'waiting',
      task: text,
      activity: activityText(event),
      progress: type === 'verification.passed' ? 1 : type === 'verification.failed' ? 0.4 : 0.6,
      checks,
      mark: type === 'verification.passed' ? '✓' : type === 'verification.failed' ? '×' : '~',
    })
  }
  if (type === 'task.completed') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'complete', task: 'Task complete', activity: text, progress: 1, mark: '✓' })
  }
  if (type === 'task.paused') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'waiting', task: 'Task paused', activity: text, mark: '○' })
  }
  if (type === 'task.retry_requested' || type === 'task.resumed') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'waiting', task: 'Retry queued', activity: text, mark: '↻' })
    inbound.push({ kind: 'comm', type: 'retry', sourceId: 'orcha-runtime', destId: assignedAgent, summary: text, task: 'Retry', label: 'retry' })
  }
  if (type === 'task.failed') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'failed', task: 'Verified task failed', activity: text, mark: '×' })
  }
  if (type === 'revision.requested') {
    inbound.push({ kind: 'comm', type: 'revision', sourceId: 'orcha-runtime', destId: assignedAgent, summary: text, task: 'QA revision', label: 'revision' })
  }
  if (type === 'task.retry_scheduled') {
    inbound.push({ kind: 'comm', type: 'retry', sourceId: 'orcha-runtime', destId: assignedAgent, summary: text, task: 'Retry', label: 'retry' })
    inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: text, activity: text, mark: '↻' })
  }
  if (type === 'recovery.started') {
    const recoveryType = event.data.recoveryType === 'qa_revision' ? 'revision' : 'retry'
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: 'working', task: recoveryType === 'revision' ? 'Recovering with a QA revision' : 'Recovering with a bounded retry', activity: text, mark: '↻' })
    inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: recoveryType === 'revision' ? 'Revising after QA evidence' : 'Retrying after a bounded failure', activity: text, mark: '↻' })
    inbound.push({ kind: 'comm', type: recoveryType, sourceId: 'orcha-runtime', destId: assignedAgent, summary: text, task: recoveryType === 'revision' ? 'QA revision' : 'Retry', label: recoveryType })
  }
  if (type === 'recovery.completed') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'status', id: assignedAgent, status: 'complete', task: 'Recovery complete', activity: text, mark: '✓' })
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: 'working', task: 'Recovery verified', activity: text, mark: '✓' })
    inbound.push({ kind: 'comm', type: 'result', sourceId: assignedAgent, destId: 'orcha-runtime', summary: text, task: 'Recovery verified' })
  }
  if (type === 'escalation.created') {
    inbound.push(upsertSpecialist(event))
    inbound.push({ kind: 'status', id: assignedAgent, status: 'failed', task: 'Escalated', activity: text, mark: '×' })
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: 'failed', task: 'Escalated', activity: text, mark: '×' })
    inbound.push({ kind: 'comm', type: 'failure', sourceId: assignedAgent, destId: 'orcha-runtime', summary: text, task: 'Escalation' })
  }
  if (type === 'agent.stopped' || type === 'task.cancelled') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'waiting', task: 'Stopped by owner', activity: text })
  }
  if (type === 'sandbox.stopped') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'waiting', task: 'Stopped', activity: text })
  }
  if (type === 'company.run_completed') {
    const failed = event.data.status === 'failed' || event.data.status === 'stopped'
    const continuing = event.data.alwaysOn === true && !failed
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: failed ? 'failed' : continuing ? 'waiting' : 'complete', task: continuing ? 'Slice complete · continuing on this PC' : text, activity: text, progress: continuing ? 0.92 : 1 })
  }
  if (type === 'company.heartbeat') {
    inbound.push({ kind: 'status', id: 'orcha-runtime' })
  }
  if (type === 'company.cycle_scheduled') {
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: 'waiting', task: text, activity: text })
  }
  if (type === 'company.run_blocked') {
    inbound.push({ kind: 'status', id: 'orcha-runtime', status: 'waiting', task: 'Blocked', activity: text, blockers: [text] })
  }
  if (type === 'model.requested') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: activityText(event), activity: activityText(event), tool: 'model.generate', mark: '●' })
  }
  if (type === 'cost.recorded') {
    const model = [typeof event.data.provider === 'string' ? event.data.provider : '', typeof event.data.model === 'string' ? event.data.model : ''].filter(Boolean).join('/')
    inbound.push({
      kind: 'status',
      id: assignedAgent,
      status: 'working',
      task: model || text,
      activity: text,
      model: model || undefined,
      durationMs: num(event.data, 'durationMs'),
      inputTokens: num(event.data, 'inputTokens'),
      outputTokens: num(event.data, 'outputTokens'),
      mark: '✓',
    })
  }
  if (type === 'model.fallback') {
    inbound.push({ kind: 'status', id: assignedAgent, status: 'working', task: text, activity: text, mark: '↻' })
  }
  return inbound
}
