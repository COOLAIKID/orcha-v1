import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ingestManyReal, ingestReal, resetGrid } from './agentGrid/adapter.ts'
import { pauseAgentGridDemo } from './agentGrid/demo.ts'
import { gridStore } from './agentGrid/store.ts'
import { mapRuntimeEvent, phaseFromEvent, previewFromEvent, isRealRuntimeEvent, workspaceBaseAgents, type DomainEvent } from './runtimeEvents.ts'

afterEach(() => {
  resetGrid()
})

function ingestLive(events: DomainEvent[], objective: string, companyRun: boolean) {
  pauseAgentGridDemo()
  resetGrid()
  ingestManyReal(companyRun
    ? workspaceBaseAgents(objective).filter((item) => item.kind === 'objective' || (item.kind === 'agent.upsert' && item.agent.id === 'orcha-runtime'))
    : workspaceBaseAgents(objective))
  for (const event of events) {
    for (const inbound of mapRuntimeEvent(event, objective)) ingestReal(inbound)
  }
}

test('task.created maps to a role-stable specialist instead of agent_local_engineer', () => {
  const inbound = mapRuntimeEvent({
    event_type: 'task.created',
    sequence: 1,
    data: { role: 'design', title: 'Compose the first screen', summary: 'Queued design' },
  }, 'Build StudyFlow')
  const ids = inbound.flatMap((item) => {
    if (item.kind === 'agent.upsert') return [item.agent.id]
    if (item.kind === 'comm') return [item.sourceId, item.destId]
    if (item.kind === 'status' || item.kind === 'tool') return [item.id]
    return []
  })
  assert.equal(ids.includes('agent_local_engineer'), false)
  assert.equal(ids.includes('specialist_design'), true)
})

test('runtime team metadata keeps Design, Data, and Business separate', () => {
  for (const [role, team] of [['design', 'design'], ['data', 'data'], ['business', 'business']] as const) {
    const upsert = mapRuntimeEvent({
      event_type: 'task.created',
      sequence: 1,
      data: { role, team, title: `${role} task`, summary: `Queued ${role}` },
    }, 'Build StudyFlow').find((item) => item.kind === 'agent.upsert')
    assert.equal(upsert?.kind === 'agent.upsert' && upsert.agent.team, team)
  }
})

test('agent creation keeps the internal mailbox identity inspectable', () => {
  const upsert = mapRuntimeEvent({
    event_type: 'agent.created',
    sequence: 1,
    data: {
      role: 'engineering',
      agentId: 'agent_engineering_123456',
      inboxAddress: 'inbox-123456@inbox.orcha.local',
      summary: 'Engineering joined',
    },
  }, 'Build StudyFlow').find((item) => item.kind === 'agent.upsert')
  assert.equal(upsert?.kind === 'agent.upsert' && upsert.agent.inboxAddress, 'inbox-123456@inbox.orcha.local')
})

test('preview.ready maps a verified preview status and chat URL', () => {
  const event = {
    event_type: 'preview.ready',
    sequence: 8,
    data: { agentId: 'specialist_engineering', role: 'engineering', summary: 'Company preview is ready', artifact: 'app/index.html' },
  }
  const inbound = mapRuntimeEvent(event, 'Build StudyFlow')
  assert.equal(inbound.some((item) => item.kind === 'status' && item.task === 'Preview ready'), true)
  assert.equal(previewFromEvent(event, 'co_study'), '/v1/companies/co_study/preview/index.html')
  assert.equal(phaseFromEvent(event), 'Preview ready')
})

test('live company events latch the grid off Demo and do not create the workspace engineer', () => {
  ingestLive([
    { event_type: 'plan.generated', sequence: 1, data: { summary: 'Product → Design → Engineering → QA' } },
    { event_type: 'task.created', sequence: 2, data: { role: 'engineering', title: 'Build the page' } },
  ], 'Build a StudyFlow landing page', true)
  const snap = gridStore.getSnapshot()
  assert.equal(snap.synthetic, false)
  assert.equal(snap.demo.playing, false)
  assert.equal(snap.agents.some((agent) => agent.id === 'orcha-runtime'), true)
  assert.equal(snap.agents.some((agent) => agent.id === 'specialist_engineering'), true)
  assert.equal(snap.agents.some((agent) => agent.id === 'agent_local_engineer'), false)
})

test('workspace-check events keep the Local Workspace engineer', () => {
  ingestLive([
    { event_type: 'sandbox.connected', sequence: 1, data: { agentId: 'agent_local_engineer', summary: 'Connected to Local Workspace' } },
  ], 'Verify the Local Workspace', false)
  const snap = gridStore.getSnapshot()
  assert.equal(snap.synthetic, false)
  assert.equal(snap.agents.some((agent) => agent.id === 'agent_local_engineer'), true)
})

test('unknown agent work is not dumped onto agent_local_engineer', () => {
  ingestReal({
    kind: 'agent.upsert',
    agent: {
      id: 'orcha-runtime',
      name: 'Orcha',
      role: 'Orchestrator',
      team: 'orchestrator',
      status: 'working',
      task: 'Coordinate',
      blockers: [],
      deps: [],
      createdAt: 1,
      kind: 'orchestrator',
    },
  })
  const inbound = mapRuntimeEvent({
    event_type: 'agent.started',
    sequence: 3,
    data: { role: 'qa', agentId: 'agent_qa_deadbeef', summary: 'Testing the page' },
  }, 'Build StudyFlow')
  assert.equal(inbound.some((item) => item.kind === 'status' && item.id === 'specialist_qa'), true)
  assert.equal(inbound.some((item) => 'id' in item && item.id === 'agent_local_engineer'), false)
})

test('cost.recorded and model.requested are real events with optional token fields', () => {
  assert.equal(isRealRuntimeEvent({ event_type: 'cost.recorded', sequence: 1, data: {} }), true)
  assert.equal(isRealRuntimeEvent({ event_type: 'model.requested', sequence: 2, data: {} }), true)
  const inbound = mapRuntimeEvent({
    event_type: 'cost.recorded',
    sequence: 4,
    data: { role: 'engineering', provider: 'openrouter', model: 'stealth/ox-alpha', durationMs: 1800, inputTokens: 900, summary: 'Recorded usage' },
  }, 'Build StudyFlow')
  const status = inbound.find((item) => item.kind === 'status')
  assert.equal(status?.kind === 'status' && status.durationMs, 1800)
  assert.equal(status?.kind === 'status' && status.inputTokens, 900)
  assert.equal(status?.kind === 'status' && status.outputTokens, undefined)
})

test('recovery and escalation events map to explicit real grid work', () => {
  assert.equal(isRealRuntimeEvent({ event_type: 'recovery.started', sequence: 1, data: {} }), true)
  assert.equal(isRealRuntimeEvent({ event_type: 'escalation.created', sequence: 2, data: {} }), true)
  const started = mapRuntimeEvent({
    event_type: 'recovery.started',
    sequence: 3,
    data: { role: 'engineering', summary: 'Starting one bounded retry', recoveryType: 'retry' },
  }, 'Build StudyFlow')
  assert.equal(started.some((item) => item.kind === 'comm' && item.type === 'retry'), true)
  assert.equal(started.some((item) => item.kind === 'status' && item.id === 'orcha-runtime' && item.status === 'working'), true)
  const escalation = mapRuntimeEvent({
    event_type: 'escalation.created',
    sequence: 4,
    data: { role: 'qa', summary: 'Escalated after bounded retries' },
  }, 'Build StudyFlow')
  assert.equal(escalation.some((item) => item.kind === 'comm' && item.type === 'failure'), true)
  assert.equal(escalation.some((item) => item.kind === 'status' && item.id === 'orcha-runtime' && item.status === 'failed'), true)
})

test('owner task controls stay visible as waiting or retry work', () => {
  const paused = mapRuntimeEvent({
    event_type: 'task.paused',
    sequence: 9,
    data: { role: 'design', agentId: 'specialist_design', summary: 'Paused before dispatch; retry is available' },
  }, 'Build StudyFlow')
  assert.equal(paused.some((item) => item.kind === 'status' && item.id === 'specialist_design' && item.status === 'waiting'), true)
  assert.equal(paused.some((item) => item.kind === 'comm'), false)

  const retried = mapRuntimeEvent({
    event_type: 'task.retry_requested',
    sequence: 10,
    data: { role: 'design', agentId: 'specialist_design', summary: 'Retry requested; task requeued for the persistent runtime' },
  }, 'Build StudyFlow')
  assert.equal(retried.some((item) => item.kind === 'status' && item.task === 'Retry queued'), true)
  assert.equal(retried.some((item) => item.kind === 'comm' && item.type === 'retry'), true)

  const resumed = mapRuntimeEvent({
    event_type: 'task.resumed',
    sequence: 11,
    data: { role: 'design', agentId: 'specialist_design', summary: 'Task requeued for the persistent runtime' },
  }, 'Build StudyFlow')
  assert.equal(resumed.some((item) => item.kind === 'comm' && item.type === 'retry'), true)
})

test('recovered waiting agent status stays waiting in the real grid', () => {
  const inbound = mapRuntimeEvent({
    event_type: 'agent.status_changed',
    sequence: 12,
    data: {
      role: 'engineering',
      agentId: 'agent_engineering_recovery',
      status: 'waiting',
      recovered: true,
      summary: 'Specialist recovered after restart and is waiting for scheduler dispatch',
    },
  }, 'Build StudyFlow')
  const status = inbound.find((item) => item.kind === 'status')
  assert.equal(status?.kind === 'status' && status.status, 'waiting')
})

test('file.created carries line stats when present and omits them otherwise', () => {
  const withStats = mapRuntimeEvent({
    event_type: 'file.created',
    sequence: 5,
    data: { role: 'engineering', artifact: 'app/index.html', created: true, lines: 8, linesAdded: 8, linesRemoved: 0, summary: 'Created app/index.html' },
  }, 'Build StudyFlow')
  const artifact = withStats.find((item) => item.kind === 'artifact')
  assert.equal(artifact?.kind === 'artifact' && artifact.linesAdded, 8)
  const comm = withStats.find((item) => item.kind === 'comm')
  assert.equal(comm?.kind === 'comm' && comm.label, '+8 index.html')
  const bare = mapRuntimeEvent({
    event_type: 'file.changed',
    sequence: 6,
    data: { role: 'engineering', artifact: 'app/styles.css', summary: 'Updated app/styles.css' },
  }, 'Build StudyFlow')
  const changed = bare.find((item) => item.kind === 'artifact')
  assert.equal(changed?.kind === 'artifact' && changed.linesAdded, undefined)
})

test('command.completed maps observed stdout onto the grid tool pulse', () => {
  assert.equal(isRealRuntimeEvent({ event_type: 'command.completed', sequence: 1, data: {} }), true)
  const inbound = mapRuntimeEvent({
    event_type: 'command.completed',
    sequence: 8,
    data: { role: 'engineering', command: 'ls', exitCode: 0, stdout: 'app\nnotes.md', summary: 'ls exited with code 0' },
  }, 'Build StudyFlow')
  const tool = inbound.find((item) => item.kind === 'tool')
  assert.equal(tool?.kind === 'tool' && tool.name, 'ls')
  assert.equal(tool?.kind === 'tool' && tool.stdoutPreview, 'app\nnotes.md')
})

test('verification.passed maps real checks without inventing extras', () => {
  const inbound = mapRuntimeEvent({
    event_type: 'verification.passed',
    sequence: 7,
    data: {
      role: 'qa',
      summary: 'QA verified the page',
      checks: [{ name: 'app/index.html exists', pass: true }, { name: 'no remote scripts', pass: true }],
    },
  }, 'Build StudyFlow')
  const status = inbound.find((item) => item.kind === 'status')
  assert.equal(status?.kind === 'status' && status.checks?.length, 2)
  assert.equal(status?.kind === 'status' && status.mark, '✓')
})

test('company.heartbeat glows the orchestrator without overwriting its task', () => {
  ingestLive([
    { event_type: 'company.started', sequence: 1, data: { summary: 'Company started' } },
    { event_type: 'company.run_blocked', sequence: 2, data: { summary: 'No server-side AI provider is configured.' } },
    { event_type: 'company.heartbeat', sequence: 3, data: { summary: 'Company is running on this PC' } },
  ], 'Build StudyFlow', true)
  const orch = gridStore.getSnapshot().agents.find((agent) => agent.id === 'orcha-runtime')
  assert.equal(orch?.status, 'waiting')
  assert.equal(orch?.task, 'Blocked')
  assert.ok((orch?.glowUntil ?? 0) > Date.now())
})
