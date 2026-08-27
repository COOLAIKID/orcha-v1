import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { GRID_SYNTHETIC_LABEL, STATUS_COPY, TEAMS, type AgentStatus, type GridAgent, type GridSnapshot } from './types.ts'
import { gridStore } from './store.ts'
import { pauseAgentGridDemo, playAgentGridDemo, restartAgentGridDemo } from './demo.ts'
import { GridEngine } from './engine.ts'
import { getPrefs, motionReduced, currentBusiness } from '../workspace.ts'
import { companyPreviewUrl } from '../runtimeEvents.ts'
import { formatAggregateStrip, markTone, workLog, type WorkChannel, type WorkLine } from '../activity/workLog.ts'
import { useTweenedAggregates } from '../activity/useTweenedAggregates.ts'
import { StdoutPeek } from '../activity/StdoutPeek.tsx'
import { closeAgentGrid, openAgentGrid } from './open.ts'
import { resetGrid } from './adapter.ts'

export { closeAgentGrid, openAgentGrid }

function stopAllRuntime() {
  void import('../runtimeClient.ts').then((mod) => mod.stopRuntime()).catch(() => undefined)
}

function StatusMark({ status }: { status: AgentStatus }) {
  return (
    <span className={`ag-mark is-${status}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="12" height="12">
        {status === 'working' && (
          <path d="M8 2.6a5.4 5.4 0 0 1 4.7 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
        {status === 'waiting' && <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />}
        {status === 'complete' && (
          <path d="M4.2 6.2a5.4 5.4 0 0 1 7.6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
        {status === 'experiment' && <circle cx="8" cy="8" r="2.4" fill="currentColor" />}
        {status === 'failed' && (
          <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="m5.2 5.2 5.6 5.6M10.8 5.2 5.2 10.8" />
        )}
      </svg>
    </span>
  )
}

export function AgentGrid({
  focusId,
  inspectOnOpen,
  closing = false,
  onClose,
}: {
  focusId?: string | null
  inspectOnOpen?: boolean
  closing?: boolean
  onClose: () => void
}) {
  const snap = useSyncExternalStore(gridStore.subscribe, gridStore.getSnapshot, gridStore.getSnapshot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GridEngine | null>(null)
  const [sel, setSel] = useState({
    agentId: null as string | null,
    connId: null as string | null,
    inspecting: false,
    hoverId: null as string | null,
  })
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null)
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 760 : false))
  const [detailed, setDetailed] = useState(() => getPrefs().gridDensity === 'detailed')
  const [logOpen, setLogOpen] = useState(() => workLog.getSnapshot().lines.length > 0)
  const [tick, setTick] = useState(Date.now())
  const work = useSyncExternalStore(workLog.subscribe, workLog.getSnapshot, workLog.getSnapshot)

  useEffect(() => {
    pauseAgentGridDemo()
    if (gridStore.getSnapshot().synthetic) resetGrid()
    let cancelled = false
    void import('../runtimeClient.ts').then(async (mod) => {
      const live = gridStore.getSnapshot()
      if (cancelled) return
      const planning = live.agents.some((agent) => agent.id === 'orcha-runtime')
      if (!live.synthetic && (planning || live.agents.length > 0)) return
      const hydrated = await mod.hydrateCompanyRuntime()
      if (cancelled || !hydrated) return
      setLogOpen(true)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!snap.synthetic && work.lines.length) setLogOpen(true)
  }, [snap.synthetic, work.lines.length])

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => gridStore.prunePulses(), 180)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = new GridEngine()
    engineRef.current = engine
    engine.setReduced(motionReduced())
    engine.setNarrow(window.innerWidth < 760)
    engine.setDetailed(getPrefs().gridDensity === 'detailed')
    engine.mount(canvas)
    engine.setSnapshot(gridStore.getSnapshot())
    const stop = engine.onChange(() => setSel(engine.selection()))
    const onResize = () => {
      const next = window.innerWidth < 760
      setNarrow(next)
      engine.setNarrow(next)
      engine.setReduced(motionReduced())
    }
    window.addEventListener('resize', onResize)
    return () => {
      stop()
      window.removeEventListener('resize', onResize)
      engine.unmount()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setSnapshot(snap)
    engineRef.current?.setReduced(motionReduced())
  }, [snap])

  useEffect(() => {
    engineRef.current?.setDetailed(detailed)
  }, [detailed])

  useEffect(() => {
    const hoverId = sel.hoverId
    if (!hoverId || sel.inspecting) {
      setHoverPt(null)
      return
    }
    let raf = 0
    const tick = () => {
      const engine = engineRef.current
      if (!engine || engine.isDragging()) {
        setHoverPt(null)
      } else {
        setHoverPt(engine.screenOf(hoverId))
      }
      raf = window.requestAnimationFrame(tick)
    }
    tick()
    return () => window.cancelAnimationFrame(raf)
  }, [sel.hoverId, sel.inspecting])

  useEffect(() => {
    if (!focusId) return
    const engine = engineRef.current
    if (!engine) return
    const go = () => {
      if (inspectOnOpen) engine.inspect(focusId)
      else engine.focusAgent(focusId)
      gridStore.clearUnread(focusId)
    }
    go()
    const wait = window.setTimeout(go, 80)
    return () => window.clearTimeout(wait)
  }, [focusId, inspectOnOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.chat-side')) return
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (engineRef.current?.stepOut()) return
        onClose()
        return
      }
      if (event.key === 'Enter' && sel.agentId) {
        engineRef.current?.inspect(sel.agentId)
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        engineRef.current?.zoomBy(1.12)
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        engineRef.current?.zoomBy(0.9)
      }
      if (event.key === '0') engineRef.current?.fit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, sel.agentId])

  const agent = sel.agentId ? snap.agents.find((item) => item.id === sel.agentId) ?? null : null
  const conn = sel.connId ? snap.connections.find((item) => item.id === sel.connId) ?? null : null
  const hoverAgent =
    !narrow && !sel.inspecting && sel.hoverId && hoverPt
      ? snap.agents.find((item) => item.id === sel.hoverId) ?? null
      : null
  const sourceLabel = snap.synthetic ? GRID_SYNTHETIC_LABEL : 'Live'
  const aggregates = useTweenedAggregates(work.aggregates)
  const strip = formatAggregateStrip(aggregates, !snap.synthetic, tick)
  const dockAgents = snap.agents.filter((item) => item.visible)
  const previewCompanyId = currentBusiness()?.runtimeCompanyId
  const previewHref = work.previewReady && previewCompanyId ? companyPreviewUrl(previewCompanyId) : undefined

  return (
    <div className={`ag-layer${narrow ? ' is-narrow' : ''}${sel.inspecting ? ' is-inspect' : ''}${detailed ? ' is-detailed' : ''}${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-hidden={closing || undefined} inert={closing || undefined} aria-label="Agent Grid">
      <div className="ag-stage">
      <canvas ref={canvasRef} className="ag-canvas" aria-label="Company agent network" />
      {strip && (
        <p className="ag-strip" aria-live="polite">
          {snap.synthetic ? `${GRID_SYNTHETIC_LABEL} · ${strip}` : strip}
        </p>
      )}
      {!snap.synthetic && work.roles.length > 0 && (
        <ul className="ag-live-roles" aria-label="Company specialists">
          {work.roles.map((row) => (
            <li key={row.role} className={`is-${row.status}`}>
              <span className={`ag-live-mark is-${markTone(row.mark)}${row.status === 'working' ? ' is-live' : ''}`} aria-hidden="true">{row.mark}</span>
              <b>{row.name}</b>
              <span>{row.activity}</span>
            </li>
          ))}
        </ul>
      )}
      {dockAgents.length === 0 && !snap.synthetic && work.roles.length === 0 && (
        <p className="ag-empty">Waiting for a company run. Specialists appear here as the runtime assigns them.</p>
      )}
      <div className="ag-cam" role="toolbar" aria-label="Grid camera">
        <button type="button" onClick={() => engineRef.current?.fit()}>Fit</button>
        <button type="button" aria-label="Zoom out" onClick={() => engineRef.current?.zoomBy(0.9)}>−</button>
        <button type="button" aria-label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.12)}>+</button>
      </div>

      {hoverAgent && hoverPt && (
        <aside
          className="ag-hover"
          style={{
            left: hoverPt.x + 208 > (canvasRef.current?.clientWidth ?? 800) ? hoverPt.x - 196 : hoverPt.x + 28,
            top: Math.max(12, Math.min(hoverPt.y - 22, (canvasRef.current?.clientHeight ?? 600) - 120)),
          }}
        >
          <h2>{hoverAgent.name}</h2>
          <p className="ag-hover-team">{TEAMS[hoverAgent.team].name}</p>
          <p>{hoverAgent.task}</p>
          {(hoverAgent.model || hoverAgent.tool) && (
            <p className="ag-hover-meta">{[hoverAgent.model, hoverAgent.tool].filter(Boolean).join(' · ')}</p>
          )}
        </aside>
      )}

      {conn && (
        <aside className="ag-pop" aria-label="Connection">
          <p className="ag-kicker">{labelType(conn.lastType)}</p>
          <h2>
            {nameOf(snap, conn.sourceId)}
            <span>→</span>
            {nameOf(snap, conn.destId)}
          </h2>
          <p>{conn.lastSummary}</p>
          {snap.events.find((item) => item.sourceId === conn.sourceId && item.destId === conn.destId) && (
            <small>{timeLabel(conn.lastAt)}</small>
          )}
        </aside>
      )}

      {sel.inspecting && agent && (
        <AgentDetail
          agent={agent}
          snap={snap}
          sourceLabel={sourceLabel}
          onFocus={() => engineRef.current?.focusAgent(agent.id)}
          onReturn={() => engineRef.current?.inspect(null)}
          onDemoToggle={() => {
            if (snap.demo.playing) pauseAgentGridDemo()
            else if (snap.demo.step >= snap.demo.stepCount) restartAgentGridDemo()
            else playAgentGridDemo()
          }}
          onStopAll={stopAllRuntime}
        />
      )}
      <AgentDock
        agents={dockAgents}
        now={tick}
        onFocus={(id) => {
          engineRef.current?.focusAgent(id)
          gridStore.clearUnread(id)
        }}
      />
      {logOpen && <LiveOutput lines={work.lines} synthetic={snap.synthetic} now={tick} onClose={() => setLogOpen(false)} />}
      {previewHref && (
        <div className={`ag-preview${work.previewFreshUntil > tick ? ' is-fresh' : ''}`}>
          <iframe
            className="chat-preview"
            title="Company preview"
            src={previewHref}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}
      </div>
    </div>
  )
}

function AgentDetail({
  agent,
  snap,
  sourceLabel,
  onFocus,
  onReturn,
  onDemoToggle,
  onStopAll,
}: {
  agent: GridAgent
  snap: GridSnapshot
  sourceLabel: string
  onFocus: () => void
  onReturn: () => void
  onDemoToggle: () => void
  onStopAll: () => void
}) {
  const related = snap.events.filter((item) => item.sourceId === agent.id || item.destId === agent.id).slice(0, 8)
  const demoAction = snap.demo.playing
    ? 'Pause demo'
    : snap.demo.step >= snap.demo.stepCount
      ? 'Restart demo'
      : 'Resume demo'
  return (
    <section className="ag-detail" aria-label={`${agent.name} workspace`}>
      <header>
        <div className="ag-detail-topline">
          <p className="ag-kicker">{snap.synthetic ? `${sourceLabel} · ${TEAMS[agent.team].name}` : TEAMS[agent.team].name}</p>
          <button type="button" className="ag-detail-back" aria-label="Return to Agent Grid" onClick={onReturn}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="m13.7 5.4-6.6 6.6 6.6 6.6-1.4 1.4-8-8 8-8z" />
            </svg>
          </button>
        </div>
        <h2>{agent.name}</h2>
        <p className="ag-detail-role">
          {agent.role}
          <StatusMark status={agent.status} />
          {STATUS_COPY[agent.status]}
        </p>
        {agent.hired && <p className="ag-muted">{agent.hired === 'hired' ? 'Hired for this company slice' : `Hiring state: ${agent.hired}`}</p>}
        {agent.model && <p className="ag-muted">{agent.model}</p>}
      </header>
      <div className="ag-detail-block">
        <h3>Current work</h3>
        <p>{agent.task}</p>
        {agent.progress != null && snap.synthetic && (
          <div className="ag-bar" aria-label="Task progress">
            <span style={{ width: `${Math.round(agent.progress * 100)}%` }} />
          </div>
        )}
        {agent.deps.length > 0 && <p className="ag-muted">Depends on: {agent.deps.join(', ')}</p>}
        {agent.blockers.length > 0 && <p className="ag-block">{agent.blockers.join(' · ')}</p>}
      </div>
      <div className="ag-detail-block">
        <h3>Activity</h3>
        <ol>
          {agent.timeline.slice(0, 6).map((item, index) => (
            <li key={`${item.at}-${index}`}>
              <b>{item.mark ? `${item.mark} ` : ''}{timeLabel(item.at)}</b>
              {item.summary}
            </li>
          ))}
        </ol>
        {agent.toolsCalled[0] && <p className="ag-muted">Tool: {agent.toolsCalled[0].name}</p>}
        {agent.artifacts[0] && <p className="ag-muted">File: {agent.artifacts[0].name}</p>}
      </div>
      <div className="ag-detail-block">
        <h3>Communication</h3>
        <ul>
          {related.map((item) => (
            <li key={item.id}>
              {nameOf(snap, item.sourceId)} → {nameOf(snap, item.destId)} · {item.summary}
            </li>
          ))}
        </ul>
      </div>
      <div className="ag-detail-block">
        <h3>Outputs</h3>
        {agent.artifact ? <p>{agent.artifact}</p> : <p className="ag-muted">No files yet.</p>}
      </div>
      <div className="ag-detail-actions">
        <button type="button" className="ag-chip" onClick={onFocus}>Focus</button>
        {snap.synthetic ? (
          <button type="button" className="ag-chip" onClick={onDemoToggle}>
            {demoAction}
          </button>
        ) : (
          <button type="button" className="ag-chip" onClick={onStopAll}>Stop All</button>
        )}
        <button type="button" className="ag-chip is-go" onClick={onReturn}>Return to grid</button>
      </div>
    </section>
  )
}

function nameOf(snap: GridSnapshot, id: string) {
  return snap.agents.find((agent) => agent.id === id)?.name ?? id
}

function labelType(type: string) {
  return type.replace(/_/g, ' ')
}

function timeLabel(at: number) {
  const delta = Math.max(0, Date.now() - at)
  if (delta < 8000) return 'just now'
  if (delta < 60000) return `${Math.round(delta / 1000)}s ago`
  return `${Math.round(delta / 60000)}m ago`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function dockMark(status: AgentStatus) {
  if (status === 'working') return '●'
  if (status === 'complete') return '✓'
  if (status === 'failed') return '×'
  return '○'
}

function AgentDock({ agents, now, onFocus }: { agents: GridAgent[]; now: number; onFocus: (id: string) => void }) {
  return (
    <nav className="ag-dock" aria-label="Agents">
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className={`ag-dock-item is-${agent.status}${agent.assignedAt && now - agent.assignedAt < 1200 ? ' is-lift' : ''}${agent.glowUntil && agent.glowUntil > now ? ' is-fresh' : ''}`}
          title={`${agent.name} · ${agent.task}`}
          onClick={() => onFocus(agent.id)}
        >
          <span className="ag-dock-initials">{initials(agent.name)}</span>
          <span className={`ag-dock-mark is-${agent.status}`} aria-hidden="true">{dockMark(agent.status)}</span>
          <span className="ag-dock-tip">{agent.name}<small>{agent.task}</small></span>
        </button>
      ))}
    </nav>
  )
}

const LOG_FILTERS: { id: WorkChannel | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'agents', label: 'Agents' },
  { id: 'files', label: 'Files' },
  { id: 'models', label: 'Models' },
  { id: 'tools', label: 'Tools' },
  { id: 'tests', label: 'Tests' },
  { id: 'messages', label: 'Messages' },
]

function LiveOutput({
  lines,
  synthetic,
  now,
  onClose,
}: {
  lines: WorkLine[]
  synthetic: boolean
  now: number
  onClose: () => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const [filter, setFilter] = useState<WorkChannel | 'all'>('all')
  const visible = (filter === 'all' ? lines : lines.filter((line) => line.channel === filter)).slice(0, 80).reverse()
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visible.length, visible[visible.length - 1]?.id])
  return (
    <aside className="ag-log" aria-label="Live Output">
      <header>
        <p className="ag-kicker">{synthetic ? 'Demo' : 'Live Output'}</p>
        <button type="button" className="ag-detail-back" aria-label="Close live output" onClick={onClose}>×</button>
      </header>
      <div className="ag-log-filters" role="tablist" aria-label="Output filters">
        {LOG_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? 'is-on' : ''}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <ol className="ag-log-list" ref={listRef}>
        {visible.map((line) => (
          <li key={line.id} className={`ag-log-line is-${markTone(line.mark)}${line.freshUntil > now ? ' is-fresh' : ''}`}>
            <span className="ag-log-mark" aria-hidden="true">{line.mark}</span>
            <span>
              {line.text}
              {line.checks?.map((check) => (
                <small key={check.name} className="ag-log-check">{check.pass ? '✓' : '×'} {check.name}</small>
              ))}
              {line.stdoutPreview && <StdoutPeek text={line.stdoutPreview} />}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  )
}
