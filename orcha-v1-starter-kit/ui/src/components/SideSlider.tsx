import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { motionReduced } from '../workspace'

type Pane = 'chats' | 'tools'

function reduced() {
  return motionReduced()
}

function rubber(over: number, dim: number) {
  if (over === 0 || dim <= 0) return 0
  const sign = over < 0 ? -1 : 1
  const x = Math.abs(over)
  const banded = (1 - 1 / (x * 0.55 / dim + 1)) * dim * 0.42
  return sign * Math.min(22, banded)
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="13" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M7 8.2h6.5M7 11h4.2" />
      <path stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" d="M9.2 14.5v3.2L13 14.5" />
    </svg>
  )
}

function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <path stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M17 13.5v7M13.5 17h7" />
    </svg>
  )
}

export function SideSlider({ value, onChange }: { value: Pane; onChange: (next: Pane) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const metrics = useRef({ pad: 3, travel: 0, baseW: 0, restW: 0 })
  const visual = useRef({ p: value === 'tools' ? 1 : 0, stretch: 0 })
  const drag = useRef({
    active: false,
    moved: false,
    pointer: -1,
    startX: 0,
    startP: 0,
    lastX: 0,
    lastT: 0,
    vx: 0,
  })
  const snapRaf = useRef(0)
  const ignorePane = useRef(false)
  const [hot, setHot] = useState<Pane>(value)
  const [grabbing, setGrabbing] = useState(false)

  const measure = () => {
    const host = hostRef.current
    if (!host) return
    const pad = 3
    const restW = host.clientWidth
    const inner = Math.max(0, restW - pad * 2)
    metrics.current = { pad, restW, travel: inner / 2, baseW: inner / 2 }
  }

  const paint = () => {
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!track || !thumb) return
    const { pad, restW, baseW } = metrics.current
    if (restW <= 0) return
    const { p, stretch } = visual.current
    const extra = Math.abs(stretch)
    if (extra < 0.1) {
      track.style.width = ''
      track.style.marginLeft = ''
    } else {
      // Width always grows to the right; pull left by shifting margin so the
      // opposite edge stays put and the pill rubber-bands toward the drag.
      track.style.width = `${restW + extra}px`
      track.style.marginLeft = `${stretch < 0 ? stretch : 0}px`
    }
    const half = baseW + extra / 2
    thumb.style.left = `${pad}px`
    thumb.style.width = `${half}px`
    thumb.style.transform = `translateX(${p * half}px)`
  }

  const settle = (next: Pane) => {
    cancelAnimationFrame(snapRaf.current)
    const to = next === 'tools' ? 1 : 0
    ignorePane.current = true
    onChange(next)
    setHot(next)
    setGrabbing(false)
    const done = () => {
      ignorePane.current = false
    }
    if (reduced()) {
      visual.current = { p: to, stretch: 0 }
      paint()
      done()
      return
    }
    const fromP = visual.current.p
    const fromS = visual.current.stretch
    const start = performance.now()
    const dur = 280
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / dur)
      const s = 1 - (1 - u) ** 3
      visual.current = { p: fromP + (to - fromP) * s, stretch: fromS * (1 - s) }
      paint()
      if (u < 1) snapRaf.current = requestAnimationFrame(tick)
      else done()
    }
    snapRaf.current = requestAnimationFrame(tick)
  }

  useLayoutEffect(() => {
    measure()
    paint()
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      measure()
      paint()
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(snapRaf.current)
    }
  }, [])

  useLayoutEffect(() => {
    if (drag.current.active || ignorePane.current) return
    visual.current = { p: value === 'tools' ? 1 : 0, stretch: 0 }
    setHot(value)
    measure()
    paint()
  }, [value])

  const applyPointer = (clientX: number) => {
    const { travel } = metrics.current
    if (travel <= 0) return
    const raw = drag.current.startP + (clientX - drag.current.startX) / travel
    const p = Math.min(1, Math.max(0, raw))
    const stretch = reduced() ? 0 : rubber((raw - p) * travel, travel)
    visual.current = { p, stretch }
    paint()
    const next: Pane = p >= 0.5 ? 'tools' : 'chats'
    setHot((cur) => (cur === next ? cur : next))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    cancelAnimationFrame(snapRaf.current)
    ignorePane.current = false
    measure()
    const track = trackRef.current
    track?.setPointerCapture(event.pointerId)
    drag.current = {
      active: true,
      moved: false,
      pointer: event.pointerId,
      startX: event.clientX,
      startP: visual.current.p,
      lastX: event.clientX,
      lastT: performance.now(),
      vx: 0,
    }
    visual.current.stretch = 0
    setGrabbing(true)
    paint()
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || event.pointerId !== drag.current.pointer) return
    const now = performance.now()
    const dt = Math.max(8, now - drag.current.lastT)
    drag.current.vx = (event.clientX - drag.current.lastX) / dt
    drag.current.lastX = event.clientX
    drag.current.lastT = now
    if (Math.abs(event.clientX - drag.current.startX) > 6) drag.current.moved = true
    applyPointer(event.clientX)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || event.pointerId !== drag.current.pointer) return
    drag.current.active = false
    try {
      trackRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    measure()
    const { travel } = metrics.current
    const mid = trackRef.current?.getBoundingClientRect()
    if (!drag.current.moved) {
      const clicked: Pane = mid && event.clientX >= mid.left + mid.width / 2 ? 'tools' : 'chats'
      settle(clicked)
      return
    }
    let next: Pane = visual.current.p >= 0.5 ? 'tools' : 'chats'
    if (Math.abs(drag.current.vx) > 0.35) next = drag.current.vx > 0 ? 'tools' : 'chats'
    if (travel > 0) applyPointer(event.clientX)
    settle(next)
  }

  return (
    <div ref={hostRef} className="chat-side-slider-host">
      <div
        ref={trackRef}
        className={`chat-side-slider${value === 'tools' ? ' is-tools' : ''}${grabbing ? ' is-grabbing' : ''}`}
        role="tablist"
        aria-label="Sidebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault()
            settle(event.key === 'ArrowRight' ? 'tools' : 'chats')
          }
        }}
      >
        <span ref={thumbRef} className="chat-side-slider-thumb" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          id="side-tab-chats"
          aria-controls="side-pane-chats"
          aria-selected={value === 'chats'}
          className={`chat-side-slider-btn${hot === 'chats' ? ' is-on' : ''}`}
          tabIndex={value === 'chats' ? 0 : -1}
          onClick={() => settle('chats')}
        >
          <ChatIcon />
          Chats
        </button>
        <button
          type="button"
          role="tab"
          id="side-tab-tools"
          aria-controls="side-pane-tools"
          aria-selected={value === 'tools'}
          className={`chat-side-slider-btn${hot === 'tools' ? ' is-on' : ''}`}
          tabIndex={value === 'tools' ? 0 : -1}
          onClick={() => settle('tools')}
        >
          <ToolsIcon />
          Tools
        </button>
      </div>
    </div>
  )
}
