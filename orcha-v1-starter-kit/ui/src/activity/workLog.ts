import type { DomainEvent } from '../runtimeEvents.ts'
import { motionReduced } from '../workspace.ts'

export type WorkMark = '+' | '-' | '~' | '✓' | '×' | '↻' | '→' | '←' | '↑' | '↓' | '○' | '●'

export type WorkChannel = 'agents' | 'files' | 'models' | 'tools' | 'tests' | 'messages'

export type WorkCheck = { name: string; pass: boolean }

export type WorkLine = {
  id: string
  at: number
  mark: WorkMark
  text: string
  channel: WorkChannel
  agentId?: string
  role?: string
  path?: string
  linesAdded?: number
  linesRemoved?: number
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  stdoutPreview?: string
  checks?: WorkCheck[]
  freshUntil: number
  synthetic: boolean
}

export type RoleProgress = {
  role: string
  name: string
  mark: WorkMark
  activity: string
  status: 'waiting' | 'working' | 'complete' | 'failed'
  artifact?: string
}

export type WorkAggregates = {
  agentsCreated?: number
  agentsWorking?: number
  tasksComplete?: number
  tasksTotal?: number
  filesAdded?: number
  filesChanged?: number
  linesAdded?: number
  linesRemoved?: number
  checksPassed?: number
  checksFailed?: number
  artifacts?: number
  previews?: number
  modelRequests?: number
  startedAt?: number
}

export type WorkSnapshot = {
  lines: WorkLine[]
  roles: RoleProgress[]
  aggregates: WorkAggregates
  previewReady: boolean
  previewFreshUntil: number
  beatUntil: number
  headline: string
  revision: number
}

export const FRESH_MS = 4000
const MAX_LINES = 400
const ROLE_ORDER = ['orchestrator', 'research', 'product', 'design', 'engineering', 'qa', 'growth', 'data']

const ROLE_NAME: Record<string, string> = {
  orchestrator: 'Orcha',
  research: 'Research',
  product: 'Product',
  design: 'Design',
  engineering: 'Engineering',
  qa: 'QA',
  growth: 'Growth',
  data: 'Data',
}

function now() {
  return Date.now()
}

function emptySnap(revision = 0): WorkSnapshot {
  return {
    lines: [],
    roles: [],
    aggregates: {},
    previewReady: false,
    previewFreshUntil: 0,
    beatUntil: 0,
    headline: 'Planning',
    revision,
  }
}

function str(data: Record<string, unknown>, key: string) {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}

function num(data: Record<string, unknown>, key: string) {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function roleOf(event: DomainEvent) {
  const role = str(event.data, 'role')
  if (role) return role
  const agentId = str(event.data, 'agentId')
  if (agentId.startsWith('specialist_')) return agentId.slice('specialist_'.length)
  if (agentId.startsWith('agent_')) return agentId.replace(/^agent_/, '').replace(/_[a-f0-9]{6,}$/i, '')
  return ''
}

function agentOf(event: DomainEvent) {
  const id = str(event.data, 'agentId')
  return id || undefined
}

function summaryOf(event: DomainEvent) {
  return str(event.data, 'summary') || event.event_type.replace(/\./g, ' ')
}

function activityOf(event: DomainEvent) {
  return str(event.data, 'activity') || summaryOf(event)
}

function checksOf(event: DomainEvent): WorkCheck[] | undefined {
  const raw = event.data.checks
  if (!Array.isArray(raw) || !raw.length) return undefined
  const checks = raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { name?: unknown; pass?: unknown }
    if (typeof row.name !== 'string') return []
    return [{ name: row.name, pass: row.pass === true }]
  })
  return checks.length ? checks : undefined
}

function markColorRole(status: RoleProgress['status']): WorkMark {
  if (status === 'working') return '●'
  if (status === 'complete') return '✓'
  if (status === 'failed') return '×'
  return '○'
}

class WorkLog {
  private lines: WorkLine[] = []
  private roles = new Map<string, RoleProgress>()
  private aggregates: WorkAggregates = {}
  private working = new Set<string>()
  private previewReady = false
  private previewFreshUntil = 0
  private beatUntil = 0
  private headline = 'Planning'
  private revision = 0
  private seq = 0
  private snapshot: WorkSnapshot = emptySnap()
  private listeners = new Set<() => void>()
  private pending: DomainEvent[] = []
  private timer = 0
  private raf = 0
  private scheduled = false

  subscribe = (listen: () => void) => {
    this.listeners.add(listen)
    return () => {
      this.listeners.delete(listen)
    }
  }

  getSnapshot = (): WorkSnapshot => this.snapshot

  reset() {
    this.clearSchedule()
    this.pending = []
    this.lines = []
    this.roles.clear()
    this.aggregates = {}
    this.working.clear()
    this.previewReady = false
    this.previewFreshUntil = 0
    this.beatUntil = 0
    this.headline = 'Planning'
    this.seq = 0
    this.publish()
  }

  beginRun() {
    const at = now()
    this.aggregates.startedAt = at
    this.headline = 'Planning'
    this.beatUntil = motionReduced() ? at : at + FRESH_MS
    this.working.add('orcha-runtime')
    this.aggregates.agentsWorking = 1
    this.setRole('orchestrator', 'working', 'Planning this company on this PC')
    this.lines = [{
      id: `w-${++this.seq}`,
      at,
      mark: '●' as const,
      text: 'Planning this company on this PC',
      channel: 'agents' as const,
      role: 'orchestrator',
      agentId: 'orcha-runtime',
      freshUntil: motionReduced() ? at : at + FRESH_MS,
      synthetic: false,
    }, ...this.lines].slice(0, MAX_LINES)
    this.publish()
  }

  seedTasks(tasks: Array<{ role: string; title?: string }>) {
    for (const task of tasks) {
      if (!task.role || this.roles.has(task.role)) continue
      this.apply({
        event_type: 'task.created',
        sequence: 0,
        data: { role: task.role, title: task.title || '', summary: `Queued ${task.role}` },
      })
    }
    this.publish()
  }

  ingest(event: DomainEvent, immediate = false) {
    if (immediate) {
      this.apply(event)
      this.publish()
      return
    }
    this.pending.push(event)
    this.schedule()
  }

  ingestMany(events: DomainEvent[], immediate = false) {
    if (immediate) {
      for (const event of events) this.apply(event)
      this.publish()
      return
    }
    this.pending.push(...events)
    this.schedule()
  }

  flush() {
    this.clearSchedule()
    const batch = this.pending
    this.pending = []
    if (!batch.length) return
    for (const event of batch) this.apply(event)
    this.publish()
  }

  private schedule() {
    if (this.scheduled) return
    this.scheduled = true
    const run = () => {
      this.scheduled = false
      this.flush()
    }
    if (typeof requestAnimationFrame === 'function') {
      this.raf = requestAnimationFrame(run)
    }
    this.timer = setTimeout(run, 50) as unknown as number
  }

  private clearSchedule() {
    this.scheduled = false
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf)
    if (this.timer) clearTimeout(this.timer)
    this.raf = 0
    this.timer = 0
  }

  private apply(event: DomainEvent) {
    const at = now()
    const freshUntil = motionReduced() ? at : at + FRESH_MS
    const role = roleOf(event)
    const type = event.event_type
    const text = summaryOf(event)
    const activity = activityOf(event)
    const path = str(event.data, 'artifact') || str(event.data, 'path')
    const linesAdded = num(event.data, 'linesAdded')
    const linesRemoved = num(event.data, 'linesRemoved')
    const durationMs = num(event.data, 'durationMs')
    const inputTokens = num(event.data, 'inputTokens')
    const outputTokens = num(event.data, 'outputTokens')
    const checks = checksOf(event)
    const stdout = str(event.data, 'stdout')
    const line = (mark: WorkMark, channel: WorkChannel, body: string, extra: Partial<WorkLine> = {}): WorkLine => ({
      id: `w-${++this.seq}`,
      at,
      mark,
      text: body,
      channel,
      agentId: agentOf(event),
      role: role || undefined,
      path: path || undefined,
      linesAdded,
      linesRemoved,
      durationMs,
      inputTokens,
      outputTokens,
      stdoutPreview: stdout ? stdout.slice(0, 2000) : undefined,
      checks,
      freshUntil,
      synthetic: false,
      ...extra,
    })

    if (type === 'company.started' || type === 'plan.generated' || type === 'company.cycle_started') {
      this.headline = type === 'plan.generated' ? 'Planning' : text
      if (!this.aggregates.startedAt) this.aggregates.startedAt = at
      const alreadyPlanning = this.lines.some((line) => line.text === 'Planning this company on this PC')
      if (!(type === 'company.started' && alreadyPlanning)) this.push(line('●', 'agents', text))
    }
    if (type === 'task.created') {
      const existed = Boolean(role && this.roles.has(role))
      if (!existed) this.aggregates.tasksTotal = (this.aggregates.tasksTotal ?? 0) + 1
      if (role) this.ensureRole(role, 'waiting', activity)
      if (!existed) this.push(line('○', 'agents', text))
    }
    if (type === 'agent.created') {
      this.aggregates.agentsCreated = (this.aggregates.agentsCreated ?? 0) + 1
      if (role) this.ensureRole(role, 'waiting', activity)
      this.push(line('○', 'agents', `${ROLE_NAME[role] || role || 'Specialist'} joined`))
    }
    if (type === 'agent.started' || type === 'task.started') {
      if (role) this.setRole(role, 'working', activity)
      const id = agentOf(event)
      if (id) this.working.add(id)
      this.aggregates.agentsWorking = this.working.size
      this.headline = ROLE_NAME[role] ? `${ROLE_NAME[role]} working` : 'Working'
      this.push(line('●', 'agents', activity))
    }
    if (type === 'agent.status_changed') {
      const status = str(event.data, 'status')
      if (role) {
        const mapped = status === 'completed' ? 'complete' : status === 'failed' ? 'failed' : status === 'blocked' || status === 'stopped' || status === 'waiting' || status === 'created' ? 'waiting' : 'working'
        this.setRole(role, mapped, activity)
      }
      const id = agentOf(event)
      if (id && (status === 'completed' || status === 'failed' || status === 'blocked' || status === 'stopped' || status === 'waiting' || status === 'created')) this.working.delete(id)
      else if (id && status !== 'thinking') this.working.add(id)
      this.aggregates.agentsWorking = this.working.size || undefined
    }
    if (type === 'model.requested') {
      this.aggregates.modelRequests = (this.aggregates.modelRequests ?? 0) + 1
      this.push(line('●', 'models', activity || 'Requesting a model'))
    }
    if (type === 'cost.recorded') {
      const model = [str(event.data, 'provider'), str(event.data, 'model')].filter(Boolean).join('/')
      const bits = [model || 'Model']
      if (durationMs != null) bits.push(`✓ ${(durationMs / 1000).toFixed(1)}s`)
      if (inputTokens != null) bits.push(`${formatTokens(inputTokens)} in`)
      if (outputTokens != null) bits.push(`${formatTokens(outputTokens)} out`)
      this.push(line('✓', 'models', bits.join(' · ')))
    }
    if (type === 'model.fallback') {
      this.push(line('↻', 'models', text))
    }
    if (type === 'tool.started') {
      this.push(line('●', 'tools', activity || text))
    }
    if (type === 'tool.completed') {
      const ok = event.data.ok !== false
      this.push(line(ok ? '✓' : '×', 'tools', text, { stdoutPreview: stdout ? stdout.slice(0, 2000) : undefined }))
    }
    if (type === 'tool.denied') {
      this.push(line('×', 'tools', text))
    }
    if (type === 'command.started') {
      const command = str(event.data, 'command')
      if (role) this.setRole(role, 'working', activity || text)
      this.push(line('●', 'tools', command ? `$ ${command}` : text))
    }
    if (type === 'command.completed') {
      const exitCode = num(event.data, 'exitCode')
      const ok = event.data.ok !== false && (exitCode == null || exitCode === 0)
      if (role) this.setRole(role, 'working', activity || text)
      this.push(line(ok ? '✓' : '×', 'tools', text, { stdoutPreview: stdout ? stdout.slice(0, 2000) : undefined }))
    }
    if (type === 'file.created' || type === 'file.changed') {
      if (type === 'file.created') this.aggregates.filesAdded = (this.aggregates.filesAdded ?? 0) + 1
      else this.aggregates.filesChanged = (this.aggregates.filesChanged ?? 0) + 1
      if (linesAdded != null) this.aggregates.linesAdded = (this.aggregates.linesAdded ?? 0) + linesAdded
      if (linesRemoved != null) this.aggregates.linesRemoved = (this.aggregates.linesRemoved ?? 0) + linesRemoved
      const mark: WorkMark = type === 'file.created' || (linesAdded ?? 0) >= (linesRemoved ?? 0) ? '+' : '-'
      const delta = [
        path || 'file',
        linesAdded != null ? `+${linesAdded}` : '',
        linesRemoved != null && linesRemoved > 0 ? `-${linesRemoved}` : '',
      ].filter(Boolean).join(' ')
      if (role) this.setRole(role, 'working', `${mark} ${path || 'file'}`)
      this.push(line(mark, 'files', delta))
    }
    if (type === 'artifact.created') {
      this.aggregates.artifacts = (this.aggregates.artifacts ?? 0) + 1
      if (role && path) this.setRole(role, this.roles.get(role)?.status === 'complete' ? 'complete' : 'working', path, path)
      this.push(line('→', 'files', path || text))
    }
    if (type === 'preview.ready') {
      this.aggregates.previews = (this.aggregates.previews ?? 0) + 1
      this.previewReady = true
      this.previewFreshUntil = freshUntil
      this.headline = 'Preview ready'
      this.push(line('✓', 'files', 'Preview ready'))
    }
    if (type === 'verification.passed' || type === 'verification.skipped' || type === 'verification.failed') {
      if (checks) {
        for (const check of checks) {
          if (check.pass) this.aggregates.checksPassed = (this.aggregates.checksPassed ?? 0) + 1
          else this.aggregates.checksFailed = (this.aggregates.checksFailed ?? 0) + 1
        }
      }
      const mark: WorkMark = type === 'verification.passed' ? '✓' : type === 'verification.failed' ? '×' : '~'
      if (role) this.setRole(role, type === 'verification.passed' ? 'complete' : type === 'verification.failed' ? 'failed' : 'waiting', activity)
      this.headline = type === 'verification.passed' ? 'Testing' : this.headline
      this.push(line(mark, 'tests', text, { checks }))
    }
    if (type === 'task.completed' || type === 'agent.completed') {
      if (type === 'task.completed') this.aggregates.tasksComplete = (this.aggregates.tasksComplete ?? 0) + 1
      if (role) this.setRole(role, 'complete', activity)
      const id = agentOf(event)
      if (id) this.working.delete(id)
      this.aggregates.agentsWorking = this.working.size || undefined
      this.push(line('✓', 'agents', text))
    }
    if (type === 'task.failed' || type === 'agent.failed' || type === 'agent.blocked') {
      if (role) this.setRole(role, type === 'agent.blocked' ? 'waiting' : 'failed', activity)
      this.push(line(type === 'agent.blocked' ? '○' : '×', 'agents', text))
    }
    if (type === 'task.cancelled') {
      const id = agentOf(event)
      if (id) this.working.delete(id)
      this.aggregates.agentsWorking = this.working.size || undefined
      if (role) this.setRole(role, 'waiting', activity)
      this.push(line('○', 'agents', text))
    }
    if (type === 'task.paused') {
      if (role) this.setRole(role, 'waiting', activity)
      this.push(line('○', 'agents', text))
    }
    if (type === 'task.retry_requested' || type === 'task.resumed') {
      if (role) this.setRole(role, 'waiting', activity)
      this.push(line('↻', 'agents', text))
    }
    if (type === 'revision.requested' || type === 'task.retry_scheduled') {
      this.push(line('↻', 'agents', text))
    }
    if (type === 'recovery.started') {
      if (role) this.setRole(role, 'working', activity)
      this.headline = event.data.recoveryType === 'qa_revision' ? 'Revising' : 'Recovering'
      this.push(line('↻', 'agents', text))
    }
    if (type === 'recovery.completed') {
      if (role) this.setRole(role, 'complete', activity)
      this.push(line('✓', 'agents', text))
    }
    if (type === 'escalation.created') {
      if (role) this.setRole(role, 'failed', activity)
      this.headline = 'Escalated'
      this.push(line('×', 'agents', text))
    }
    if (type === 'agent.message_sent') {
      this.push(line('→', 'messages', text))
    }
    if (type === 'company.run_completed') {
      const continuing = event.data.alwaysOn === true && event.data.status !== 'stopped'
      this.headline = continuing ? 'Slice complete · continuing' : (str(event.data, 'status') === 'failed' ? 'Run failed' : 'Company run complete')
      this.working.clear()
      this.aggregates.agentsWorking = undefined
      this.push(line(event.data.status === 'failed' ? '×' : '✓', 'agents', text))
    }
    if (type === 'company.run_blocked') {
      this.headline = 'Blocked'
      this.setRole('orchestrator', 'waiting', text)
      this.working.clear()
      this.aggregates.agentsWorking = undefined
      this.push(line('×', 'agents', text))
    }
    if (type === 'company.heartbeat') {
      this.beatUntil = freshUntil
      const orch = this.roles.get('orchestrator')
      if (orch && orch.status !== 'failed') this.setRole('orchestrator', orch.status, orch.activity)
    }
    if (type === 'company.cycle_scheduled') {
      this.headline = 'Next slice shortly'
      this.push(line('○', 'agents', text))
    }
  }

  private ensureRole(role: string, status: RoleProgress['status'], activity: string) {
    if (this.roles.has(role)) return
    this.roles.set(role, {
      role,
      name: ROLE_NAME[role] || role.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      mark: markColorRole(status),
      activity,
      status,
    })
  }

  private setRole(role: string, status: RoleProgress['status'], activity: string, artifact?: string) {
    const prev = this.roles.get(role)
    this.roles.set(role, {
      role,
      name: prev?.name || ROLE_NAME[role] || role.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      mark: markColorRole(status),
      activity,
      status,
      artifact: artifact || prev?.artifact,
    })
  }

  private push(line: WorkLine) {
    this.lines = [line, ...this.lines].slice(0, MAX_LINES)
  }

  private publish() {
    this.revision += 1
    const roles = ROLE_ORDER.map((role) => this.roles.get(role)).filter((item): item is RoleProgress => Boolean(item))
    for (const item of this.roles.values()) {
      if (!ROLE_ORDER.includes(item.role)) roles.push(item)
    }
    this.snapshot = {
      lines: this.lines.slice(),
      roles,
      aggregates: { ...this.aggregates },
      previewReady: this.previewReady,
      previewFreshUntil: this.previewFreshUntil,
      beatUntil: this.beatUntil,
      headline: this.headline,
      revision: this.revision,
    }
    for (const listen of this.listeners) listen()
  }
}

export const workLog = new WorkLog()

export function resetWorkLog() {
  workLog.reset()
}

export function formatTokens(count: number) {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`
  return String(count)
}

export function formatElapsed(startedAt: number, at = Date.now()) {
  const seconds = Math.max(0, Math.round((at - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

export function formatAggregateStrip(aggregates: WorkAggregates, _running: boolean, at = Date.now()) {
  const parts: string[] = []
  if (aggregates.agentsWorking != null) parts.push(`${aggregates.agentsWorking} active`)
  if (aggregates.filesAdded != null) parts.push(`+${aggregates.filesAdded} file${aggregates.filesAdded === 1 ? '' : 's'}`)
  if (aggregates.linesAdded != null || aggregates.linesRemoved != null) {
    const added = aggregates.linesAdded ?? 0
    const removed = aggregates.linesRemoved ?? 0
    parts.push(`${added ? `+${added}` : ''}${added && removed ? ' ' : ''}${removed ? `-${removed}` : ''} lines`.trim())
  }
  if (aggregates.checksPassed != null || aggregates.checksFailed != null) {
    const passed = aggregates.checksPassed ?? 0
    const failed = aggregates.checksFailed ?? 0
    if (failed) parts.push(`${passed} check${passed === 1 ? '' : 's'} ✓ · ${failed} ×`)
    else parts.push(`${passed} check${passed === 1 ? '' : 's'} ✓`)
  }
  if (aggregates.tasksComplete != null && aggregates.tasksTotal != null) {
    parts.push(`${aggregates.tasksComplete}/${aggregates.tasksTotal} tasks`)
  }
  if (aggregates.startedAt != null) parts.push(formatElapsed(aggregates.startedAt, at))
  return parts.join('  ·  ')
}

export function markTone(mark: WorkMark): 'mint' | 'coral' | 'blue' | 'muted' {
  if (mark === '✓' || mark === '+') return 'mint'
  if (mark === '×') return 'coral'
  if (mark === '●' || mark === '→' || mark === '↻') return 'blue'
  return 'muted'
}
