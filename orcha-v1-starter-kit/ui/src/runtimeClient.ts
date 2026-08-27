import { gridSnapshot, ingestManyReal, resetGrid } from './agentGrid/adapter.ts'
import { pauseAgentGridDemo } from './agentGrid/demo.ts'
import { openAgentGrid } from './agentGrid/open.ts'
import type { Business } from './workspace.ts'
import { currentBusiness, setRuntimeCompanyId } from './workspace.ts'
import { companyPreviewUrl, isRealRuntimeEvent, mapRuntimeEvent, workspaceBaseAgents, type DomainEvent } from './runtimeEvents.ts'
import { workLog } from './activity/workLog.ts'

export type { DomainEvent }
export { companyPreviewUrl } from './runtimeEvents.ts'

export type RuntimeStatus = 'ready' | 'starting' | 'offline'
type RuntimeState = { status: RuntimeStatus; detail?: string; runtimeVersion?: string }
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000

class RuntimeRequestTimeoutError extends Error {
  constructor() {
    super('Local Workspace request timed out. Check that the API and tunnel are still running, then try again.')
    this.name = 'TimeoutError'
  }
}

export type HydratedRuntime = {
  companyId: string
  objective: string
  status: string
  alwaysOn: boolean
  active: boolean
  events: DomainEvent[]
  cursor: number
}

let state: RuntimeState = { status: 'starting' }
const listeners = new Set<() => void>()
let pendingEvents: DomainEvent[] = []
let pendingObjective = ''
let flushScheduled = false
let flushRaf = 0
let flushTimer = 0

function publish(next: RuntimeState) {
  state = next
  for (const listener of listeners) listener()
}

export function getRuntimeState() {
  return state
}

export function subscribeRuntime(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function runtimeAbortError() {
  const error = new Error('Local Workspace check was stopped by the owner.')
  error.name = 'AbortError'
  return error
}

/** Keep a wedged localhost bridge from holding the readiness loop forever. */
export async function checkRuntimeHealth(signal?: AbortSignal, timeoutMs = 4_000) {
  const timeoutController = new AbortController()
  let timedOut = false
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
  const onAbort = () => timeoutController.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  timeout = globalThis.setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, timeoutMs)
  try {
    const response = await fetch('/v1/runtime/health', { signal: timeoutController.signal })
    if (!response.ok) throw new Error('health unavailable')
    const body = await response.json() as { status?: RuntimeStatus; detail?: string; runtime_version?: string }
    publish({ status: body.status === 'ready' ? 'ready' : body.status === 'offline' ? 'offline' : 'starting', detail: body.detail, runtimeVersion: body.runtime_version })
  } catch (error) {
    if (signal?.aborted) throw runtimeAbortError()
    publish({ status: 'offline', detail: timedOut ? 'Local Workspace health check timed out.' : 'Local Workspace is not running.' })
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
  return state
}

/** Wait for a real worker result before starting a mutating workspace action. */
export async function waitForRuntimeReady(timeoutMs = 30_000, pollMs = 500, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs
  if (signal?.aborted) throw runtimeAbortError()
  let health = await checkRuntimeHealth(signal)
  while (health.status === 'starting' && Date.now() < deadline) {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(runtimeAbortError())
        return
      }
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined
      const onAbort = () => {
        if (timer !== undefined) globalThis.clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(runtimeAbortError())
      }
      timer = globalThis.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, pollMs)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    health = await checkRuntimeHealth(signal)
  }
  return health
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  init?.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, Math.max(1, timeoutMs))
  try {
    const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, ...init, signal: controller.signal })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      const error = new Error(body?.detail || 'Local Workspace request failed.')
      ;(error as Error & { status?: number }).status = response.status
      throw error
    }
    return response.json() as Promise<T>
  } catch (error) {
    if (timedOut) throw new RuntimeRequestTimeoutError()
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', onAbort)
  }
}

async function createRuntimeCompany(business: Business, signal?: AbortSignal) {
  const payload = await request<{ company: { id: string } }>('/v1/companies', {
    method: 'POST',
    signal,
    body: JSON.stringify({ name: business.name.slice(0, 80), goal: (business.brief.length >= 10 ? business.brief : `${business.name} workspace check`).slice(0, 2000), constraints: {} }),
  })
  setRuntimeCompanyId(business.id, payload.company.id)
  return payload.company.id
}

function noRuntimeCompanyError() {
  return new Error('No company runtime exists yet. Run /workspace-check first.')
}

/**
 * Return the current device-mapped company, recreating it when the local API
 * has restarted and its in-memory company no longer exists. Controls should
 * not create a company just because the user has not started one yet.
 */
async function existingRuntimeCompany(business = currentBusiness()) {
  if (!business?.runtimeCompanyId) throw noRuntimeCompanyError()
  return ensureRuntimeCompany(business)
}

export async function ensureRuntimeCompany(business = currentBusiness(), signal?: AbortSignal) {
  if (!business) throw new Error('Start a business before using the Local Workspace.')
  if (!business.runtimeCompanyId) return createRuntimeCompany(business, signal)
  try {
    await request(`/v1/companies/${business.runtimeCompanyId}/events`, { signal })
    return business.runtimeCompanyId
  } catch (error) {
    if (signal?.aborted) throw runtimeAbortError()
    if ((error as Error & { status?: number }).status !== 404) throw error
    return createRuntimeCompany(business, signal)
  }
}

export function ingestRuntimeEvents(events: DomainEvent[], objective: string) {
  if (!events.length) return
  const firstReal = events.some(isRealRuntimeEvent)
  const snap = gridSnapshot()
  if (firstReal && (snap.synthetic || snap.agents.length === 0)) {
    if (snap.synthetic) {
      resetGrid()
      workLog.reset()
      pauseAgentGridDemo()
    }
    const companyRun = events.some((event) =>
      event.event_type === 'plan.generated'
      || event.event_type === 'company.started'
      || event.event_type === 'company.cycle_started'
      || event.event_type === 'company.run_completed'
      || event.event_type === 'company.run_blocked'
    )
    ingestManyReal(companyRun
      ? workspaceBaseAgents(objective).filter((item) => item.kind === 'objective' || (item.kind === 'agent.upsert' && item.agent.id === 'orcha-runtime'))
      : workspaceBaseAgents(objective))
  }
  pendingObjective = objective
  pendingEvents.push(...events)
  scheduleRuntimeFlush()
}

function scheduleRuntimeFlush() {
  if (flushScheduled) return
  flushScheduled = true
  const run = () => {
    flushScheduled = false
    if (flushRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(flushRaf)
    if (flushTimer) clearTimeout(flushTimer)
    flushRaf = 0
    flushTimer = 0
    flushRuntimeEvents()
  }
  if (typeof requestAnimationFrame === 'function') flushRaf = requestAnimationFrame(run)
  flushTimer = setTimeout(run, 50) as unknown as number
}

export function flushRuntimeEvents() {
  const events = pendingEvents
  const objective = pendingObjective
  pendingEvents = []
  if (!events.length) return
  workLog.ingestMany(events, true)
  const inbound = events.flatMap((event) => mapRuntimeEvent(event, objective))
  ingestManyReal(inbound)
}

export type InternalDiagnostics = {
    providers: Array<{ provider: string; status: string; model?: string }>
    worker: { status?: string; detail?: string; runtime_version?: string }
    scheduler?: { status?: string; activeTasks?: number; activeCompanies?: number; lastError?: string | null }
    eventStore?: string
    eventStream?: string
}

export async function fetchInternalDiagnostics() {
  try {
    return await request<InternalDiagnostics>('/v1/internal/diagnostics')
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) {
      throw new Error('Internal diagnostics are disabled on this host.')
    }
    throw error
  }
}

export async function startWorkspaceCheck(signal?: AbortSignal) {
  const health = await waitForRuntimeReady(30_000, 500, signal)
  if (health.status !== 'ready') {
    throw new Error(health.status === 'starting'
      ? 'Local Workspace did not become ready in time. Start orcha-worker and try again.'
      : health.detail || 'Local Workspace is offline. Start orcha-worker and try again.')
  }
  // Stop Demo before the first task/company request so synthetic motion cannot
  // overlap the real run while the server is still accepting it.
  pauseAgentGridDemo()
  const business = currentBusiness()
  const companyId = await ensureRuntimeCompany(business, signal)
  if (signal?.aborted) throw runtimeAbortError()
  return request<{ taskId: string; companyId: string; status: string }>(`/v1/companies/${companyId}/runtime/workspace-check`, { method: 'POST', signal })
}

export async function startCompanyRun(goal: string, business = currentBusiness()) {
  if (!business) throw new Error('Start a business before starting company work.')
  pauseAgentGridDemo()
  const companyId = await ensureRuntimeCompany(business)
  return request<{ company: { id: string; always_on?: boolean }; run: { id: string; status: string }; tasks: Array<{ id: string; role: string; title?: string }> }>(`/v1/companies/${companyId}/runs`, {
    method: 'POST',
    body: JSON.stringify({ goal, always_on: true }),
  }, 90_000)
}

export function hasLiveCompanyVisual() {
  const work = workLog.getSnapshot()
  return work.roles.length > 1 || work.lines.length > 1 || gridSnapshot().agents.length > 1
}

/** Latch chat + grid onto a live run immediately, before the first SSE frame. */
export function beginCompanyRun(objective: string) {
  pauseAgentGridDemo()
  resetGrid()
  workLog.reset()
  workLog.beginRun()
  ingestManyReal([
    ...workspaceBaseAgents(objective).filter((item) => item.kind === 'objective' || (item.kind === 'agent.upsert' && item.agent.id === 'orcha-runtime')),
    { kind: 'status', id: 'orcha-runtime', status: 'working', task: 'Planning', activity: 'Planning this company on this PC' },
  ])
  if (typeof window !== 'undefined') openAgentGrid()
}

export function seedPlannedTasks(objective: string, tasks: Array<{ role: string; title?: string }>) {
  workLog.seedTasks(tasks)
  ingestManyReal(tasks.flatMap((task) => mapRuntimeEvent({
    event_type: 'task.created',
    sequence: 0,
    data: { role: task.role, title: task.title || '', summary: `Queued ${task.role}` },
  }, objective)))
}

export function abortCompanyRunVisual() {
  workLog.reset()
  resetGrid()
}

/**
 * Subscribe to durable runtime events without a polling loop.
 *
 * EventSource retries by itself, but it retries the original URL. Re-opening
 * with the latest durable cursor keeps a phone reconnect from replaying the
 * whole company history through the tunnel.
 */
export function subscribeCompanyEvents(companyId: string, objective: string, since = 0, onEvent?: (event: DomainEvent) => void) {
  let cursor = since
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let reconnectDelay = 1_500
  let closed = false

  const connect = () => {
    if (closed) return
    const next = new EventSource(`/v1/companies/${companyId}/events/stream?since=${cursor}`)
    source = next
    next.addEventListener('open', () => {
      reconnectDelay = 1_500
    })
    next.addEventListener('runtime', (message) => {
      let event: DomainEvent
      try {
        event = JSON.parse((message as MessageEvent<string>).data) as DomainEvent
      } catch {
        // Ignore malformed transport frames; the durable event cursor remains canonical.
        return
      }
      if (!Number.isFinite(event.sequence) || event.sequence <= cursor) return
      cursor = event.sequence
      ingestRuntimeEvents([event], objective)
      onEvent?.(event)
    })
    next.addEventListener('error', () => {
      if (closed || source !== next) return
      next.close()
      source = null
      if (reconnectTimer !== null) return
      const delay = reconnectDelay
      reconnectDelay = Math.min(15_000, reconnectDelay * 2)
      reconnectTimer = globalThis.setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    })
  }

  connect()
  return () => {
    closed = true
    source?.close()
    source = null
    if (reconnectTimer !== null) {
      globalThis.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }
}

export async function pollRuntimeEvents(companyId: string, since: number, signal?: AbortSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const response = await request<{ events: DomainEvent[] }>(`/v1/companies/${companyId}/events?since=${since}`, { signal }, timeoutMs)
  return response.events
}

/**
 * Rebuild the visible runtime projection from the durable server cursor.
 * The chat is device-local, but the company event history is authoritative;
 * this keeps a refresh from turning verified work back into Demo state.
 */
function hydrateSignal(ms = 8_000) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const controller = new AbortController()
  globalThis.setTimeout(() => controller.abort(), ms)
  return controller.signal
}

export async function hydrateCompanyRuntime(business = currentBusiness()): Promise<HydratedRuntime | null> {
  if (!business?.runtimeCompanyId) return null
  const signal = hydrateSignal()
  // The browser keeps this mapping locally while the starter API keeps
  // companies in memory. Rehydrate before reading the dashboard so a refresh
  // after an API restart does not strand the chat on a dead company id.
  const companyId = await ensureRuntimeCompany(business, signal)
  const dashboard = await request<{
    company: { goal?: string; status: string; always_on?: boolean }
    tasks: Array<{ status: string }>
  }>(`/v1/companies/${companyId}/dashboard`, { signal })
  const events = await pollRuntimeEvents(companyId, 0, signal)
  const objective = business.brief || dashboard.company.goal || 'Company runtime'
  const recent = events.length > 240 ? events.slice(-240) : events

  const status = dashboard.company.status
  const alwaysOn = dashboard.company.always_on === true
  const active = status === 'running' && (alwaysOn || dashboard.tasks.some((task) => (
    task.status === 'queued' || task.status === 'running' || task.status === 'blocked' || task.status === 'paused'
  )))

  resetGrid()
  workLog.reset()
  if (recent.length) {
    ingestRuntimeEvents(recent, objective)
    flushRuntimeEvents()
  } else if (active) {
    workLog.beginRun()
    ingestManyReal([
      ...workspaceBaseAgents(objective).filter((item) => item.kind === 'objective' || (item.kind === 'agent.upsert' && item.agent.id === 'orcha-runtime')),
      { kind: 'status', id: 'orcha-runtime', status: 'working', task: 'Planning', activity: 'Planning this company on this PC' },
    ])
  }

  const cursor = events.reduce((highest, event) => Math.max(highest, Number.isFinite(event.sequence) ? event.sequence : 0), 0)
  return { companyId, objective, status, alwaysOn, active, events, cursor }
}

export async function stopRuntime() {
  const business = currentBusiness()
  if (!business?.runtimeCompanyId) throw new Error('No Local Workspace task is running.')
  try {
    return await request(`/v1/companies/${business.runtimeCompanyId}/runtime/stop`, { method: 'POST' })
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 404) throw error
    // A stopped or restarted in-memory API can leave only the device mapping
    // behind. Clear it so the next action starts from an honest empty state.
    setRuntimeCompanyId(business.id, undefined)
    throw new Error('No active Local Workspace runtime was found. Run /workspace-check to start one.')
  }
}

export async function pauseCompanyRuntime() {
  const business = currentBusiness()
  const companyId = await existingRuntimeCompany(business)
  return request<{ companyId: string; status: string }>(`/v1/companies/${companyId}/runtime/pause`, { method: 'POST' })
}

export async function resumeCompanyRuntime() {
  const business = currentBusiness()
  const companyId = await existingRuntimeCompany(business)
  return request<{ companyId: string; resumed: number }>(`/v1/companies/${companyId}/runtime/resume`, { method: 'POST' })
}

export async function listCompanyTasks(companyId = currentBusiness()?.runtimeCompanyId) {
  if (!companyId) throw new Error('No company runtime exists yet. Run /workspace-check first.')
  return request<{ tasks: Array<{ id: string; role: string; title: string; status: string; kind: string }>; truth_source: string }>(`/v1/companies/${companyId}/tasks`)
}

export async function pauseCompanyTask(taskId: string, companyId = currentBusiness()?.runtimeCompanyId) {
  if (!companyId) throw new Error('No company runtime exists yet. Run /workspace-check first.')
  return request<{ task: { id: string; status: string }; status: string }>(`/v1/companies/${companyId}/tasks/${taskId}/pause`, { method: 'POST' })
}

export async function retryCompanyTask(taskId: string, companyId = currentBusiness()?.runtimeCompanyId) {
  if (!companyId) throw new Error('No company runtime exists yet. Run /workspace-check first.')
  return request<{ task: { id: string; status: string }; status: string }>(`/v1/companies/${companyId}/tasks/${taskId}/retry`, { method: 'POST' })
}

export async function companyRuntimeStatus() {
  const business = currentBusiness()
  const companyId = await existingRuntimeCompany(business)
  const dashboard = await request<{
    company: { status: string }
    tasks: Array<{ status: string }>
  }>(`/v1/companies/${companyId}/dashboard`)
  const counts = dashboard.tasks.reduce<Record<string, number>>((all, task) => {
    all[task.status] = (all[task.status] || 0) + 1
    return all
  }, {})
  return { status: dashboard.company.status, counts }
}
