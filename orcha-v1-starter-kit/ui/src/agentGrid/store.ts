import type {
  AgentConnection,
  AgentEvent,
  DemoClock,
  GridAgent,
  GridPulse,
  GridSnapshot,
  RuntimeInbound,
} from './types.ts'

function now() {
  return Date.now()
}

function connId(a: string, b: string) {
  return a < b ? `${a}~${b}` : `${b}~${a}`
}

function emptyDemo(): DemoClock {
  return { playing: false, started: false, step: 0, stepCount: 0 }
}

function emptySnap(revision: number): GridSnapshot {
  return {
    objective: '',
    agents: [],
    connections: [],
    events: [],
    pulses: [],
    demo: emptyDemo(),
    synthetic: false,
    revision,
  }
}

function cloneAgent(agent: GridAgent): GridAgent {
  return {
    ...agent,
    blockers: [...agent.blockers],
    deps: [...agent.deps],
    toolsCalled: agent.toolsCalled.map((item) => ({ ...item })),
    artifacts: agent.artifacts.map((item) => ({ ...item })),
    timeline: agent.timeline.map((item) => ({ ...item })),
  }
}

class AgentGridStore {
  private agents = new Map<string, GridAgent>()
  private connections = new Map<string, AgentConnection>()
  private events: AgentEvent[] = []
  private pulses: GridPulse[] = []
  private objective = ''
  private demo: DemoClock = emptyDemo()
  private synthetic = false
  private revision = 0
  private snapshot: GridSnapshot = emptySnap(0)
  private listeners = new Set<() => void>()
  private seq = 0

  subscribe = (listen: () => void) => {
    this.listeners.add(listen)
    return () => {
      this.listeners.delete(listen)
    }
  }

  getSnapshot = (): GridSnapshot => this.snapshot

  getAgent(id: string) {
    return this.agents.get(id) ?? null
  }

  reset() {
    this.agents.clear()
    this.connections.clear()
    this.events = []
    this.pulses = []
    this.objective = ''
    this.demo = emptyDemo()
    this.synthetic = false
    this.publish()
  }

  setDemo(patch: Partial<DemoClock>) {
    this.demo = { ...this.demo, ...patch }
    this.publish()
  }

  ingest(event: RuntimeInbound, synthetic = true) {
    if (!synthetic) this.synthetic = false
    else if (this.agents.size === 0) this.synthetic = true
    const at = now()
    if (event.kind === 'objective') {
      this.objective = event.text
      const orch = [...this.agents.values()].find((item) => item.kind === 'orchestrator')
      if (orch) {
        orch.timeline = [{ summary: event.text, at }, ...orch.timeline].slice(0, 24)
        orch.activity = event.text
        orch.unread = true
      }
      this.publish()
      return
    }

    if (event.kind === 'agent.upsert') {
      const prev = this.agents.get(event.agent.id)
      const next: GridAgent = {
        ...prev,
        ...event.agent,
        synthetic,
        blockers: event.agent.blockers ?? prev?.blockers ?? [],
        deps: event.agent.deps ?? prev?.deps ?? [],
        toolsCalled: event.agent.toolsCalled ?? prev?.toolsCalled ?? [],
        artifacts: event.agent.artifacts ?? prev?.artifacts ?? [],
        timeline: event.agent.timeline ?? prev?.timeline ?? [],
        unread: event.agent.unread ?? prev?.unread ?? false,
        visible: event.agent.visible ?? true,
      }
      if (!prev) {
        next.timeline = [{ summary: `${next.name} joined the company`, at }, ...next.timeline]
      }
      this.agents.set(next.id, next)
      this.publish()
      return
    }

    if (event.kind === 'agent.hide') {
      const agent = this.agents.get(event.id)
      if (!agent) return
      agent.visible = false
      this.publish()
      return
    }

    if (event.kind === 'status') {
      const agent = this.agents.get(event.id)
      if (!agent) return
      if (event.status) agent.status = event.status
      if (event.task !== undefined) agent.task = event.task
      if (event.activity !== undefined) {
        agent.activity = event.activity
        agent.timeline = [{ summary: event.activity, at, mark: event.mark }, ...agent.timeline].slice(0, 8)
      }
      if (event.progress !== undefined) agent.progress = event.progress
      if (event.model !== undefined) agent.model = event.model
      if (event.tool !== undefined) agent.tool = event.tool
      if (event.artifact !== undefined) agent.artifact = event.artifact
      if (event.blockers) agent.blockers = event.blockers
      if (event.deps) agent.deps = event.deps
      if (event.durationMs !== undefined) agent.durationMs = event.durationMs
      if (event.inputTokens !== undefined) agent.inputTokens = event.inputTokens
      if (event.outputTokens !== undefined) agent.outputTokens = event.outputTokens
      if (event.status === 'working') agent.assignedAt = at
      agent.glowUntil = at + 4000
      this.publish()
      return
    }

    if (event.kind === 'tool') {
      const agent = this.agents.get(event.id)
      if (!agent) return
      agent.tool = event.name
      agent.toolsCalled = [{ name: event.name, at, summary: event.summary }, ...agent.toolsCalled].slice(0, 16)
      agent.timeline = [{ summary: event.summary, at, mark: event.ok === false ? '×' : '●' }, ...agent.timeline].slice(0, 8)
      agent.activity = event.summary
      agent.glowUntil = at + 4000
      this.publish()
      return
    }

    if (event.kind === 'artifact') {
      const from = this.agents.get(event.fromId)
      const to = this.agents.get(event.toId)
      const transfer = { name: event.name, at, fromId: event.fromId, toId: event.toId }
      const mark = event.created === false ? '~' : '+'
      const delta = [
        `${mark} ${event.name}`,
        event.linesAdded != null ? `+${event.linesAdded}` : '',
        event.linesRemoved != null && event.linesRemoved > 0 ? `-${event.linesRemoved}` : '',
      ].filter(Boolean).join(' ')
      if (from) {
        from.artifact = event.name
        from.artifacts = [transfer, ...from.artifacts].slice(0, 12)
        from.timeline = [{ summary: delta, at, mark }, ...from.timeline].slice(0, 8)
        from.glowUntil = at + 4000
      }
      if (to) {
        to.artifact = event.name
        to.artifacts = [transfer, ...to.artifacts].slice(0, 12)
        to.unread = true
      }
      this.publish()
      return
    }

    if (event.kind === 'comm') {
      const source = this.agents.get(event.sourceId)
      const dest = this.agents.get(event.destId)
      if (!source || !dest) return
      const item: AgentEvent = {
        id: `evt-${++this.seq}`,
        type: event.type,
        sourceId: event.sourceId,
        destId: event.destId,
        summary: event.summary,
        task: event.task,
        at,
        synthetic,
      }
      this.events = [item, ...this.events].slice(0, 80)
      const id = connId(event.sourceId, event.destId)
      const prev = this.connections.get(id)
      this.connections.set(id, {
        id,
        sourceId: event.sourceId,
        destId: event.destId,
        lastType: event.type,
        lastSummary: event.summary,
        lastAt: at,
        strength: 1,
      })
      if (!prev) {
        // keep a faint resting edge after the pulse
      }
      source.recentComm = event.summary
      dest.recentComm = event.summary
      dest.unread = true
      dest.timeline = [{ summary: event.summary, at }, ...dest.timeline].slice(0, 8)
      source.timeline = [{ summary: event.summary, at }, ...source.timeline].slice(0, 8)
      this.pulses.push({
        id: item.id,
        sourceId: event.sourceId,
        destId: event.destId,
        type: event.type,
        born: at,
        ttl: 1400,
        label: event.label,
      })
      this.publish()
    }
  }

  clearUnread(id: string) {
    const agent = this.agents.get(id)
    if (!agent || !agent.unread) return
    agent.unread = false
    this.publish()
  }

  prunePulses(at = now()) {
    const next = this.pulses.filter((pulse) => at - pulse.born < pulse.ttl)
    let faded = false
    for (const conn of this.connections.values()) {
      const age = at - conn.lastAt
      const strength = age < 1800 ? Math.max(0.18, 1 - age / 1800) : 0.18
      if (Math.abs(strength - conn.strength) > 0.02) {
        conn.strength = strength
        faded = true
      }
    }
    if (next.length !== this.pulses.length) {
      this.pulses = next
      faded = true
    }
    if (faded) this.publish()
  }

  private publish() {
    this.revision += 1
    this.snapshot = {
      objective: this.objective,
      agents: [...this.agents.values()].map(cloneAgent),
      connections: [...this.connections.values()].map((item) => ({ ...item })),
      events: this.events.map((item) => ({ ...item })),
      pulses: this.pulses.map((item) => ({ ...item })),
      demo: { ...this.demo },
      synthetic: this.synthetic,
      revision: this.revision,
    }
    for (const listen of this.listeners) listen()
  }
}

export const gridStore = new AgentGridStore()

export function ingestRuntimeEvent(event: RuntimeInbound, synthetic = true) {
  gridStore.ingest(event, synthetic)
}
