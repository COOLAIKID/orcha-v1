import type { AgentConnection, AgentStatus, AgentTeamId, CommType, GridAgent, GridSnapshot } from './types.ts'
import { TEAMS } from './types.ts'

const C = {
  canvas: '#0B0D12',
  surface: '#11141B',
  elevated: '#151923',
  border: '#252B36',
  text: '#EDF0F5',
  muted: '#8D96A8',
  blue: '#6FA8E9',
  mint: '#62D9B1',
  amber: '#EAB365',
  coral: '#EF7D83',
}

type Band = 'far' | 'default' | 'near' | 'close'
type Body = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  pinned: boolean
  born: number
}
type Pt = { x: number; y: number }

export type GridHit =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'empty' }

export type EngineSelection = {
  agentId: string | null
  connId: string | null
  inspecting: boolean
  hoverId: string | null
}

function hash(id: string) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

function spawnPoint(agent: GridAgent) {
  const team = TEAMS[agent.team] ?? TEAMS.product
  const h = hash(agent.id)
  const ang = ((h % 360) / 360) * Math.PI * 2
  const rad = agent.kind === 'orchestrator' ? 0 : 52 + (h % 64)
  return { x: team.ax + Math.cos(ang) * rad, y: team.ay + Math.sin(ang) * rad }
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay)
}

function ease(t: number) {
  return t * t * (3 - 2 * t)
}

function nodePx(agent: GridAgent) {
  return agent.kind === 'orchestrator' ? 27 : 19
}

function footprint(agent: GridAgent | undefined, count = 12) {
  const dense = count > 22
  if (agent?.kind === 'orchestrator') return { rx: dense ? 66 : 84, ry: dense ? 56 : 72 }
  return { rx: dense ? 54 : 74, ry: dense ? 48 : 64 }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function stateLine(agent: GridAgent, crowded: boolean) {
  if (agent.status === 'working') return agent.task || 'Working'
  if (agent.status === 'failed') return agent.blockers[0] || 'Failed'
  if (agent.status === 'experiment') return agent.task || 'Experiment'
  if (agent.status === 'waiting' && !crowded) return 'Waiting'
  return ''
}

function zoomBand(scale: number, n: number): Band {
  if (n >= 36 && scale < 0.95) return 'far'
  if (n >= 22 && scale < 0.72) return 'far'
  if (scale < 0.58) return 'far'
  if (scale < 1.12) return 'default'
  if (scale < 1.62) return 'near'
  return 'close'
}

function pulseColor(type: CommType) {
  if (type === 'failure') return C.coral
  if (type === 'artifact_handoff' || type === 'revision' || type === 'retry') return C.amber
  return C.blue
}

function truncateTo(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut.trim()}…`
}

function quad(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

function idPhase(id: string) {
  let n = 0
  for (let i = 0; i < id.length; i += 1) n = (n * 33 + id.charCodeAt(i)) >>> 0
  return (n / 0xffffffff) * Math.PI * 2
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export class GridEngine {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private snap: GridSnapshot | null = null
  private bodies = new Map<string, Body>()
  private cam = { x: 0, y: 0, s: 0.78 }
  private camTo = { x: 0, y: 0, s: 0.78 }
  private reduce = false
  private narrow = false
  private detailed = false
  private raf = 0
  private heat = 1
  private w = 1
  private h = 1
  private dpr = 1
  private agentId: string | null = null
  private connId: string | null = null
  private hoverId: string | null = null
  private inspecting = false
  private drag: { id: string | null; sx: number; sy: number; moved: boolean; px: number; py: number } | null = null
  private hover: GridHit = { kind: 'empty' }
  private listeners = new Set<() => void>()
  private last = 0
  private fitted = false
  private userCam = false
  private needFit = false
  private lastCount = 0
  private settleGen = 0
  private ro: ResizeObserver | null = null

  mount(canvas: HTMLCanvasElement) {
    this.unmount()
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.ro = new ResizeObserver(() => {
      this.resize()
      if (!this.userCam && this.fitted) this.fit(true)
    })
    this.ro.observe(canvas)
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('dblclick', this.onDbl)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.resize()
    this.last = performance.now()
    this.loop(this.last)
  }

  unmount() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
    this.ro = null
    const canvas = this.canvas
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onDown)
      canvas.removeEventListener('pointermove', this.onMove)
      canvas.removeEventListener('pointerup', this.onUp)
      canvas.removeEventListener('pointercancel', this.onUp)
      canvas.removeEventListener('pointerleave', this.onLeave)
      canvas.removeEventListener('dblclick', this.onDbl)
      canvas.removeEventListener('wheel', this.onWheel)
    }
    this.canvas = null
    this.ctx = null
  }

  onChange(listen: () => void) {
    this.listeners.add(listen)
    return () => this.listeners.delete(listen)
  }

  selection(): EngineSelection {
    return { agentId: this.agentId, connId: this.connId, inspecting: this.inspecting, hoverId: this.hoverId }
  }

  hoverHit() {
    return this.hover
  }

  setReduced(reduce: boolean) {
    this.reduce = reduce
  }

  setNarrow(narrow: boolean) {
    this.narrow = narrow
  }

  setDetailed(detailed: boolean) {
    this.detailed = detailed
  }

  setSnapshot(snap: GridSnapshot) {
    this.snap = snap
    const seen = new Set<string>()
    let added = 0
    for (const agent of snap.agents) {
      if (!agent.visible) continue
      seen.add(agent.id)
      if (!this.bodies.has(agent.id)) {
        const pt = spawnPoint(agent)
        this.bodies.set(agent.id, { id: agent.id, x: pt.x, y: pt.y, vx: 0, vy: 0, pinned: false, born: performance.now() })
        this.heat = Math.max(this.heat, 0.72)
        added += 1
      }
    }
    for (const id of [...this.bodies.keys()]) {
      if (!seen.has(id)) this.bodies.delete(id)
    }
    if (!this.fitted && seen.size > 0) {
      this.fitted = true
      this.fit(true)
    } else if (!this.userCam && added > 0 && !this.agentId && !this.drag) {
      this.needFit = true
    }
    this.lastCount = seen.size
  }

  isDragging() {
    return Boolean(this.drag?.moved)
  }

  select(id: string | null) {
    this.agentId = id
    this.connId = null
    if (!id) this.inspecting = false
    this.emit()
  }

  inspect(id: string | null) {
    this.agentId = id
    this.connId = null
    this.inspecting = Boolean(id)
    if (id) this.focusAgent(id)
    this.emit()
  }

  selectConn(id: string | null) {
    this.connId = id
    this.agentId = null
    this.inspecting = false
    this.emit()
  }

  stepOut() {
    if (this.inspecting) {
      this.inspecting = false
      this.emit()
      return true
    }
    if (this.agentId || this.connId) {
      this.agentId = null
      this.connId = null
      this.emit()
      return true
    }
    return false
  }

  focusAgent(id: string) {
    const body = this.bodies.get(id)
    if (!body) return
    this.agentId = id
    this.connId = null
    this.camTo.x = body.x
    this.camTo.y = body.y
    if (this.cam.s < 0.68) this.camTo.s = 0.82
    if (this.reduce) {
      this.cam.x = this.camTo.x
      this.cam.y = this.camTo.y
      this.cam.s = this.camTo.s
    }
    this.emit()
  }

  fit(instant = false) {
    this.userCam = false
    const nodes = [...this.bodies.values()]
    if (!nodes.length) return
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let mx = 0
    let my = 0
    let mass = 0
    for (const node of nodes) {
      const agent = this.snap?.agents.find((item) => item.id === node.id)
      const weight = agent?.kind === 'orchestrator' ? 1.8 : agent?.status === 'working' ? 1.15 : 1
      const halo = { rx: 52, ry: 48 }
      x0 = Math.min(x0, node.x - halo.rx)
      y0 = Math.min(y0, node.y - halo.ry)
      x1 = Math.max(x1, node.x + halo.rx)
      y1 = Math.max(y1, node.y + halo.ry)
      mx += node.x * weight
      my += node.y * weight
      mass += weight
    }
    const usableW = Math.max(1, this.w - 24)
    const usableH = Math.max(1, this.h - 108)
    const bw = Math.max(180, x1 - x0)
    const bh = Math.max(160, y1 - y0)
    const cover = this.narrow ? 0.68 : 0.72
    this.camTo.x = mx / mass
    this.camTo.y = my / mass + 10
    const fill = cover * Math.min(usableW / bw, usableH / bh)
    const cap = nodes.length < 8 ? 1.06 : 1.12
    this.camTo.s = Math.max(0.38, Math.min(cap, fill))
    if (instant || this.reduce) {
      this.cam.x = this.camTo.x
      this.cam.y = this.camTo.y
      this.cam.s = this.camTo.s
    }
  }

  resetLayout() {
    const snap = this.snap
    if (!snap) return
    for (const agent of snap.agents) {
      const pt = spawnPoint(agent)
      const body = this.bodies.get(agent.id)
      if (body) {
        body.x = pt.x
        body.y = pt.y
        body.vx = 0
        body.vy = 0
        body.pinned = false
      }
    }
    this.heat = 1
    this.userCam = false
    this.fit(this.reduce)
  }

  zoomBy(factor: number, sx?: number, sy?: number) {
    this.userCam = true
    const mx = sx ?? this.w / 2
    const my = sy ?? this.h / 2
    const wx = this.cam.x + (mx - this.w / 2) / this.cam.s
    const wy = this.cam.y + (my - this.h / 2) / this.cam.s
    const next = Math.max(0.36, Math.min(2.35, this.cam.s * factor))
    this.cam.s = next
    this.camTo.s = next
    this.cam.x = wx - (mx - this.w / 2) / next
    this.cam.y = wy - (my - this.h / 2) / next
    this.camTo.x = this.cam.x
    this.camTo.y = this.cam.y
  }

  screenOf(id: string) {
    const body = this.bodies.get(id)
    if (!body) return null
    return this.toScreen(body.x, body.y)
  }

  worldOf(id: string) {
    const body = this.bodies.get(id)
    return body ? { x: body.x, y: body.y } : null
  }

  private emit() {
    for (const listen of this.listeners) listen()
  }

  private resize() {
    const canvas = this.canvas
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    this.w = Math.max(1, rect.width)
    this.h = Math.max(1, rect.height)
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(this.w * this.dpr)
    canvas.height = Math.round(this.h * this.dpr)
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  private toWorld(sx: number, sy: number) {
    return {
      x: this.cam.x + (sx - this.w / 2) / this.cam.s,
      y: this.cam.y + (sy - this.h / 2) / this.cam.s,
    }
  }

  private toScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.cam.s + this.w / 2, y: (y - this.cam.y) * this.cam.s + this.h / 2 }
  }

  private neighbors() {
    const related = new Set<string>()
    if (!this.agentId || !this.snap) return related
    related.add(this.agentId)
    for (const conn of this.snap.connections) {
      if (conn.sourceId === this.agentId) related.add(conn.destId)
      if (conn.destId === this.agentId) related.add(conn.sourceId)
    }
    return related
  }

  pick(sx: number, sy: number): GridHit {
    const snap = this.snap
    if (!snap) return { kind: 'empty' }
    const wp = this.toWorld(sx, sy)
    let best: { id: string; d: number } | null = null
    for (const agent of snap.agents) {
      if (!agent.visible) continue
      const body = this.bodies.get(agent.id)
      if (!body) continue
      const r = (nodePx(agent) + 10) / this.cam.s
      const d = dist(wp.x, wp.y, body.x, body.y)
      if (d <= r && (!best || d < best.d)) best = { id: agent.id, d }
    }
    if (best) return { kind: 'node', id: best.id }
    let edge: { id: string; d: number } | null = null
    for (const conn of snap.connections) {
      const curve = this.curve(conn.sourceId, conn.destId)
      if (!curve) continue
      for (let t = 0; t <= 1; t += 0.12) {
        const p = quad(curve.a, curve.c, curve.b, t)
        const d = dist(wp.x, wp.y, p.x, p.y)
        if (d < 9 / this.cam.s && (!edge || d < edge.d)) edge = { id: conn.id, d }
      }
    }
    if (edge) return { kind: 'edge', id: edge.id }
    return { kind: 'empty' }
  }

  private curve(sourceId: string, destId: string) {
    const a = this.bodies.get(sourceId)
    const b = this.bodies.get(destId)
    const sa = this.snap?.agents.find((item) => item.id === sourceId)
    const sb = this.snap?.agents.find((item) => item.id === destId)
    if (!a || !b || !sa || !sb) return null
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 1
    const ux = dx / d
    const uy = dy / d
    const ra = nodePx(sa) / this.cam.s
    const rb = nodePx(sb) / this.cam.s
    const p0 = { x: a.x + ux * ra, y: a.y + uy * ra }
    const p2 = { x: b.x - ux * rb, y: b.y - uy * rb }
    const bend = hash(`${sourceId}:${destId}`) % 2 ? 1 : -1
    const mag = Math.min(64, d * 0.26)
    const c = { x: (p0.x + p2.x) / 2 - uy * mag * bend, y: (p0.y + p2.y) / 2 + ux * mag * bend }
    return { a: p0, b: p2, c }
  }

  private onDown = (event: PointerEvent) => {
    const canvas = this.canvas
    if (!canvas) return
    canvas.setPointerCapture(event.pointerId)
    const rect = canvas.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const hit = this.pick(sx, sy)
    this.drag = { id: hit.kind === 'node' ? hit.id : null, sx, sy, moved: false, px: sx, py: sy }
    if (hit.kind === 'node') {
      this.select(hit.id)
      const body = this.bodies.get(hit.id)
      if (body) body.pinned = true
    } else if (hit.kind === 'edge') {
      this.selectConn(hit.id)
    } else {
      this.select(null)
    }
  }

  private onMove = (event: PointerEvent) => {
    const canvas = this.canvas
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const hit = this.pick(sx, sy)
    this.hover = hit
    const nextHover = hit.kind === 'node' ? hit.id : null
    if (nextHover !== this.hoverId) {
      this.hoverId = nextHover
      this.emit()
    }
    canvas.style.cursor = hit.kind === 'node' ? 'grab' : hit.kind === 'edge' ? 'pointer' : 'grab'
    if (!this.drag) return
    const dx = sx - this.drag.px
    const dy = sy - this.drag.py
    if (!this.drag.moved && Math.hypot(sx - this.drag.sx, sy - this.drag.sy) > 4) this.drag.moved = true
    this.drag.px = sx
    this.drag.py = sy
    if (!this.drag.moved) return
    if (this.drag.id) {
      const body = this.bodies.get(this.drag.id)
      if (body) {
        body.x += dx / this.cam.s
        body.y += dy / this.cam.s
        body.vx = 0
        body.vy = 0
        body.pinned = true
        canvas.style.cursor = 'grabbing'
      }
    } else {
      this.userCam = true
      this.cam.x -= dx / this.cam.s
      this.cam.y -= dy / this.cam.s
      this.camTo.x = this.cam.x
      this.camTo.y = this.cam.y
      canvas.style.cursor = 'grabbing'
    }
  }

  private onUp = () => {
    this.drag = null
  }

  private onLeave = () => {
    if (this.hoverId) {
      this.hoverId = null
      this.hover = { kind: 'empty' }
      this.emit()
    }
  }

  private onDbl = (event: MouseEvent) => {
    const canvas = this.canvas
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = this.pick(event.clientX - rect.left, event.clientY - rect.top)
    if (hit.kind === 'node') this.inspect(hit.id)
  }

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const canvas = this.canvas
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    this.zoomBy(event.deltaY > 0 ? 0.92 : 1.08, event.clientX - rect.left, event.clientY - rect.top)
  }

  private loop = (now: number) => {
    const dt = Math.min(32, now - this.last)
    this.last = now
    this.step(dt)
    this.draw(now)
    this.raf = requestAnimationFrame(this.loop)
  }

  private step(dt: number) {
    const k = this.reduce ? 1 : 1 - Math.pow(0.001, dt / 320)
    this.cam.x += (this.camTo.x - this.cam.x) * k
    this.cam.y += (this.camTo.y - this.cam.y) * k
    this.cam.s += (this.camTo.s - this.cam.s) * k

    const snap = this.snap
    if (!snap) return
    const nodes = snap.agents.filter((agent) => agent.visible)
    const n = nodes.length
    if (n === 0) return
    const working = nodes.some((agent) => agent.status === 'working')
    if (this.heat < 0.018 && !this.drag) {
      if (this.stillStacked(nodes) || working) {
        this.heat = working ? 0.14 : 0.32
      } else {
        this.heat = 0
        if (this.needFit && !this.userCam && !this.agentId) {
          this.needFit = false
          this.fit(false)
        }
        return
      }
    }
    const heat = this.reduce ? 0.14 : this.heat
    let stacked = 0
    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      const pa = this.bodies.get(a.id)
      if (!pa || pa.pinned) continue
      const team = TEAMS[a.team]
      const pull = a.kind === 'orchestrator' ? 0.08 : 0.032
      pa.vx += (team.ax - pa.x) * pull * heat
      pa.vy += (team.ay - pa.y) * pull * heat
      if (a.kind === 'orchestrator') {
        pa.vx += -pa.x * 0.05 * heat
        pa.vy += -pa.y * 0.05 * heat
      }
      const fa = footprint(a, n)
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]
        const pb = this.bodies.get(b.id)
        if (!pb) continue
        const fb = footprint(b, n)
        let dx = pb.x - pa.x
        let dy = pb.y - pa.y
        let d = Math.hypot(dx, dy) || 0.01
        const overlapX = fa.rx + fb.rx - Math.abs(dx)
        const overlapY = fa.ry + fb.ry - Math.abs(dy)
        if (overlapX > 0 && overlapY > 0) {
          stacked = Math.max(stacked, Math.min(overlapX, overlapY))
          const force = Math.max(overlapX, overlapY) * 0.05 * heat
          dx /= d
          dy /= d
          const extraY = overlapY > overlapX ? 1.25 : 1
          if (!pa.pinned) {
            pa.vx -= dx * force
            pa.vy -= dy * force * extraY
          }
          if (!pb.pinned) {
            pb.vx += dx * force
            pb.vy += dy * force * extraY
          }
        } else if (d < 220) {
          const soft = (18 / (d * d)) * heat
          dx /= d
          dy /= d
          if (!pa.pinned) {
            pa.vx -= dx * soft
            pa.vy -= dy * soft
          }
          if (!pb.pinned) {
            pb.vx += dx * soft
            pb.vy += dy * soft
          }
        }
      }
    }
    for (const conn of snap.connections) {
      const a = this.bodies.get(conn.sourceId)
      const b = this.bodies.get(conn.destId)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      const sa = snap.agents.find((item) => item.id === conn.sourceId)
      const sb = snap.agents.find((item) => item.id === conn.destId)
      const hub = sa?.kind === 'orchestrator' || sb?.kind === 'orchestrator'
      const rest = hub ? (n > 22 ? 280 : 214) : n > 22 ? 196 : 176
      const f = (d - rest) * (n > 22 ? 0.0024 : 0.0042) * heat
      const ux = dx / d
      const uy = dy / d
      if (!a.pinned) {
        a.vx += ux * f
        a.vy += uy * f
      }
      if (!b.pinned) {
        b.vx -= ux * f
        b.vy -= uy * f
      }
    }
    const clock = typeof performance !== 'undefined' ? performance.now() : Date.now()
    for (const body of this.bodies.values()) {
      if (body.pinned) {
        body.vx = 0
        body.vy = 0
        continue
      }
      const agent = snap.agents.find((item) => item.id === body.id)
      if (agent?.status === 'working' && !this.reduce) {
        const phase = idPhase(body.id)
        body.vx += Math.sin(clock / 780 + phase) * 0.022
        body.vy += Math.cos(clock / 920 + phase) * 0.016
      }
      body.vx *= 0.72
      body.vy *= 0.72
      body.x += body.vx
      body.y += body.vy
    }
    this.heat = stacked > 10 ? Math.max(this.heat * 0.97, 0.28) : this.heat * (this.reduce ? 0.58 : 0.95)
    if (working) this.heat = Math.max(this.heat, 0.12)
    this.settleGen = stacked > 10 ? this.settleGen + 1 : 0
    if (this.settleGen > 260) this.heat *= 0.82
    if (this.needFit && !this.userCam && !this.agentId && (this.heat < 0.5 || this.settleGen > 48)) {
      this.needFit = false
      this.fit(false)
    }
  }

  private stillStacked(nodes: GridAgent[]) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      const pa = this.bodies.get(a.id)
      if (!pa) continue
        const fa = footprint(a, nodes.length)
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const pb = this.bodies.get(b.id)
          if (!pb) continue
          const fb = footprint(b, nodes.length)
        if (Math.abs(pb.x - pa.x) < fa.rx + fb.rx - 8 && Math.abs(pb.y - pa.y) < fa.ry + fb.ry - 8) return true
      }
    }
    return false
  }

  private draw(now: number) {
    const ctx = this.ctx
    const snap = this.snap
    if (!ctx || !snap) return
    ctx.clearRect(0, 0, this.w, this.h)
    this.drawField(ctx)
    const agents = snap.agents.filter((agent) => agent.visible)
    const band = zoomBand(this.cam.s, agents.length)
    this.drawTeams(ctx, band)
    this.drawEdges(ctx, snap, now)
    const related = this.neighbors()
    for (const agent of agents) {
      this.drawNode(ctx, agent, band, now, related)
    }
    this.drawLabels(ctx, agents, band, related)
  }

  private drawField(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = C.canvas
    ctx.fillRect(0, 0, this.w, this.h)
    const glow = ctx.createRadialGradient(this.w * 0.5, this.h * 0.46, 20, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.72)
    glow.addColorStop(0, 'rgba(21, 25, 35, 0.55)')
    glow.addColorStop(1, 'rgba(11, 13, 18, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, this.w, this.h)
    const step = 72
    const origin = this.toScreen(0, 0)
    const ox = ((origin.x % (step * this.cam.s)) + step * this.cam.s) % (step * this.cam.s)
    const oy = ((origin.y % (step * this.cam.s)) + step * this.cam.s) % (step * this.cam.s)
    ctx.fillStyle = 'rgba(237,240,245,0.05)'
    for (let x = ox; x < this.w; x += step * this.cam.s) {
      for (let y = oy; y < this.h; y += step * this.cam.s) {
        ctx.beginPath()
        ctx.arc(x, y, 0.85, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  private drawTeams(ctx: CanvasRenderingContext2D, band: Band) {
    if (band === 'close' || !this.snap) return
    const byTeam = new Map<string, Pt[]>()
    for (const agent of this.snap.agents) {
      if (!agent.visible || agent.kind === 'orchestrator') continue
      const body = this.bodies.get(agent.id)
      if (!body) continue
      const list = byTeam.get(agent.team) ?? []
      list.push(body)
      byTeam.set(agent.team, list)
    }
    ctx.save()
    for (const [id, pts] of byTeam) {
      const team = TEAMS[id as AgentTeamId]
      if (!team) continue
      const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length
      const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length
      const top = Math.min(...pts.map((p) => p.y))
      const glow = this.toScreen(cx, cy)
      const rad = 52 + pts.length * 10
      const g = ctx.createRadialGradient(glow.x, glow.y, 8, glow.x, glow.y, rad * this.cam.s)
      g.addColorStop(0, 'rgba(21, 25, 35, 0.35)')
      g.addColorStop(1, 'rgba(21, 25, 35, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(glow.x, glow.y, rad * this.cam.s, 0, Math.PI * 2)
      ctx.fill()
      const p = this.toScreen(cx, top - 52)
      ctx.font = '500 11px "Space Grotesk", sans-serif'
      ctx.fillStyle = 'rgba(141,150,168,0.32)'
      ctx.textAlign = 'center'
      ctx.fillText(team.name, p.x, p.y)
      ctx.beginPath()
      ctx.moveTo(p.x - 10, p.y + 5)
      ctx.lineTo(p.x + 10, p.y + 5)
      ctx.strokeStyle = 'rgba(37,43,54,0.7)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawEdges(ctx: CanvasRenderingContext2D, snap: GridSnapshot, now: number) {
    const related = this.neighbors()
    const dormant: AgentConnection[] = []
    const live: AgentConnection[] = []
    for (const conn of snap.connections) {
      const active = snap.pulses.some((pulse) => pulse.sourceId === conn.sourceId && pulse.destId === conn.destId)
      if (active || this.connId === conn.id) live.push(conn)
      else dormant.push(conn)
    }
    const paint = (conn: AgentConnection, front: boolean) => {
      const curve = this.curve(conn.sourceId, conn.destId)
      if (!curve) return
      const a = this.toScreen(curve.a.x, curve.a.y)
      const b = this.toScreen(curve.b.x, curve.b.y)
      const c = this.toScreen(curve.c.x, curve.c.y)
      const selected = this.connId === conn.id
      const tied = !this.agentId || related.has(conn.sourceId) || related.has(conn.destId)
      let alpha = selected ? 0.72 : front ? 0.2 + conn.strength * 0.32 : 0.09
      if (this.agentId && !tied) alpha *= 0.22
      if (snap.agents.length > 22) alpha *= 0.55
      const tint =
        conn.lastType === 'failure'
          ? `rgba(239,125,131,${alpha})`
          : conn.lastType === 'artifact_handoff' || conn.lastType === 'revision'
            ? `rgba(234,179,101,${alpha})`
            : selected || front
              ? `rgba(111,168,233,${alpha})`
              : `rgba(37,43,54,${alpha + 0.14})`
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y)
      ctx.strokeStyle = tint
      ctx.lineWidth = selected ? 1.5 : 1
      ctx.stroke()
    }
    for (const conn of dormant) paint(conn, false)
    for (const conn of live) paint(conn, true)
    for (const pulse of snap.pulses) {
      const curve = this.curve(pulse.sourceId, pulse.destId)
      if (!curve) continue
      const t = this.reduce ? 0.72 : Math.max(0, Math.min(1, (Date.now() - pulse.born) / pulse.ttl))
      const u = ease(t)
      const fade = this.reduce ? 0.85 : 1 - t
      const color = pulseColor(pulse.type)
      if (pulse.type === 'failure') {
        const tip = this.toScreenPt(quad(curve.a, curve.c, curve.b, 0.82))
        ctx.beginPath()
        ctx.moveTo(tip.x - 4, tip.y - 4)
        ctx.lineTo(tip.x + 4, tip.y + 4)
        ctx.moveTo(tip.x + 4, tip.y - 4)
        ctx.lineTo(tip.x - 4, tip.y + 4)
        ctx.strokeStyle = hexA(C.coral, 0.85 * fade)
        ctx.lineWidth = 1.4
        ctx.lineCap = 'round'
        ctx.stroke()
        continue
      }
      const from = Math.max(0, u - 0.07)
      const to = Math.min(1, u + 0.02)
      const p0 = this.toScreenPt(quad(curve.a, curve.c, curve.b, from))
      const p1 = this.toScreenPt(quad(curve.a, curve.c, curve.b, to))
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.strokeStyle = hexA(color, 0.92 * fade)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.stroke()
      const tip = this.toScreenPt(quad(curve.a, curve.c, curve.b, u))
      ctx.beginPath()
      ctx.arc(tip.x, tip.y, this.reduce ? 2 : 2.6, 0, Math.PI * 2)
      ctx.fillStyle = hexA('#EDF0F5', 0.65 * fade)
      ctx.fill()
      if (pulse.label && !this.reduce) {
        ctx.font = '400 10px "DM Sans", sans-serif'
        ctx.fillStyle = hexA(C.muted, 0.9 * fade)
        ctx.textAlign = 'center'
        ctx.fillText(truncateTo(ctx, pulse.label, 96), tip.x, tip.y - 8)
      }
    }
    void now
  }

  private toScreenPt(p: Pt) {
    return this.toScreen(p.x, p.y)
  }

  private drawNode(ctx: CanvasRenderingContext2D, agent: GridAgent, band: Band, now: number, related: Set<string>) {
    const body = this.bodies.get(agent.id)
    if (!body) return
    const p = this.toScreen(body.x, body.y)
    const selected = this.agentId === agent.id
    const dim = this.agentId && !related.has(agent.id)
    const appear = this.reduce ? 1 : Math.min(1, (now - body.born) / 320)
    const expand =
      band === 'close' &&
      (selected || this.hoverId === agent.id || agent.status === 'working' || agent.kind === 'orchestrator')
    ctx.save()
    ctx.globalAlpha = appear * (dim ? 0.28 : 1)
    if (expand) this.drawCloseCard(ctx, agent, p, selected, now)
    else this.drawChip(ctx, agent, p, selected, now, band)
    ctx.restore()
  }

  private drawChip(ctx: CanvasRenderingContext2D, agent: GridAgent, p: Pt, selected: boolean, now: number, band: Band = 'default') {
    const r = nodePx(agent)
    const orch = agent.kind === 'orchestrator'
    const lift = selected || agent.status === 'working' ? 1 : 0
    if (selected) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(237,240,245,0.26)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (orch) {
      const ring = agent.status === 'working' && !this.reduce ? 5.2 + Math.sin(now / 480) * 0.45 : 5
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + ring, 0, Math.PI * 2)
      ctx.strokeStyle = agent.status === 'working' ? 'rgba(111,168,233,0.46)' : 'rgba(111,168,233,0.2)'
      ctx.lineWidth = 1.1
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 2.2, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(37,43,54,0.95)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    roundRect(ctx, p.x - r, p.y - r - lift, r * 2, r * 2, orch ? r : 11)
    ctx.fillStyle = selected || orch || agent.status === 'working' ? C.elevated : C.surface
    ctx.fill()
    ctx.strokeStyle = agent.status === 'failed' ? C.coral : C.border
    ctx.lineWidth = 1
    ctx.stroke()
    const hi = ctx.createLinearGradient(p.x - r, p.y - r, p.x + r, p.y + r)
    hi.addColorStop(0, 'rgba(237,240,245,0.08)')
    hi.addColorStop(0.45, 'rgba(237,240,245,0)')
    ctx.fillStyle = hi
    roundRect(ctx, p.x - r, p.y - r - lift, r * 2, r * 2, orch ? r : 11)
    ctx.fill()
    this.drawStatusAccent(ctx, p.x, p.y - lift, r, agent.status, now)
    if (orch) this.drawMark(ctx, p.x, p.y - lift, r * 0.7)
    else {
      ctx.font = `500 ${r > 20 ? 12 : 11}px "Space Grotesk", sans-serif`
      ctx.fillStyle = C.text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(initials(agent.name), p.x, p.y - lift + 0.5)
      ctx.textBaseline = 'alphabetic'
    }
    if (agent.unread && (selected || band === 'near' || band === 'close')) {
      ctx.beginPath()
      ctx.arc(p.x + r - 2, p.y - r - lift + 2, 2.4, 0, Math.PI * 2)
      ctx.fillStyle = C.blue
      ctx.fill()
    }
  }

  private drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    const u = s / 12
    ctx.strokeStyle = C.text
    ctx.lineCap = 'round'
    ctx.lineWidth = 1.7
    ctx.beginPath()
    ctx.moveTo(x - 5 * u, y - 4 * u)
    ctx.lineTo(x + 5 * u, y - 4 * u)
    ctx.moveTo(x - 5 * u, y)
    ctx.lineTo(x + 5 * u, y)
    ctx.stroke()
    ctx.strokeStyle = '#2B7FFF'
    ctx.beginPath()
    ctx.moveTo(x - 5 * u, y + 4 * u)
    ctx.lineTo(x + 5 * u, y + 4 * u)
    ctx.stroke()
  }

  private drawStatusAccent(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    status: AgentStatus,
    now: number,
  ) {
    ctx.save()
    ctx.translate(x, y)
    if (status === 'working') {
      if (!this.reduce) ctx.rotate((now / 920) % (Math.PI * 2))
      ctx.beginPath()
      ctx.arc(0, 0, r + 1.6, -0.15, 1.25)
      ctx.strokeStyle = C.blue
      ctx.lineWidth = 1.35
      ctx.lineCap = 'round'
      ctx.stroke()
    } else if (status === 'waiting') {
      ctx.beginPath()
      ctx.arc(0, 0, r + 1.4, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(141,150,168,0.28)'
      ctx.lineWidth = 1
      ctx.stroke()
    } else if (status === 'complete') {
      ctx.beginPath()
      ctx.arc(0, 0, r + 1.3, -0.85, -0.15)
      ctx.strokeStyle = C.mint
      ctx.lineWidth = 1.25
      ctx.lineCap = 'round'
      ctx.stroke()
    } else if (status === 'experiment') {
      ctx.beginPath()
      ctx.arc(r - 1.5, -r + 1.5, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = C.amber
      ctx.fill()
    } else if (status === 'failed') {
      ctx.beginPath()
      ctx.moveTo(r - 3.5, -r + 0.5)
      ctx.lineTo(r + 0.5, -r + 4.5)
      ctx.moveTo(r + 0.5, -r + 0.5)
      ctx.lineTo(r - 3.5, -r + 4.5)
      ctx.strokeStyle = C.coral
      ctx.lineWidth = 1.2
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawCloseCard(ctx: CanvasRenderingContext2D, agent: GridAgent, p: Pt, selected: boolean, now: number) {
    const lines = agent.timeline.slice(0, 4)
    const extra = lines.length ? 16 + lines.length * 14 : 0
    const w = this.narrow ? 176 : 208
    const h = (this.narrow ? 96 : 114) + extra
    const x = p.x - w / 2
    const y = p.y - h / 2
    roundRect(ctx, x, y, w, h, 13)
    ctx.fillStyle = C.elevated
    ctx.fill()
    ctx.strokeStyle = selected ? 'rgba(237,240,245,0.38)' : C.border
    ctx.lineWidth = 1
    ctx.stroke()
    this.drawChip(ctx, agent, { x: x + 26, y: y + 26 }, false, now)
    ctx.textAlign = 'left'
    ctx.font = '500 13px "Space Grotesk", sans-serif'
    ctx.fillStyle = C.text
    ctx.fillText(truncateTo(ctx, agent.name, w - 64), x + 48, y + 24)
    ctx.font = '400 11px "DM Sans", sans-serif'
    ctx.fillStyle = C.muted
    ctx.fillText(truncateTo(ctx, `${agent.role} · ${TEAMS[agent.team].name}`, w - 64), x + 48, y + 40)
    ctx.fillStyle = C.text
    ctx.fillText(truncateTo(ctx, agent.task, w - 32), x + 16, y + 64)
    const modelBits = [
      agent.model,
      agent.durationMs != null ? `✓ ${(agent.durationMs / 1000).toFixed(1)}s` : '',
      agent.inputTokens != null ? `${agent.inputTokens >= 1000 ? `${(agent.inputTokens / 1000).toFixed(1)}k` : agent.inputTokens} in` : '',
      this.detailed && agent.inboxAddress ? agent.inboxAddress : '',
    ].filter(Boolean)
    const meta = this.detailed ? modelBits.join(' · ') : [agent.model, agent.tool].filter(Boolean).join(' · ')
    ctx.fillStyle = C.muted
    if (meta) ctx.fillText(truncateTo(ctx, meta, w - 32), x + 16, y + 80)
    else if (agent.recentComm && !this.narrow) ctx.fillText(truncateTo(ctx, agent.recentComm, w - 32), x + 16, y + 96)
    if (lines.length) {
      let rowY = y + 98
      const fresh = Boolean(agent.glowUntil && agent.glowUntil > now)
      for (const [index, item] of lines.entries()) {
        const hot = fresh && index === 0
        ctx.fillStyle = item.mark === '×' ? C.coral : item.mark === '✓' || item.mark === '+' ? C.mint : hot ? C.blue : C.muted
        ctx.globalAlpha = hot ? 1 : 0.86
        ctx.fillText(`${item.mark || '·'} ${truncateTo(ctx, item.summary, w - 40)}`, x + 16, rowY)
        ctx.globalAlpha = 1
        rowY += 14
      }
    }
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    agents: GridAgent[],
    band: Band,
    related: Set<string>,
  ) {
    const boxes: { x: number; y: number; w: number; h: number }[] = []
    const ranked = [...agents].sort((a, b) => importance(b) - importance(a))
    const subReveal = band === 'far' ? 0 : Math.min(1, (this.cam.s - 0.58) / 0.14)
    for (const agent of ranked) {
      const body = this.bodies.get(agent.id)
      if (!body) continue
      const expanded =
        band === 'close' &&
        (this.agentId === agent.id || this.hoverId === agent.id || agent.status === 'working' || agent.kind === 'orchestrator')
      if (expanded) continue
      const p = this.toScreen(body.x, body.y)
      const r = nodePx(agent)
      const dim = Boolean(this.agentId && !related.has(agent.id))
      const keep =
        agent.kind === 'orchestrator' ||
        agent.status === 'working' ||
        agent.status === 'failed' ||
        this.agentId === agent.id
      if ((band === 'far' || agents.length >= 28) && !keep) continue
      const maxW = band === 'far' ? 84 : band === 'near' || band === 'close' ? 148 : 132
      const nameFont = `${agent.kind === 'orchestrator' ? 600 : 500} ${band === 'far' ? 11 : 12}px "Space Grotesk", sans-serif`
      ctx.font = nameFont
      const name = truncateTo(ctx, agent.name, maxW)
      const nameW = ctx.measureText(name).width
      let sub = ''
      if (band === 'near' || band === 'close') {
        ctx.font = '400 11px "DM Sans", sans-serif'
        const richer = [agent.role, agent.task, agent.model || agent.tool].filter(Boolean).join(' · ')
        sub = richer ? truncateTo(ctx, richer, maxW) : ''
      } else if (band === 'default') {
        ctx.font = '400 11px "DM Sans", sans-serif'
        const line = stateLine(agent, agents.length > 16)
        sub = line ? truncateTo(ctx, line, maxW) : ''
      }
      const tryBox = (withSub: boolean) => {
        const subW = withSub && sub ? measure(ctx, sub, '400 11px "DM Sans", sans-serif') : 0
        const w = Math.max(nameW, subW) + 10
        const h = withSub && sub ? 34 : 16
        return { x: p.x - w / 2, y: p.y + r + 8, w, h, withSub }
      }
      let box = tryBox(Boolean(sub) && subReveal > 0.2)
      if (boxes.some((prev) => overlaps(prev, box))) box = tryBox(false)
      if (boxes.some((prev) => overlaps(prev, box))) {
        if (!keep) continue
        box = { x: p.x - (nameW + 10) / 2, y: p.y + r + 8, w: nameW + 10, h: 16, withSub: false }
        if (boxes.some((prev) => overlaps(prev, box))) continue
      }
      boxes.push(box)
      ctx.globalAlpha = dim ? 0.28 : 1
      ctx.textAlign = 'center'
      ctx.font = nameFont
      ctx.fillStyle = C.text
      ctx.fillText(name, p.x, box.y + 11)
      if (box.withSub && sub) {
        ctx.globalAlpha = (dim ? 0.28 : 1) * subReveal
        ctx.font = '400 11px "DM Sans", sans-serif'
        ctx.fillStyle = C.muted
        ctx.fillText(sub, p.x, box.y + 25)
      }
      ctx.globalAlpha = 1
    }
  }
}

function importance(agent: GridAgent) {
  let n = 0
  if (agent.kind === 'orchestrator') n += 20
  if (agent.status === 'failed') n += 12
  if (agent.status === 'working') n += 10
  if (agent.status === 'experiment') n += 4
  if (agent.unread) n += 3
  return n
}

function measure(ctx: CanvasRenderingContext2D, text: string, font: string) {
  ctx.font = font
  return ctx.measureText(text).width
}

function hexA(hex: string, a: number) {
  const n = hex.replace('#', '')
  const r = Number.parseInt(n.slice(0, 2), 16)
  const g = Number.parseInt(n.slice(2, 4), 16)
  const b = Number.parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

export type { AgentTeamId, AgentConnection }
