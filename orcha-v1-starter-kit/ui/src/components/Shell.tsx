import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppState, View } from '../types'
import {
  chatsOf,
  getWorkspace,
  isBusinessOpen,
  listedBusinesses,
  motionReduced,
  openBusiness,
  openChat,
  setSidePane,
  setToolTab,
  signOut,
  subscribeWorkspace,
  toggleBusinessOpen,
} from '../workspace'
import { gridSnapshot, subscribeGrid } from '../agentGrid/adapter.ts'
import { openAgentGrid } from '../agentGrid/open.ts'
import { startDiagnosticCapture } from '../diagnostics'
import { FeedbackSheet } from './FeedbackSheet'
import { OrchaMark } from './OrchaMark'
import { SideSlider } from './SideSlider'
import { Button } from './Wire'

const AgentGrid = lazy(() => import('../agentGrid/AgentGrid.tsx').then((mod) => ({ default: mod.AgentGrid })))

const NAV: { id: View; label: string }[] = [
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'home', label: 'Company home' },
  { id: 'hq', label: 'Live HQ' },
  { id: 'evolution', label: 'Evolution' },
  { id: 'assets', label: 'Assets' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'recovery', label: 'Recovery' },
]

const TITLES: Record<View, string> = {
  onboarding: 'Onboarding',
  home: 'Company home',
  hq: 'Live HQ',
  evolution: 'Evolution',
  assets: 'Assets',
  timeline: 'While you were away',
  recovery: 'Recovery',
  studio: 'Orcha Studio',
}

export function Shell({ state, children }: { state: AppState; children: ReactNode }) {
  const { view, setView, started } = state
  const isChat = view === 'onboarding'

  if (isChat) {
    return (
      <ChatShell>{children}</ChatShell>
    )
  }

  return (
    <div className="app">
      <div className="wf-banner">
        <span>Wireframe · grayscale · layout review</span>
        <strong>All copy and metrics are labeled synthetic.</strong>
      </div>
      <aside className="rail">
        <div className="brand"><span className="brand-box" /><span>orcha</span></div>
        <div>
          <p className="note-label">Company switcher</p>
          <div className="company-chip">
            <span className="avatar">S</span>
            <div><b>StudyFlow</b><small>Personal company · synthetic</small></div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <p className="note-label">Inspect-first, not default home</p>
          <button className={`nav-item ${view === 'studio' ? 'active' : ''}`} onClick={() => setView('studio')}>
            <span>Orcha Studio</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumbs"><span>StudyFlow</span><span>/</span><strong>{TITLES[view]}</strong></div>
          <div className="top-meta">
            <span className="pill">{started ? 'Runtime healthy' : 'Not started'}</span>
            <span className="pill">VM online · synthetic</span>
            <span className="pill">Cost $2.18 / $25</span>
            <Button variant="ghost" onClick={() => setView('onboarding')}>Back to start</Button>
          </div>
        </header>
        <div className="page">{children}</div>
      </div>
    </div>
  )
}

function prefersReducedMotion() {
  return motionReduced()
}

function SideFold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`chat-side-fold${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open || undefined}>
      <div className="chat-side-fold-in">{children}</div>
    </div>
  )
}

function ChatShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [setOpenMenu, setSetOpenMenu] = useState(false)
  const [gridOpen, setGridOpen] = useState(false)
  const [gridClosing, setGridClosing] = useState(false)
  const [gridFocus, setGridFocus] = useState<string | null>(null)
  const [gridInspect, setGridInspect] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [gridSynthetic, setGridSynthetic] = useState(() => gridSnapshot().synthetic)
  const [room, setRoom] = useState(getWorkspace)
  const [pane, setPane] = useState<'chats' | 'tools'>(() => (getWorkspace().side.pane === 'tools' ? 'tools' : 'chats'))
  const markT = useRef(0)
  const sideT = useRef(0)
  const newAnim = useRef(0)
  const setAnim = useRef(0)
  const gridTimer = useRef<number | null>(null)
  const gridCloseTimer = useRef<number | null>(null)
  const gridClosingRef = useRef(false)
  const gridOpenRef = useRef(false)
  const [markOpen, setMarkOpen] = useState(0)
  const sideRef = useRef<HTMLElement>(null)
  const brandRef = useRef<HTMLButtonElement>(null)
  const sideReturnFocusRef = useRef<HTMLElement | null>(null)
  const newIconRef = useRef<SVGSVGElement>(null)
  const newMenuRef = useRef<HTMLDivElement>(null)
  const newWrapRef = useRef<HTMLDivElement>(null)
  const setMenuRef = useRef<HTMLDivElement>(null)

  const startNew = (kind: 'chat' | 'company') => {
    setNewOpen(false)
    window.dispatchEvent(new CustomEvent('orcha:new', { detail: { kind } }))
    if (kind === 'company') {
      window.setTimeout(() => setOpen(false), 480)
      return
    }
    setOpen(false)
    document.querySelector<HTMLTextAreaElement>('.gpt-composer textarea')?.focus()
  }

  useEffect(() => {
    const fromMark = markT.current
    const fromSide = sideT.current
    const to = open ? 1 : 0
    const start = performance.now()
    const dur = 420
    let raf = 0
    const place = (s: number) => {
      markT.current = fromMark + (to - fromMark) * s
      sideT.current = fromSide + (to - fromSide) * s
      setMarkOpen(markT.current)
      const side = sideRef.current
      if (side) side.style.transform = `translateX(${(-100 + 100 * sideT.current)}%)`
    }
    if (prefersReducedMotion()) {
      place(1)
      return
    }
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / dur)
      // The return journey holds for a beat before leaving the canvas, so
      // closing the menu reads as a deliberate exit rather than a jump.
      const s = open
        ? 1 - (1 - u) ** 3
        : u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2
      place(s)
      if (u < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  useEffect(() => {
    const side = sideRef.current
    if (!side) return

    // The rail is animated off-canvas instead of conditionally unmounted so
    // its exit motion can finish. Inert makes that visual state truthful to
    // keyboard and assistive-technology users as well.
    side.toggleAttribute('inert', !open)
    if (open) {
      const active = document.activeElement
      sideReturnFocusRef.current = active instanceof HTMLElement ? active : null
      const focusId = window.requestAnimationFrame(() => {
        const first = side.querySelector<HTMLElement>('[tabindex="0"], button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])')
        first?.focus({ preventScroll: true })
      })
      return () => window.cancelAnimationFrame(focusId)
    }

    if (document.activeElement instanceof HTMLElement && side.contains(document.activeElement)) {
      ;(sideReturnFocusRef.current ?? brandRef.current)?.focus({ preventScroll: true })
    }
    sideReturnFocusRef.current = null
  }, [open])

  useEffect(() => {
    if (!open) {
      setNewOpen(false)
      setSetOpenMenu(false)
    }
  }, [open])

  useEffect(() => subscribeWorkspace(() => setRoom({ ...getWorkspace() })), [])

  useEffect(() => {
    startDiagnosticCapture()
  }, [])

  useEffect(() => subscribeGrid(() => setGridSynthetic(gridSnapshot().synthetic)), [])

  useEffect(() => {
    gridOpenRef.current = gridOpen
  }, [gridOpen])

  useEffect(() => () => {
    if (gridTimer.current !== null) window.clearTimeout(gridTimer.current)
    if (gridCloseTimer.current !== null) window.clearTimeout(gridCloseTimer.current)
  }, [])

  const requestGridClose = () => {
    if (gridClosingRef.current) return
    gridClosingRef.current = true
    setGridClosing(true)
    setGridFocus(null)
    setGridInspect(false)
    if (gridCloseTimer.current !== null) window.clearTimeout(gridCloseTimer.current)
    if (prefersReducedMotion()) {
      gridClosingRef.current = false
      setGridClosing(false)
      setGridOpen(false)
      return
    }
    gridCloseTimer.current = window.setTimeout(() => {
      gridCloseTimer.current = null
      gridClosingRef.current = false
      setGridClosing(false)
      setGridOpen(false)
    }, 380)
  }

  useEffect(() => {
    const onGrid = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? (event.detail as { open?: boolean; agentId?: string; inspect?: boolean } | undefined)
        : undefined
      if (detail?.open === false) {
        if (gridTimer.current !== null) window.clearTimeout(gridTimer.current)
        gridTimer.current = null
        requestGridClose()
        return
      }
      if (gridCloseTimer.current !== null) {
        window.clearTimeout(gridCloseTimer.current)
        gridCloseTimer.current = null
      }
      gridClosingRef.current = false
      setGridClosing(false)
      setNewOpen(false)
      setSetOpenMenu(false)
      setGridFocus(detail?.agentId ?? null)
      setGridInspect(Boolean(detail?.inspect))

      // Give the rail its full close motion before showing the workspace.
      // When the grid is already behind the open rail, it stays visible.
      if (gridTimer.current !== null) window.clearTimeout(gridTimer.current)
      setOpen(false)
      if (gridOpenRef.current || sideT.current < 0.01 || prefersReducedMotion()) {
        setGridOpen(true)
        return
      }
      gridTimer.current = window.setTimeout(() => {
        setGridOpen(true)
        gridTimer.current = null
      }, 420)
    }
    window.addEventListener('orcha:agent-grid', onGrid)
    return () => window.removeEventListener('orcha:agent-grid', onGrid)
  }, [])

  useEffect(() => {
    const icon = newIconRef.current
    const menu = newMenuRef.current
    const from = newAnim.current
    const to = newOpen ? 1 : 0
    const start = performance.now()
    const dur = 360
    let raf = 0
    const place = (t: number) => {
      newAnim.current = t
      if (icon) icon.style.transform = `rotate(${45 * t}deg)`
      if (menu) {
        menu.style.opacity = String(t)
        menu.style.transform = `translateY(${(1 - t) * 22}px)`
        menu.style.visibility = t === 0 ? 'hidden' : 'visible'
        menu.style.pointerEvents = t > 0.55 ? 'auto' : 'none'
      }
    }
    if (Math.abs(from - to) < 0.001) {
      place(to)
      return
    }
    if (prefersReducedMotion()) {
      place(to)
      return
    }
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / dur)
      const s = 1 - (1 - u) ** 3
      place(from + (to - from) * s)
      if (u < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [newOpen])

  useEffect(() => {
    if (!newOpen) return
    const onDown = (event: PointerEvent) => {
      const wrap = newWrapRef.current
      if (wrap?.contains(event.target as Node)) return
      setNewOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [newOpen])

  useEffect(() => {
    const menu = setMenuRef.current
    const from = setAnim.current
    const to = setOpenMenu ? 1 : 0
    const start = performance.now()
    const dur = 360
    let raf = 0
    const place = (t: number) => {
      setAnim.current = t
      if (menu) {
        menu.style.opacity = String(t)
        menu.style.transform = `translateY(${(1 - t) * 16}px)`
        menu.style.visibility = t === 0 ? 'hidden' : 'visible'
        menu.style.pointerEvents = t > 0.55 ? 'auto' : 'none'
      }
    }
    if (Math.abs(from - to) < 0.001) {
      place(to)
      return
    }
    if (prefersReducedMotion()) {
      place(to)
      return
    }
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / dur)
      const s = 1 - (1 - u) ** 3
      place(from + (to - from) * s)
      if (u < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [setOpenMenu])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !gridOpen) {
        const side = sideRef.current
        if (!side) return
        const focusable = Array.from(side.querySelectorAll<HTMLElement>('[tabindex="0"], button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'))
          .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'))
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus({ preventScroll: true })
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus({ preventScroll: true })
        }
        return
      }
      if (event.key !== 'Escape') return
      if (gridOpen) return
      if (newOpen) {
        setNewOpen(false)
        return
      }
      if (setOpenMenu) {
        setSetOpenMenu(false)
        return
      }
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, newOpen, setOpenMenu, gridOpen])

  const pickPane = (next: 'chats' | 'tools') => {
    setNewOpen(false)
    setPane(next)
    setSidePane(next)
    if (next === 'chats') {
      setGridOpen(false)
      setGridFocus(null)
      setGridInspect(false)
    }
  }

  return (
    <div className={`app chat-mode${open ? ' has-side' : ''}${gridOpen ? ' has-agent-grid' : ''}`}>
      <aside id="chat-side-panel" ref={sideRef} className="chat-side" aria-label="Workspace menu" aria-hidden={!open} inert={!open || undefined}>
        <div className="chat-side-top">
          <SideSlider value={pane} onChange={pickPane} />
          {pane === 'chats' && (
          <div ref={newWrapRef} className={`chat-side-new-wrap${newOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className={`chat-side-new${newOpen ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={newOpen}
              onClick={() => {
                setSetOpenMenu(false)
                setNewOpen((value) => !value)
              }}
            >
              <svg ref={newIconRef} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
              </svg>
              New
            </button>
            <div
              ref={newMenuRef}
              className="chat-side-new-menu"
              role="menu"
              aria-label="Start something new"
              aria-hidden={!newOpen}
            >
              <button
                type="button"
                role="menuitem"
                className="chat-side-new-item"
                tabIndex={newOpen ? 0 : -1}
                onClick={() => startNew('company')}
              >
                New business
              </button>
              <button
                type="button"
                role="menuitem"
                className="chat-side-new-item"
                tabIndex={newOpen ? 0 : -1}
                onClick={() => startNew('chat')}
              >
                New chat
              </button>
            </div>
          </div>
          )}
          {pane === 'tools' && (
            <div className="chat-side-tools-tabs" role="tablist" aria-label="Tools">
              <button
                type="button"
                role="tab"
                id="side-tab-agentgrid"
                aria-selected
                className="chat-side-tools-tab is-on"
                onClick={() => {
                  setToolTab('agents')
                  openAgentGrid()
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                  <circle cx="6" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="18" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="12" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m7.8 8.3 2.7 6.1M16.2 8.3l-2.7 6.1M8.3 7h7.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <span>
                  <b>Agent Grid</b>
                  <small>{gridSynthetic ? 'Inspect the work in motion · Demo' : 'Live company graph'}</small>
                </span>
                <svg className="chat-side-tools-arrow" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="m9 5.6 6.4 6.4L9 18.4l-1.4-1.4 5-5-5-5z" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div
          className="chat-side-list"
          id={pane === 'chats' ? 'side-pane-chats' : 'side-pane-tools'}
          role="tabpanel"
          aria-labelledby={pane === 'chats' ? 'side-tab-chats' : 'side-tab-tools'}
        >
          {pane === 'chats' && listedBusinesses().length > 0 && (
            <div className="chat-side-group">
              {listedBusinesses().map((business) => {
                const shown = isBusinessOpen(business.id)
                const active = business.id === room.currentBusinessId
                const chats = chatsOf(business)
                return (
                  <div key={business.id} className={`chat-side-biz-wrap${active ? ' is-active' : ''}`}>
                    <button
                      type="button"
                      className={`chat-side-label is-toggle is-biz${shown ? ' is-open' : ''}${active ? ' is-current' : ''}`}
                      aria-expanded={shown}
                      onClick={() => toggleBusinessOpen(business.id)}
                    >
                      <span>
                        {business.name}
                        <small>{new Date(business.createdAt).toLocaleDateString()}</small>
                      </span>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" />
                      </svg>
                    </button>
                    <SideFold open={shown}>
                      {chats.map((chat) => (
                        <button
                          key={chat.id}
                          type="button"
                          className={`chat-side-item${chat.id === room.currentChatId ? ' is-on' : ''}`}
                          tabIndex={shown ? 0 : -1}
                          onClick={() => {
                            openChat(business.id, chat.id)
                            setOpen(false)
                          }}
                        >
                          {chat.title}
                        </button>
                      ))}
                      {chats.length === 0 && (
                        <button
                          type="button"
                          className="chat-side-item chat-side-biz"
                          tabIndex={shown ? 0 : -1}
                          onClick={() => {
                            openBusiness(business.id)
                            setOpen(false)
                          }}
                        >
                          Open
                        </button>
                      )}
                    </SideFold>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="chat-side-foot">
          <button
            type="button"
            className="chat-side-item chat-side-you"
            title={room.signedIn && room.account ? room.account.name : 'You'}
            onClick={() => {
              setNewOpen(false)
              setSetOpenMenu((value) => !value)
            }}
          >
            <span className="chat-side-you-name">{room.signedIn && room.account ? room.account.name : 'You'}</span>
          </button>
          <div className={`chat-side-set-wrap${setOpenMenu ? ' is-open' : ''}`}>
            <button
              type="button"
              className={`chat-side-set${setOpenMenu ? ' is-open' : ''}`}
              aria-label="Settings"
              aria-haspopup="menu"
              aria-expanded={setOpenMenu}
              onClick={() => {
                setNewOpen(false)
                setSetOpenMenu((value) => !value)
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                <circle cx="9" cy="7" r="2.1" fill="currentColor" />
                <circle cx="15" cy="12" r="2.1" fill="currentColor" />
                <circle cx="10" cy="17" r="2.1" fill="currentColor" />
              </svg>
            </button>
            <div
              ref={setMenuRef}
              className="chat-side-set-menu"
              role="menu"
              aria-label="Settings"
              aria-hidden={!setOpenMenu}
            >
              <div className="chat-side-set-who">
                <b>{room.signedIn && room.account ? room.account.name : 'You'}</b>
                <small>
                  {room.signedIn && room.account
                    ? room.account.email
                    : room.account ? 'Signed out' : 'Not signed in'}
                </small>
              </div>
              {room.signedIn && room.account ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="chat-side-new-item"
                    tabIndex={setOpenMenu ? 0 : -1}
                    onClick={() => {
                      setSetOpenMenu(false)
                      setOpen(false)
                      window.dispatchEvent(new CustomEvent('orcha:new', { detail: { kind: 'settings' } }))
                    }}
                  >
                    Account
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="chat-side-new-item"
                    tabIndex={setOpenMenu ? 0 : -1}
                    onClick={() => {
                      signOut()
                      setSetOpenMenu(false)
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="chat-side-new-item"
                  tabIndex={setOpenMenu ? 0 : -1}
                    onClick={() => {
                      setSetOpenMenu(false)
                      setOpen(false)
                      window.dispatchEvent(new CustomEvent('orcha:new', { detail: { kind: 'settings' } }))
                    }}
                  >
                    {room.account ? 'Sign in' : 'Sign up'}
                  </button>
              )}
            </div>
          </div>
        </div>
      </aside>
      {open && (
        <button type="button" className="chat-side-dim" aria-label="Close menu" onClick={() => setOpen(false)} />
      )}
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="chat-brand"
            ref={brandRef}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="chat-side-panel"
            onClick={() => {
              if (gridOpen) {
                setOpen((value) => !value)
                return
              }
              setOpen((value) => !value)
            }}
          >
            <OrchaMark size={24} open={markOpen} />
            <strong>orcha</strong>
          </button>
          <div className="chat-top-actions">
            <button type="button" className="chat-feedback" aria-label="Open feedback" onClick={() => setFeedbackOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.8A2.8 2.8 0 0 1 7.8 3h8.4A2.8 2.8 0 0 1 19 5.8v6.4a2.8 2.8 0 0 1-2.8 2.8H11l-3.8 3v-3H7.8A2.8 2.8 0 0 1 5 12.2V5.8Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </header>
        <div className="page">
          {children}
          {gridOpen && (
            <Suspense fallback={null}>
            <AgentGrid
              focusId={gridFocus}
              inspectOnOpen={gridInspect}
              closing={gridClosing}
              onClose={requestGridClose}
            />
            </Suspense>
          )}
        </div>
      </div>
      {feedbackOpen && <FeedbackSheet onClose={() => setFeedbackOpen(false)} />}
    </div>
  )
}
