import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { formatAggregateStrip, resetWorkLog, workLog } from './workLog.ts'
import type { DomainEvent } from '../runtimeEvents.ts'

afterEach(() => {
  resetWorkLog()
})

function event(type: string, data: Record<string, unknown> = {}, sequence = 1): DomainEvent {
  return { event_type: type, sequence, data }
}

test('beginRun shows Planning immediately without inventing files or checks', () => {
  workLog.beginRun()
  const snap = workLog.getSnapshot()
  assert.equal(snap.headline, 'Planning')
  assert.ok(snap.aggregates.startedAt)
  assert.equal(snap.aggregates.agentsWorking, 1)
  assert.equal(snap.aggregates.filesAdded, undefined)
  assert.equal(snap.roles[0]?.role, 'orchestrator')
  assert.equal(snap.roles[0]?.status, 'working')
  assert.ok(snap.lines.some((line) => line.text.includes('Planning')))
  const strip = formatAggregateStrip(snap.aggregates, true)
  assert.ok(strip.includes('1 active'))
  assert.equal(strip.includes('file'), false)
  workLog.seedTasks([{ role: 'engineering', title: 'Build the page' }, { role: 'qa', title: 'Test' }])
  const seeded = workLog.getSnapshot()
  assert.equal(seeded.aggregates.tasksTotal, 2)
  assert.equal(seeded.roles.some((row) => row.role === 'orchestrator'), true)
  workLog.ingest(event('task.created', { role: 'engineering', title: 'Build the page', summary: 'Queued engineering' }), true)
  assert.equal(workLog.getSnapshot().aggregates.tasksTotal, 2)
  workLog.ingest(event('company.started', { summary: 'Company started' }), true)
  assert.equal(workLog.getSnapshot().aggregates.startedAt, snap.aggregates.startedAt)
})

test('a real company slice updates roles, +/− files, models, and checks without inventing extras', () => {
  workLog.beginRun()
  workLog.seedTasks([
    { role: 'engineering', title: 'Build the page' },
    { role: 'qa', title: 'Test the page' },
  ])
  workLog.ingestMany([
    event('task.started', { role: 'engineering', agentId: 'specialist_engineering', summary: 'Engineering started', activity: 'Writing app/index.html' }),
    event('file.created', { role: 'engineering', artifact: 'app/index.html', created: true, lines: 24, linesAdded: 24, linesRemoved: 0, summary: 'Created app/index.html' }),
    event('cost.recorded', { role: 'engineering', provider: 'openrouter', model: 'stealth/ox-alpha', durationMs: 1800, inputTokens: 2100, outputTokens: 400, summary: 'Recorded provider usage' }),
    event('task.completed', { role: 'engineering', summary: 'Engineering finished' }),
    event('task.started', { role: 'qa', agentId: 'specialist_qa', summary: 'QA started', activity: 'Checking the page' }),
    event('verification.passed', {
      role: 'qa',
      summary: 'QA verified the page',
      checks: [
        { name: 'app/index.html exists', pass: true },
        { name: 'mobile no overflow', pass: true },
      ],
    }),
    event('preview.ready', { summary: 'Preview ready' }),
  ], true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.headline, 'Preview ready')
  assert.equal(snap.aggregates.filesAdded, 1)
  assert.equal(snap.aggregates.linesAdded, 24)
  assert.equal(snap.aggregates.checksPassed, 2)
  assert.equal(snap.aggregates.checksFailed, undefined)
  assert.equal(snap.roles.find((row) => row.role === 'engineering')?.mark, '✓')
  assert.equal(snap.roles.find((row) => row.role === 'qa')?.mark, '✓')
  const testLine = snap.lines.find((line) => line.channel === 'tests')
  assert.ok(testLine?.checks?.some((check) => check.name === 'app/index.html exists' && check.pass))
  assert.ok(snap.previewReady)
  const strip = formatAggregateStrip(snap.aggregates, true)
  assert.ok(strip.includes('+1 file'))
  assert.ok(strip.includes('+24'))
  assert.ok(strip.includes('2 checks'))
  assert.equal(strip.includes('0 check'), false)
})

test('command and tool stdout stay on the work line without inventing output', () => {
  workLog.ingest(event('command.started', { role: 'engineering', command: 'ls', summary: 'Ran ls' }), true)
  workLog.ingest(event('command.completed', {
    role: 'engineering',
    command: 'ls',
    exitCode: 0,
    stdout: 'app\nnotes.md',
    summary: 'ls exited with code 0',
  }), true)
  workLog.ingest(event('tool.completed', {
    role: 'qa',
    tool: 'workspace.list_files',
    stdout: 'app/index.html\napp/styles.css',
    summary: 'Listed company files',
  }), true)
  const snap = workLog.getSnapshot()
  assert.ok(snap.lines.some((line) => line.text === '$ ls'))
  const done = snap.lines.find((line) => line.text.includes('exited'))
  assert.equal(done?.stdoutPreview, 'app\nnotes.md')
  const listed = snap.lines.find((line) => line.text.includes('Listed'))
  assert.equal(listed?.stdoutPreview, 'app/index.html\napp/styles.css')
})

test('work log omits unmeasured metrics until they are observed', () => {
  workLog.ingest(event('company.started', { summary: 'Company started' }), true)
  const snap = workLog.getSnapshot()
  const strip = formatAggregateStrip(snap.aggregates, true)
  assert.equal(strip.includes('0 file'), false)
  assert.equal(strip.includes('0 check'), false)
  assert.equal(strip.includes('tests'), false)
  assert.ok(strip.includes('s'))
})

test('file events produce +/− lines and do not invent git stats', () => {
  workLog.ingestMany([
    event('task.created', { role: 'engineering', title: 'Build', summary: 'Queued engineering' }),
    event('file.created', { role: 'engineering', artifact: 'app/index.html', created: true, lines: 12, linesAdded: 12, linesRemoved: 0, summary: 'Created app/index.html' }),
  ], true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.aggregates.filesAdded, 1)
  assert.equal(snap.aggregates.linesAdded, 12)
  assert.equal(snap.aggregates.checksPassed, undefined)
  assert.ok(snap.lines.some((line) => line.mark === '+' && line.text.includes('app/index.html')))
  const engineering = snap.roles.find((row) => row.role === 'engineering')
  assert.equal(engineering?.mark, '●')
})

test('cost.recorded shows duration and tokens only when present', () => {
  workLog.ingest(event('cost.recorded', {
    role: 'design',
    provider: 'openrouter',
    model: 'stealth/ox-alpha',
    durationMs: 2400,
    inputTokens: 4200,
    outputTokens: 800,
    summary: 'Recorded provider usage',
  }), true)
  const line = workLog.getSnapshot().lines[0]
  assert.equal(line.mark, '✓')
  assert.ok(line.text.includes('2.4s'))
  assert.ok(line.text.includes('4.2k in'))
  workLog.reset()
  workLog.ingest(event('cost.recorded', { role: 'design', provider: 'groq', model: 'llama', summary: 'Recorded provider usage' }), true)
  const bare = workLog.getSnapshot().lines[0]
  assert.equal(bare.text.includes('s'), false)
  assert.equal(bare.text.includes(' in'), false)
})

test('verification checks appear as test lines without inventing totals', () => {
  workLog.ingest(event('verification.passed', {
    role: 'qa',
    summary: 'QA verified the page',
    checks: [
      { name: 'app/index.html exists', pass: true },
      { name: 'mobile no overflow', pass: true },
    ],
  }), true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.aggregates.checksPassed, 2)
  assert.equal(snap.aggregates.checksFailed, undefined)
  assert.equal(snap.roles.find((row) => row.role === 'qa')?.mark, '✓')
})

test('recovery evidence is visible without pretending escalation succeeded', () => {
  workLog.ingest(event('recovery.started', { role: 'engineering', recoveryType: 'retry', summary: 'Starting one bounded retry' }), true)
  assert.equal(workLog.getSnapshot().headline, 'Recovering')
  assert.equal(workLog.getSnapshot().roles.find((row) => row.role === 'engineering')?.status, 'working')
  workLog.ingest(event('recovery.completed', { role: 'engineering', summary: 'Bounded retry completed successfully' }), true)
  assert.equal(workLog.getSnapshot().roles.find((row) => row.role === 'engineering')?.status, 'complete')
  workLog.ingest(event('escalation.created', { role: 'qa', summary: 'Escalated after bounded retries' }), true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.headline, 'Escalated')
  assert.equal(snap.roles.find((row) => row.role === 'qa')?.status, 'failed')
  assert.ok(snap.lines.some((line) => line.mark === '↻'))
  assert.ok(snap.lines.some((line) => line.mark === '✓'))
  assert.ok(snap.lines.some((line) => line.mark === '×'))
})

test('owner cancellation clears working state without turning into a failure', () => {
  workLog.ingest(event('task.started', { role: 'engineering', agentId: 'agent_local_engineer', summary: 'Writing test.txt' }), true)
  workLog.ingest(event('task.cancelled', {
    role: 'engineering',
    agentId: 'agent_local_engineer',
    summary: 'Local Workspace check stopped by the owner.',
  }), true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.aggregates.agentsWorking, undefined)
  assert.equal(snap.roles.find((row) => row.role === 'engineering')?.status, 'waiting')
  assert.equal(snap.roles.find((row) => row.role === 'engineering')?.mark, '○')
  assert.ok(snap.lines.some((line) => line.mark === '○' && line.text.includes('stopped by the owner')))
  assert.equal(snap.lines.some((line) => line.mark === '×'), false)
})

test('owner task controls leave an explicit durable trail', () => {
  workLog.ingest(event('task.created', { role: 'design', summary: 'Queued design' }), true)
  workLog.ingest(event('task.paused', { role: 'design', summary: 'Paused before dispatch; retry is available' }), true)
  workLog.ingest(event('task.retry_requested', { role: 'design', summary: 'Retry requested; task requeued for the persistent runtime' }), true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.roles.find((row) => row.role === 'design')?.status, 'waiting')
  assert.ok(snap.lines.some((line) => line.mark === '○' && line.text.includes('Paused')))
  assert.ok(snap.lines.some((line) => line.mark === '↻' && line.text.includes('Retry requested')))
})

test('restart recovery keeps a waiting specialist out of active counts', () => {
  workLog.ingest(event('agent.status_changed', {
    role: 'engineering',
    agentId: 'agent_engineering_recovery',
    status: 'waiting',
    recovered: true,
    summary: 'Specialist recovered after restart and is waiting for scheduler dispatch',
  }), true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.roles.find((row) => row.role === 'engineering')?.status, 'waiting')
  assert.equal(snap.aggregates.agentsWorking, undefined)
})

test('heartbeats refresh liveness without inventing work lines or files', () => {
  workLog.beginRun()
  const before = workLog.getSnapshot()
  workLog.ingest(event('company.heartbeat', { summary: 'Company is running on this PC' }), true)
  const snap = workLog.getSnapshot()
  assert.equal(snap.headline, 'Planning')
  assert.equal(snap.lines.length, before.lines.length)
  assert.equal(snap.aggregates.filesAdded, undefined)
  assert.ok(snap.beatUntil > Date.now() - 1000)
  workLog.ingest(event('company.run_blocked', { summary: 'No server-side AI provider is configured for this company.' }), true)
  const blocked = workLog.getSnapshot()
  assert.equal(blocked.headline, 'Blocked')
  assert.equal(blocked.roles[0]?.status, 'waiting')
  assert.ok(blocked.lines.some((line) => line.mark === '×'))
  workLog.ingest(event('company.heartbeat', { summary: 'Company is running on this PC' }), true)
  const after = workLog.getSnapshot()
  assert.equal(after.headline, 'Blocked')
  assert.equal(after.roles[0]?.status, 'waiting')
})
