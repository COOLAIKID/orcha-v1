import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { gridSnapshot, resetGrid } from './agentGrid/adapter.ts'
import { resetWorkLog, workLog } from './activity/workLog.ts'
import { beginCompanyRun, checkRuntimeHealth, companyRuntimeStatus, ensureRuntimeCompany, flushRuntimeEvents, hasLiveCompanyVisual, hydrateCompanyRuntime, ingestRuntimeEvents, pauseCompanyRuntime, pollRuntimeEvents, resumeCompanyRuntime, seedPlannedTasks, subscribeCompanyEvents, waitForRuntimeReady } from './runtimeClient.ts'
import { setRuntimeCompanyId, startBusiness } from './workspace.ts'

const originalFetch = globalThis.fetch
const originalEventSource = (globalThis as { EventSource?: typeof EventSource }).EventSource
const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  closed = false
  private readonly listeners = new Map<string, Array<(event: Event) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function'
      ? listener as (event: Event) => void
      : (event: Event) => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  close() {
    this.closed = true
  }

  emit(type: string, data = '') {
    const event = type === 'runtime' ? new MessageEvent(type, { data }) : new Event(type)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalLocalStorage) {
    globalThis.localStorage = originalLocalStorage
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
  if (originalEventSource) {
    globalThis.EventSource = originalEventSource
  } else {
    Reflect.deleteProperty(globalThis, 'EventSource')
  }
  FakeEventSource.instances = []
  resetGrid()
  resetWorkLog()
})

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installStorage() {
  const values = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  } as Storage
}

test('waitForRuntimeReady follows the real starting state until the worker is ready', async () => {
  let healthReads = 0
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/v1\/runtime\/health$/)
    healthReads += 1
    return response({
      status: healthReads < 3 ? 'starting' : 'ready',
      runtime_version: '0.1.0',
    })
  }

  const health = await waitForRuntimeReady(1000, 1)
  assert.equal(health.status, 'ready')
  assert.equal(healthReads, 3)
})

test('waitForRuntimeReady aborts before polling can start workspace work', async () => {
  globalThis.fetch = async () => response({ status: 'starting' })
  const controller = new AbortController()
  const pending = waitForRuntimeReady(1000, 50, controller.signal)
  controller.abort()
  await assert.rejects(pending, (error: Error) => error.name === 'AbortError')
})

test('checkRuntimeHealth bounds a hung localhost bridge request', async () => {
  globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  })

  const health = await checkRuntimeHealth(undefined, 5)
  assert.equal(health.status, 'offline')
  assert.equal(health.detail, 'Local Workspace health check timed out.')
})

test('pollRuntimeEvents bounds a hung tunnel request', async () => {
  globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  })

  await assert.rejects(
    pollRuntimeEvents('company-mobile', 4, undefined, 5),
    (error: Error) => error.name === 'TimeoutError' && /timed out/.test(error.message),
  )
})

test('hydrateCompanyRuntime restores verified projection and last durable cursor', async () => {
  const events = [
    { event_type: 'company.created', sequence: 1, data: { summary: 'Company created' } },
    { event_type: 'company.started', sequence: 2, data: { summary: 'Company started' } },
    { event_type: 'task.created', sequence: 3, data: { role: 'engineering', title: 'Build the page', summary: 'Queued engineering' } },
    { event_type: 'task.started', sequence: 4, data: { role: 'engineering', agentId: 'specialist_engineering', summary: 'Engineering started' } },
    { event_type: 'file.created', sequence: 5, data: { role: 'engineering', artifact: 'app/index.html', created: true, linesAdded: 12, summary: 'Created app/index.html' } },
    { event_type: 'verification.passed', sequence: 6, data: { role: 'qa', summary: 'QA verified the page', checks: [{ name: 'page exists', pass: true }] } },
    { event_type: 'company.heartbeat', sequence: 7, data: { summary: 'Company is running on this PC' } },
  ]
  globalThis.fetch = async (input) => {
    const path = String(input)
    if (path.includes('/dashboard')) {
      return response({
        company: { goal: 'Build StudyFlow', status: 'running', always_on: true },
        tasks: [{ status: 'running' }],
      })
    }
    if (path.endsWith('/events')) return response({ events: [] })
    assert.match(path, /\/events\?since=0$/)
    return response({ events })
  }

  const hydrated = await hydrateCompanyRuntime({
    id: 'business-studyflow',
    name: 'StudyFlow',
    brief: 'Build StudyFlow',
    createdAt: 1,
    chats: [],
    runtimeCompanyId: 'company-studyflow',
  })

  assert.equal(hydrated?.companyId, 'company-studyflow')
  assert.equal(hydrated?.objective, 'Build StudyFlow')
  assert.equal(hydrated?.cursor, 7)
  assert.equal(hydrated?.active, true)
  assert.equal(gridSnapshot().synthetic, false)
  assert.equal(gridSnapshot().agents.some((agent) => agent.id === 'specialist_engineering'), true)
  assert.equal(workLog.getSnapshot().aggregates.filesAdded, 1)
  assert.ok(workLog.getSnapshot().lines.some((line) => line.text.includes('app/index.html')))
})

test('hydrateCompanyRuntime does not keep a stopped non-always-on company live', async () => {
  globalThis.fetch = async (input) => {
    const path = String(input)
    if (path.includes('/dashboard')) {
      return response({
        company: { goal: 'Stopped build', status: 'stopped', always_on: false },
        tasks: [{ status: 'cancelled' }],
      })
    }
    if (path.endsWith('/events')) return response({ events: [] })
    return response({
      events: [{ event_type: 'company.run_completed', sequence: 4, data: { status: 'stopped', alwaysOn: false, summary: 'Stopped by owner' } }],
    })
  }

  const hydrated = await hydrateCompanyRuntime({
    id: 'business-stopped',
    name: 'Stopped build',
    brief: 'Stopped build',
    createdAt: 1,
    chats: [],
    runtimeCompanyId: 'company-stopped',
  })

  assert.equal(hydrated?.active, false)
  assert.equal(hydrated?.cursor, 4)
})

test('ensureRuntimeCompany rehydrates a stale device mapping', async () => {
  installStorage()
  const calls: string[] = []
  globalThis.fetch = async (input) => {
    const path = String(input)
    calls.push(path)
    if (path.includes('/events')) return new Response(JSON.stringify({ detail: 'Company not found' }), { status: 404 })
    assert.equal(path, '/v1/companies')
    return response({ company: { id: 'company-rehydrated' } })
  }

  const business = {
    id: 'business-studyflow',
    name: 'StudyFlow',
    brief: 'Build StudyFlow',
    createdAt: 1,
    chats: [],
    runtimeCompanyId: 'company-stale',
  }
  const companyId = await ensureRuntimeCompany(business)
  assert.equal(companyId, 'company-rehydrated')
  assert.equal(business.runtimeCompanyId, 'company-stale')
  assert.deepEqual(calls, ['/v1/companies/company-stale/events', '/v1/companies'])
})

test('runtime controls use the rehydrated company instead of surfacing a stale id', async () => {
  installStorage()
  const calls: string[] = []
  globalThis.fetch = async (input) => {
    const path = String(input)
    calls.push(path)
    if (path === '/v1/companies/company-stale/events') return new Response(JSON.stringify({ detail: 'Company not found' }), { status: 404 })
    if (path === '/v1/companies') return response({ company: { id: 'company-fresh' } })
    if (path === '/v1/companies/company-fresh/events') return response({ events: [] })
    if (path === '/v1/companies/company-fresh/runtime/pause') return response({ companyId: 'company-fresh', status: 'paused' })
    if (path === '/v1/companies/company-fresh/runtime/resume') return response({ companyId: 'company-fresh', resumed: 1 })
    if (path === '/v1/companies/company-fresh/dashboard') return response({ company: { status: 'running' }, tasks: [{ status: 'running' }] })
    throw new Error(`Unexpected request: ${path}`)
  }

  const { business } = startBusiness('Control', 'Build Control')
  setRuntimeCompanyId(business.id, 'company-stale')

  const paused = await pauseCompanyRuntime()
  const resumed = await resumeCompanyRuntime()
  const status = await companyRuntimeStatus()

  assert.equal(paused.companyId, 'company-fresh')
  assert.equal(resumed.resumed, 1)
  assert.equal(status.status, 'running')
  assert.deepEqual(calls, [
    '/v1/companies/company-stale/events',
    '/v1/companies',
    '/v1/companies/company-fresh/runtime/pause',
    '/v1/companies/company-fresh/events',
    '/v1/companies/company-fresh/runtime/resume',
    '/v1/companies/company-fresh/events',
    '/v1/companies/company-fresh/dashboard',
  ])
  setRuntimeCompanyId(business.id, undefined)
})

test('beginCompanyRun latches a live orchestrator instead of Demo', () => {
  beginCompanyRun('Build a calm study tracker')
  const snap = gridSnapshot()
  assert.equal(snap.synthetic, false)
  assert.equal(snap.agents.some((agent) => agent.id === 'orcha-runtime' && agent.status === 'working'), true)
  assert.equal(workLog.getSnapshot().aggregates.agentsWorking, 1)
  assert.equal(hasLiveCompanyVisual(), false)
  seedPlannedTasks('Build a calm study tracker', [{ role: 'engineering', title: 'Build the page' }])
  assert.equal(hasLiveCompanyVisual(), true)
})

test('ingestRuntimeEvents seeds Orcha on a live-empty grid', () => {
  resetGrid()
  ingestRuntimeEvents([
    { event_type: 'company.started', sequence: 1, data: { summary: 'Company started' } },
    { event_type: 'task.created', sequence: 2, data: { role: 'engineering', title: 'Build the page', summary: 'Queued engineering' } },
  ], 'Build StudyFlow')
  flushRuntimeEvents()
  const snap = gridSnapshot()
  assert.equal(snap.synthetic, false)
  assert.equal(snap.agents.some((agent) => agent.id === 'orcha-runtime'), true)
  assert.equal(snap.agents.some((agent) => agent.id === 'specialist_engineering'), true)
})

test('runtime event reconnect resumes from the latest durable cursor', async () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  const received: number[] = []
  const unsubscribe = subscribeCompanyEvents('company-mobile', 'Build a mobile preview', 3, (event) => {
    received.push(event.sequence)
  })

  const first = FakeEventSource.instances[0]
  assert.match(first.url, /since=3$/)
  first.emit('runtime', JSON.stringify({ event_type: 'task.started', sequence: 4, data: {} }))
  first.emit('error')
  await new Promise((resolve) => globalThis.setTimeout(resolve, 1_650))

  const second = FakeEventSource.instances[1]
  assert.ok(second)
  assert.match(second.url, /since=4$/)
  second.emit('runtime', JSON.stringify({ event_type: 'task.completed', sequence: 5, data: {} }))
  assert.deepEqual(received, [4, 5])
  unsubscribe()
})
