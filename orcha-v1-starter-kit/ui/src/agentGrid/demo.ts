import { ingest, ingestMany, resetGrid } from './adapter.ts'
import { gridStore } from './store.ts'
import type { GridAgent, RuntimeInbound } from './types.ts'

/** Dedicated synthetic provider. Components must not invent their own fake work. */

const MODEL = 'Ox Alpha · Demo'

type Beat = {
  at: number
  events: RuntimeInbound[]
}

function agent(
  id: string,
  name: string,
  role: string,
  team: GridAgent['team'],
  extra: Partial<GridAgent> = {},
): RuntimeInbound {
  return {
    kind: 'agent.upsert',
    agent: {
      id,
      name,
      role,
      team,
      status: extra.status ?? 'waiting',
      task: extra.task ?? 'Standing by',
      progress: extra.progress,
      model: extra.model ?? MODEL,
      tool: extra.tool,
      activity: extra.activity ?? 'Waiting for an assignment from the orchestrator',
      recentComm: extra.recentComm,
      artifact: extra.artifact,
      blockers: extra.blockers ?? [],
      deps: extra.deps ?? [],
      createdAt: 0,
      kind: extra.kind ?? (id === 'orch' ? 'orchestrator' : 'agent'),
      visible: extra.visible ?? true,
    },
  }
}

const ORCH = agent('orch', 'Orchestrator', 'Direct the company', 'orchestrator', {
  kind: 'orchestrator',
  status: 'waiting',
  task: 'Hold for an owner goal',
  activity: 'Ready to break work into agents',
})

function beats(): Beat[] {
  return [
    {
      at: 0,
      events: [
        ORCH,
        { kind: 'objective', text: 'Ship a calm first-run for StudyFlow' },
        {
          kind: 'status',
          id: 'orch',
          status: 'working',
          task: 'Break the goal into work',
          activity: 'Received owner goal. Splitting research from product.',
        },
      ],
    },
    {
      at: 900,
      events: [
        agent('research', 'Research', 'Find signal', 'product', {
          status: 'working',
          task: 'Map competitor onboarding',
          tool: 'web.search',
          activity: 'Reading how other study tools get a first save',
        }),
        agent('product', 'Product', 'Decide the slice', 'product', {
          status: 'waiting',
          task: 'Wait on research',
          deps: ['Research findings'],
        }),
        {
          kind: 'comm',
          type: 'delegation',
          sourceId: 'orch',
          destId: 'research',
          summary: 'Map competitor onboarding',
          task: 'Map competitor onboarding',
        },
        {
          kind: 'comm',
          type: 'delegation',
          sourceId: 'orch',
          destId: 'product',
          summary: 'Turn findings into a first-run spec',
          task: 'Write first-run spec',
        },
      ],
    },
    {
      at: 2400,
      events: [
        { kind: 'tool', id: 'research', name: 'web.search', summary: 'Compared 8 study-app first runs' },
      ],
    },
    {
      at: 3600,
      events: [
        {
          kind: 'status',
          id: 'research',
          status: 'complete',
          task: 'Findings ready',
          activity: 'Users drop when the next step is unnamed.',
          progress: 1,
          artifact: 'research-notes.md',
        },
        {
          kind: 'comm',
          type: 'result',
          sourceId: 'research',
          destId: 'product',
          summary: 'Competitor findings ready',
          task: 'Write first-run spec',
        },
        {
          kind: 'status',
          id: 'product',
          status: 'working',
          task: 'Write first-run spec',
          activity: 'Drafting a one-screen first save',
          model: MODEL,
        },
      ],
    },
    {
      at: 5200,
      events: [
        {
          kind: 'status',
          id: 'product',
          status: 'complete',
          task: 'Specification ready',
          progress: 1,
          artifact: 'first-run-spec.md',
          activity: 'One screen. One save. No extra account wall.',
        },
        {
          kind: 'comm',
          type: 'result',
          sourceId: 'product',
          destId: 'orch',
          summary: 'Specification ready',
          task: 'Write first-run spec',
        },
      ],
    },
    {
      at: 6400,
      events: [
        agent('design', 'Design', 'Shape the first screen', 'design', {
          status: 'working',
          task: 'Compose onboarding frames',
          tool: 'preview.frame',
        }),
        agent('frontend', 'Frontend', 'Build the screen', 'engineering', {
          status: 'waiting',
          task: 'Wait on frames',
          deps: ['Onboarding frames'],
        }),
        agent('backend', 'Backend', 'Expose the save', 'engineering', {
          status: 'working',
          task: 'Expose session API',
          tool: 'repo.write',
        }),
        {
          kind: 'comm',
          type: 'delegation',
          sourceId: 'orch',
          destId: 'design',
          summary: 'Compose onboarding frames',
          task: 'Compose onboarding frames',
        },
        {
          kind: 'comm',
          type: 'delegation',
          sourceId: 'orch',
          destId: 'frontend',
          summary: 'Implement onboarding screen',
          task: 'Implement onboarding screen',
        },
        {
          kind: 'comm',
          type: 'delegation',
          sourceId: 'orch',
          destId: 'backend',
          summary: 'Expose session API',
          task: 'Expose session API',
        },
        {
          kind: 'status',
          id: 'orch',
          status: 'working',
          task: 'Coordinate the build',
          activity: 'Design, frontend, and backend are in motion.',
        },
      ],
    },
    {
      at: 8200,
      events: [
        {
          kind: 'artifact',
          fromId: 'design',
          toId: 'frontend',
          name: 'onboarding-frames.png',
        },
        {
          kind: 'comm',
          type: 'artifact_handoff',
          sourceId: 'design',
          destId: 'frontend',
          summary: 'Onboarding frames ready',
          task: 'Implement onboarding screen',
        },
        {
          kind: 'status',
          id: 'design',
          status: 'complete',
          task: 'Frames handed off',
          progress: 1,
          artifact: 'onboarding-frames.png',
        },
        {
          kind: 'status',
          id: 'frontend',
          status: 'working',
          task: 'Implement onboarding screen',
          tool: 'repo.write',
          activity: 'Building the first-run screen from the frames',
          deps: [],
        },
      ],
    },
    {
      at: 9800,
      events: [
        agent('infra', 'Infrastructure', 'Keep the preview up', 'engineering', {
          status: 'waiting',
          task: 'Stand by for a preview',
        }),
        agent('qa', 'QA', 'Protect the outcome', 'quality', {
          status: 'waiting',
          task: 'Wait on a build',
        }),
        agent('security', 'Security', 'Check the edges', 'quality', {
          status: 'experiment',
          task: 'Scan the session path',
          activity: 'Looking at cookie and local-only storage',
        }),
        agent('growth', 'Growth', 'Find first users', 'growth', {
          status: 'waiting',
          task: 'Hold until a preview exists',
        }),
        agent('marketing', 'Marketing', 'Name the promise', 'growth', {
          status: 'waiting',
          task: 'Draft a one-line promise',
        }),
        agent('ops', 'Operations', 'Watch the runtime', 'business', {
          status: 'waiting',
          task: 'Watch company health',
        }),
        {
          kind: 'status',
          id: 'backend',
          status: 'complete',
          task: 'API ready',
          progress: 1,
          artifact: 'session-api.md',
          activity: 'POST /session returns a local study id',
        },
        {
          kind: 'comm',
          type: 'result',
          sourceId: 'backend',
          destId: 'qa',
          summary: 'API build ready for validation',
          task: 'Validate session API',
        },
      ],
    },
    {
      at: 11400,
      events: [
        {
          kind: 'comm',
          type: 'result',
          sourceId: 'frontend',
          destId: 'qa',
          summary: 'Onboarding build ready for validation',
          task: 'Validate first-run',
        },
        {
          kind: 'status',
          id: 'qa',
          status: 'working',
          task: 'Run acceptance',
          tool: 'shell.test',
          activity: 'Checking empty state and first save',
        },
        { kind: 'tool', id: 'qa', name: 'shell.test', summary: 'Ran 6 acceptance checks' },
      ],
    },
    {
      at: 13200,
      events: [
        {
          kind: 'status',
          id: 'qa',
          status: 'failed',
          task: 'Acceptance blocked',
          activity: '2 acceptance tests failed on empty-state skip',
          blockers: ['Empty-state skip still lands on a blank chat'],
          progress: 0.4,
        },
        {
          kind: 'comm',
          type: 'failure',
          sourceId: 'qa',
          destId: 'orch',
          summary: '2 acceptance tests failed',
          task: 'Validate first-run',
        },
      ],
    },
    {
      at: 14800,
      events: [
        {
          kind: 'status',
          id: 'orch',
          status: 'working',
          task: 'Request a revision',
          activity: 'Sending the empty-state skip back to frontend.',
        },
        {
          kind: 'comm',
          type: 'revision',
          sourceId: 'orch',
          destId: 'frontend',
          summary: 'Fix empty-state skip',
          task: 'Implement onboarding screen',
        },
        {
          kind: 'status',
          id: 'frontend',
          status: 'working',
          task: 'Fix empty-state skip',
          activity: 'Keeping the first-run copy on screen until a save exists',
          blockers: [],
        },
      ],
    },
    {
      at: 16800,
      events: [
        {
          kind: 'status',
          id: 'frontend',
          status: 'complete',
          task: 'Empty-state skip fixed',
          progress: 1,
          activity: 'First-run copy stays until a notebook exists',
        },
        {
          kind: 'comm',
          type: 'retry',
          sourceId: 'frontend',
          destId: 'qa',
          summary: 'Build ready for recheck',
          task: 'Validate first-run',
        },
        {
          kind: 'status',
          id: 'qa',
          status: 'working',
          task: 'Recheck acceptance',
          blockers: [],
          activity: 'Re-running the two failed checks',
        },
      ],
    },
    {
      at: 18600,
      events: [
        {
          kind: 'status',
          id: 'qa',
          status: 'complete',
          task: 'Acceptance passed',
          progress: 1,
          activity: 'Empty-state skip and first save both pass',
        },
        {
          kind: 'comm',
          type: 'result',
          sourceId: 'qa',
          destId: 'orch',
          summary: 'Acceptance passed',
          task: 'Validate first-run',
        },
        {
          kind: 'status',
          id: 'orch',
          status: 'complete',
          task: 'Onboarding slice complete',
          progress: 1,
          activity: 'StudyFlow first-run is ready to preview',
        },
        {
          kind: 'status',
          id: 'infra',
          status: 'working',
          task: 'Hold the preview',
          activity: 'Preview URL is up for the owner',
        },
        {
          kind: 'status',
          id: 'marketing',
          status: 'complete',
          task: 'Promise line ready',
          activity: 'Save the next lecture in one screen.',
        },
      ],
    },
  ]
}

let timer: ReturnType<typeof setTimeout> | 0 = 0
let elapsed = 0
let script: Beat[] = []
let cursor = 0
let playing = false

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = 0
  }
}

function arm() {
  clearTimer()
  if (!playing) return
  const next = script[cursor]
  if (!next) {
    playing = false
    gridStore.setDemo({ playing: false, started: true, step: script.length, stepCount: script.length })
    return
  }
  const wait = Math.max(0, next.at - elapsed)
  timer = setTimeout(tick, wait)
}

function tick() {
  if (!playing) return
  const next = script[cursor]
  if (!next) {
    playing = false
    gridStore.setDemo({ playing: false, started: true, step: script.length, stepCount: script.length })
    return
  }
  ingestMany(next.events)
  cursor += 1
  elapsed = next.at
  gridStore.setDemo({ playing: true, started: true, step: cursor, stepCount: script.length })
  arm()
}

function seedStart() {
  resetGrid()
  script = beats()
  cursor = 0
  elapsed = 0
  ingest(ORCH)
  gridStore.setDemo({ playing: false, started: true, step: 0, stepCount: script.length })
}

export function ensureAgentGridDemo() {
  const snap = gridStore.getSnapshot()
  if (snap.demo.started || snap.agents.length > 0) return
  seedStart()
}

export function playAgentGridDemo() {
  ensureAgentGridDemo()
  if (playing) return
  if (cursor >= script.length) return
  playing = true
  gridStore.setDemo({ playing: true, started: true, step: cursor, stepCount: script.length })
  arm()
}

export function pauseAgentGridDemo() {
  if (!playing) return
  playing = false
  clearTimer()
  gridStore.setDemo({ playing: false, started: true, step: cursor, stepCount: script.length })
}

export function restartAgentGridDemo() {
  playing = false
  clearTimer()
  seedStart()
  playAgentGridDemo()
}

export function isDemoPlaying() {
  return playing
}

/** Deterministic extra agents for layout stress. Labeled Demo. Not shown in the product UI. */
export function seedStressAgents(count: number) {
  resetGrid()
  ingest(ORCH)
  const teams = ['product', 'engineering', 'quality', 'design', 'growth', 'data', 'business'] as const
  const events: RuntimeInbound[] = []
  for (let i = 0; i < count; i++) {
    const team = teams[i % teams.length]
    events.push(
      agent(`a-${i}`, `Agent ${i + 1}`, `${team} specialist`, team, {
        status: i % 7 === 0 ? 'working' : i % 11 === 0 ? 'failed' : 'waiting',
        task: i % 7 === 0 ? 'Current slice' : 'Standing by',
      }),
    )
  }
  ingestMany(events)
  for (let i = 0; i < Math.min(count, 40); i++) {
    ingest({
      kind: 'comm',
      type: 'message',
      sourceId: i % 3 === 0 ? 'orch' : `a-${i}`,
      destId: i % 3 === 0 ? `a-${i}` : 'orch',
      summary: 'Status ping',
    })
  }
}

export function demoStepCount() {
  return beats().length
}
