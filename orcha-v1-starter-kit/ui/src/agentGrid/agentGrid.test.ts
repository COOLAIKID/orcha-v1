import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ingest, ingestMany, resetGrid } from './adapter.ts'
import { demoStepCount, seedStressAgents } from './demo.ts'
import { gridStore } from './store.ts'

afterEach(() => {
  resetGrid()
})

test('adapter upserts arbitrary agents, not a fixed roster', () => {
  ingest({
    kind: 'agent.upsert',
    agent: {
      id: 'custom',
      name: 'Legal',
      role: 'Read the terms',
      team: 'operations',
      status: 'waiting',
      task: 'Stand by',
      blockers: [],
      deps: [],
      createdAt: 1,
      kind: 'agent',
    },
  })
  const snap = gridStore.getSnapshot()
  assert.equal(snap.synthetic, true)
  assert.equal(snap.agents.length, 1)
  assert.equal(snap.agents[0].name, 'Legal')
  assert.equal(snap.agents[0].synthetic, true)
})

test('communication creates a directed pulse and inspectable connection', () => {
  ingestMany([
    {
      kind: 'agent.upsert',
      agent: {
        id: 'orch',
        name: 'Orchestrator',
        role: 'Direct',
        team: 'orchestrator',
        status: 'working',
        task: 'Delegate',
        blockers: [],
        deps: [],
        createdAt: 1,
        kind: 'orchestrator',
      },
    },
    {
      kind: 'agent.upsert',
      agent: {
        id: 'fe',
        name: 'Frontend',
        role: 'Build',
        team: 'engineering',
        status: 'waiting',
        task: 'Wait',
        blockers: [],
        deps: [],
        createdAt: 1,
        kind: 'agent',
      },
    },
    {
      kind: 'comm',
      type: 'delegation',
      sourceId: 'orch',
      destId: 'fe',
      summary: 'Implement onboarding screen',
      task: 'Implement onboarding screen',
    },
  ])
  const snap = gridStore.getSnapshot()
  assert.equal(snap.connections.length, 1)
  assert.equal(snap.connections[0].sourceId, 'orch')
  assert.equal(snap.connections[0].destId, 'fe')
  assert.equal(snap.connections[0].lastType, 'delegation')
  assert.equal(snap.pulses.length, 1)
  assert.equal(snap.events[0].summary, 'Implement onboarding screen')
  assert.equal(snap.agents.find((item) => item.id === 'fe')?.unread, true)
})

test('product grid starts live-empty, not Demo', () => {
  resetGrid()
  const snap = gridStore.getSnapshot()
  assert.equal(snap.synthetic, false)
  assert.equal(snap.agents.length, 0)
  assert.equal(snap.demo.playing, false)
})

test('demo script remains available for tests only', () => {
  assert.ok(demoStepCount() >= 12)
})

test('stress seed keeps 100 agents labeled Demo', () => {
  seedStressAgents(100)
  const snap = gridStore.getSnapshot()
  assert.equal(snap.agents.length, 101)
  assert.ok(snap.agents.every((agent) => agent.synthetic))
  assert.ok(snap.connections.length > 0)
})

test('pause clock flag is independent of snapshot agents', () => {
  ingest({
    kind: 'agent.upsert',
    agent: {
      id: 'orch',
      name: 'Orchestrator',
      role: 'Direct',
      team: 'orchestrator',
      status: 'waiting',
      task: 'Hold',
      blockers: [],
      deps: [],
      createdAt: 1,
      kind: 'orchestrator',
    },
  })
  gridStore.setDemo({ playing: false, started: true, step: 3, stepCount: 12 })
  const snap = gridStore.getSnapshot()
  assert.equal(snap.demo.playing, false)
  assert.equal(snap.demo.step, 3)
})
