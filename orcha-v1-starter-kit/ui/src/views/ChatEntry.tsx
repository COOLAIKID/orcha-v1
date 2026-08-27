import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { FIELD_H, FIELD_W, getBlueFieldHref } from '../blueField'
import { offlineReply, presentReply } from '../chatReply'
import { blockedPrompt, blockedReply } from '../legal'
import type { AppState } from '../types'
import {
  addReport,
  currentBusiness,
  currentChat,
  getPrefs,
  getWorkspace,
  instructionBlock,
  isSignedIn,
  motionReduced,
  newChat,
  signIn,
  signUp,
  startBusiness,
  subscribeWorkspace,
  titleFrom,
  writeMessages,
} from '../workspace'
import { abortCompanyRunVisual, beginCompanyRun, companyRuntimeStatus, ensureRuntimeCompany, fetchInternalDiagnostics, hasLiveCompanyVisual, hydrateCompanyRuntime, ingestRuntimeEvents, pauseCompanyRuntime, pollRuntimeEvents, resumeCompanyRuntime, seedPlannedTasks, startCompanyRun, stopRuntime, startWorkspaceCheck, subscribeCompanyEvents, type DomainEvent } from '../runtimeClient'
import { previewFromEvent } from '../runtimeEvents'
import { CompanyLiveProgress } from '../activity/CompanyLiveProgress'
import { CHAT_TOOLS, ToolGlyph } from '../chatTools'
import { CompanyOnboard } from './CompanyOnboard'
import { Settings } from './Settings'
import { SignIn } from './SignIn'
import { SignUp } from './SignUp'

type DraftTool = {
  key: string
  label: string
  icon: (typeof CHAT_TOOLS)[number]['icon']
  detail?: string
}

type ChatMsg = {
  id: string
  role: 'user' | 'orcha'
  content: string
  tools?: DraftTool[]
  kind?: 'steer'
  previewUrl?: string
  liveWork?: boolean
}

function presentStoredMessage(message: ChatMsg): ChatMsg {
  // Older local chats can contain the API's raw 404 detail from before
  // runtime-company rehydration existed. Keep the history, but make the
  // recovery path legible instead of presenting an implementation error.
  if (message.role === 'orcha' && message.content.trim() === 'Company not found') {
    return {
      ...message,
      content: 'This local company needs to reconnect after the workspace restarted. Run /workspace-check to reconnect it.',
    }
  }
  return message
}

type QueuedTurn = { id: string; text: string; tools: DraftTool[] }

function packContent(tools: DraftTool[], text: string) {
  const head = tools.map((tool) => (tool.detail ? `${tool.label}: ${tool.detail}` : tool.label)).join(', ')
  return [head, text].filter(Boolean).join('\n\n')
}

function isCompanyBuildRequest(text: string) {
  return /\b(build|create|develop|implement|launch|make)\b/i.test(text)
    && /\b(app|site|website|landing page|product|tool|dashboard|prototype|page)\b/i.test(text)
}

const WORDS = ['CREATE', 'BUILD', 'AUTOMATE', 'BUILD'] as const
const GLOW_MS = 7200
const FLIP_MS = 900
const PAINT_INTERVAL = 1000 / 30

function easeFlip(t: number) {
  return 1 - (1 - t) ** 3
}

function easeSlide(t: number) {
  return t * t * (3 - 2 * t)
}

/** DESIGN.md: reduced-motion users get the final state immediately. */
function prefersReducedMotion() {
  return motionReduced()
}

function HollowGlyph({
  text,
  href,
  fieldRef,
}: {
  text: string
  href: string
  fieldRef?: Ref<HTMLSpanElement>
}) {
  return (
    <span
      className="hollow-wrap"
      ref={fieldRef}
      style={{ backgroundImage: `url("${href}")` }}
    >
      {text}
    </span>
  )
}

function FlipWord() {
  const lineRef = useRef<HTMLSpanElement>(null)
  const leadHostRef = useRef<HTMLSpanElement>(null)
  const qHostRef = useRef<HTMLSpanElement>(null)
  const stageRef = useRef<HTMLSpanElement>(null)
  const cubeRef = useRef<HTMLSpanElement>(null)
  const frontHostRef = useRef<HTMLSpanElement>(null)
  const bottomRef = useRef<HTMLSpanElement>(null)
  const measuresRef = useRef<HTMLSpanElement>(null)
  const widthsRef = useRef([0, 0, 0, 0])
  const [fieldHref, setFieldHref] = useState('')
  const [renderedTurn, setRenderedTurn] = useState(0)
  const leadFieldRef = useRef<HTMLSpanElement>(null)
  const frontFieldRef = useRef<HTMLSpanElement>(null)
  const bottomFieldRef = useRef<HTMLSpanElement>(null)
  const qFieldRef = useRef<HTMLSpanElement>(null)
  const cropRef = useRef({ x: FIELD_W * 0.82, y: FIELD_H * 0.36 })

  const measureWords = () => {
    const line = lineRef.current
    const host = measuresRef.current
    if (line) {
      const cs = getComputedStyle(line)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        const tracking = cs.letterSpacing === 'normal' ? 0 : Number.parseFloat(cs.letterSpacing) || 0
        const next = WORDS.map((word) => ctx.measureText(word).width + tracking * Math.max(0, word.length - 1))
        if (next.every((value) => value > 8)) {
          widthsRef.current = next
          return
        }
      }
    }
    if (!host) return
    const next = Array.from(host.children, (child) => (child as HTMLElement).getBoundingClientRect().width)
    if (next.every((value) => value > 8)) widthsRef.current = next
  }

  useLayoutEffect(() => {
    measureWords()
    void document.fonts.ready.then(measureWords)
    window.addEventListener('resize', measureWords)
    return () => window.removeEventListener('resize', measureWords)
  }, [])

  useEffect(() => {
    if (fieldHref) return
    const win = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    const run = () => setFieldHref(getBlueFieldHref())
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(run, { timeout: 2500 })
      return () => win.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(run, 0)
    return () => window.clearTimeout(id)
  }, [fieldHref])

  useEffect(() => {
    if (!fieldHref) return

    let raf = 0
    let phase: 'glow' | 'flip' = 'glow'
    let mark = performance.now()
    let turn = 0
    let spotX = cropRef.current.x
    let spotY = cropRef.current.y
    let lastPaint = 0
    let layout: { lead: number; stage: number; bottom: number; q: number } | null = null
    measureWords()

    const paint = (spin: number, slide: number, flipping: boolean, now: number) => {
      const stage = stageRef.current
      const cube = cubeRef.current
      const front = frontHostRef.current
      const bottom = bottomRef.current
      const line = lineRef.current
      const lead = leadHostRef.current
      const q = qHostRef.current
      if (!stage || !cube || !front || !bottom || !line || !lead || !q) return
      const from = turn % WORDS.length
      const to = (turn + 1) % WORDS.length
      if (widthsRef.current.some((value) => value < 8)) measureWords()
      const fromW = widthsRef.current[from]
      const toW = widthsRef.current[to]
      const maxW = Math.max(0, ...widthsRef.current)
      if (maxW > 8) {
        stage.style.width = `${maxW}px`
        stage.style.flexBasis = `${maxW}px`
      }
      const verbW = (fromW > 8 && toW > 8) ? fromW + (toW - fromW) * slide : fromW
      const lineShift = maxW > 8 && verbW > 8 ? (maxW - verbW) / 2 : 0
      const qShift = maxW > 8 && verbW > 8 ? verbW - maxW : 0
      if (maxW > 8 && verbW > 8) {
        line.style.transform = `translate3d(${lineShift}px, 0, 0)`
        q.style.transform = `translate3d(${qShift}px, 0, 0)`
      } else {
        line.style.transform = 'none'
        q.style.transform = 'none'
      }
      cube.style.transform = `rotateX(${spin * 90}deg)`
      stage.classList.toggle('is-flipping', flipping)
      // Keep one face authoritative at a time. Perspective rendering can put
      // both faces inside the clipped viewport around the handoff, which reads
      // as a duplicated headline on slower mobile GPUs.
      front.style.opacity = !flipping || spin < 0.5 ? '1' : '0'
      bottom.style.opacity = flipping && spin >= 0.5 ? '1' : '0'

      // A single predictable sweep is easier to follow and avoids the
      // start-stop feeling of the old random 2D target chase. The image moves
      // right-to-left so the bright lane itself travels left-to-right.
      const glowProgress = phase === 'glow' ? Math.min(1, Math.max(0, (now - mark) / GLOW_MS)) : 1
      const scanStart = FIELD_W * 0.82
      const scanEnd = -FIELD_W * 0.12
      spotX = scanStart + (scanEnd - scanStart) * glowProgress
      spotY = FIELD_H * 0.36
      cropRef.current = { x: spotX, y: spotY }

      // Text background coordinates only need to resync as the layout changes.
      // Reading four client rects on every animation frame caused avoidable
      // mobile reflow while the headline was flipping.
      if (!layout) {
        const box = line.getBoundingClientRect()
        layout = {
          lead: lead.getBoundingClientRect().left - box.left,
          stage: stage.getBoundingClientRect().left - box.left,
          bottom: stage.getBoundingClientRect().left - box.left,
          q: q.getBoundingClientRect().left - box.left - qShift,
        }
      }
      const place = (field: HTMLSpanElement | null, offset: number, extra = 0) => {
        if (!field) return
        field.style.backgroundPosition = `${-(spotX + offset + lineShift + extra)}px ${-spotY}px`
      }
      place(leadFieldRef.current, layout.lead)
      place(frontFieldRef.current, layout.stage)
      place(bottomFieldRef.current, layout.bottom)
      place(qFieldRef.current, layout.q, qShift)
    }

    paint(0, 0, false, performance.now())

    if (prefersReducedMotion()) return

    const tick = (now: number) => {
      const interval = phase === 'flip' ? 1000 / 60 : PAINT_INTERVAL
      if (now - lastPaint < interval) {
        raf = requestAnimationFrame(tick)
        return
      }
      lastPaint = now
      if (phase === 'glow') {
        paint(0, 0, false, now)
        if (now - mark >= GLOW_MS) {
          phase = 'flip'
          mark = now
        }
      } else {
        const t = Math.min(1, (now - mark) / FLIP_MS)
        paint(easeFlip(t), easeSlide(t), true, now)
        if (t >= 1) {
          turn += 1
          setRenderedTurn(turn)
          phase = 'glow'
          mark = now
          paint(0, 0, false, now)
        }
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    const onResize = () => {
      layout = null
      measureWords()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        return
      }
      lastPaint = 0
      mark = performance.now()
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fieldHref])

  return (
    <>
      <span className="flip-measures" ref={measuresRef} aria-hidden="true">
        {WORDS.map((word, i) => (
          <span key={`${word}-${i}`} className="flip-verb flip-measure">{word}</span>
        ))}
      </span>
      <span className="flip-line" ref={lineRef}>
        <span className="chat-title-lead" ref={leadHostRef}>
          {fieldHref ? (
            <HollowGlyph text="WHAT COULD WE" href={fieldHref} fieldRef={leadFieldRef} />
          ) : 'WHAT COULD WE'}
        </span>
        <span className="flip-stage" ref={stageRef}>
          <span className="flip-viewport">
            <span className="flip-cube" ref={cubeRef}>
              <span className="flip-verb flip-front" ref={frontHostRef}>
                {fieldHref ? (
                  <HollowGlyph
                    text={WORDS[renderedTurn % WORDS.length]}
                    href={fieldHref}
                    fieldRef={frontFieldRef}
                  />
                ) : 'CREATE'}
              </span>
              <span className="flip-bottom" ref={bottomRef} aria-hidden="true">
                {fieldHref ? (
                  <HollowGlyph
                    text={WORDS[(renderedTurn + 1) % WORDS.length]}
                    href={fieldHref}
                    fieldRef={bottomFieldRef}
                  />
                ) : 'BUILD'}
              </span>
            </span>
          </span>
        </span>
        <span className="flip-q" ref={qHostRef}>
          {fieldHref ? (
            <HollowGlyph text="?" href={fieldHref} fieldRef={qFieldRef} />
          ) : '?'}
        </span>
      </span>
    </>
  )
}

const SLASH_CMDS = [
  { id: 'workspace-check', name: '/workspace-check', hint: 'Create a real workspace test file', arg: false },
  { id: 'runtime-status', name: '/runtime-status', hint: 'Show verified company runtime state', arg: false },
  { id: 'pause-company', name: '/pause-company', hint: 'Pause new company work', arg: false },
  { id: 'resume-company', name: '/resume-company', hint: 'Resume paused company work', arg: false },
  { id: 'stop', name: '/stop', hint: 'Stop this generation', arg: false },
  { id: 'diagnostics', name: '/diagnostics', hint: 'Show operator runtime status', arg: false },
  { id: 'steer', name: '/steer', hint: 'Steer the current reply', arg: true },
  { id: 'queue', name: '/queue', hint: 'Send after this reply', arg: true },
  { id: 'new', name: '/new', hint: 'Start a new chat', arg: false },
  ...CHAT_TOOLS.map((action) => ({
    id: action.id,
    name: `/${action.id}`,
    hint: `Attach ${action.label.toLowerCase()}`,
    arg: false,
  })),
] as const

function easeOut(t: number) {
  return 1 - (1 - t) ** 3
}

function ToolChar({ item, onRemove }: { item: DraftTool; onRemove: (key: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const leaving = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion()) {
      el.style.opacity = '1'
      el.style.transform = 'none'
      return
    }
    let raf = 0
    const start = performance.now()
    const dur = 340
    el.style.opacity = '0'
    el.style.transform = 'translateY(-22px) scale(.7)'
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / dur)
      const s = easeOut(u)
      el.style.opacity = String(s)
      el.style.transform = `translateY(${(1 - s) * -22}px) scale(${0.7 + 0.3 * s})`
      if (u < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      className="chat-char"
      aria-label={`Remove ${item.detail || item.label}`}
      title={item.detail || item.label}
      onClick={(event) => {
        event.stopPropagation()
        if (leaving.current) return
        leaving.current = true
        const el = ref.current
        if (!el || prefersReducedMotion()) {
          onRemove(item.key)
          return
        }
        const start = performance.now()
        const dur = 260
        const tick = (now: number) => {
          const u = Math.min(1, (now - start) / dur)
          const s = u * u
          el.style.opacity = String(1 - s)
          el.style.transform = `translateY(${16 * s}px) scale(${1 - 0.45 * s})`
          if (u < 1) requestAnimationFrame(tick)
          else onRemove(item.key)
        }
        requestAnimationFrame(tick)
      }}
    >
      <ToolGlyph name={item.icon} />
    </button>
  )
}

export function ChatEntry({ state }: { state: AppState }) {
  const { goal, setGoal, setStep, setIntent, setConstraint } = state
  const askRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const plusRef = useRef<HTMLDivElement>(null)
  const plusIconRef = useRef<SVGSVGElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const runtimeAbortRef = useRef<AbortController | null>(null)
  const runtimeCheckServerRef = useRef(false)
  const runtimeCheckMessageRef = useRef<string | null>(null)
  const runtimeUnsubRef = useRef<(() => void) | null>(null)
  const runtimeHydrationRef = useRef(0)
  const queueRef = useRef<QueuedTurn[]>([])
  const steerRef = useRef<QueuedTurn | null>(null)
  const messagesRef = useRef<ChatMsg[]>([])
  const busyRef = useRef(false)
  const liftRef = useRef(0)
  const plusAnimRef = useRef(0)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const slashAnimRef = useRef(0)
  const [plusOpen, setPlusOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [chars, setChars] = useState<DraftTool[]>([])
  const [queue, setQueue] = useState<QueuedTurn[]>([])
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [busy, setBusy] = useState(false)
  const [runtimeRunning, setRuntimeRunning] = useState(false)
  messagesRef.current = messages
  busyRef.current = busy
  const [slashOn, setSlashOn] = useState(true)
  const [slashPick, setSlashPick] = useState(0)
  const [board, setBoard] = useState(false)
  const [boardKey, setBoardKey] = useState(0)
  const [boardLeave, setBoardLeave] = useState(false)
  const [signup, setSignup] = useState(false)
  const [signin, setSignin] = useState(false)
  const [settings, setSettings] = useState(false)
  const [prefs, setPrefs] = useState(getPrefs)
  const [reportId, setReportId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('offensive')
  const pendingRef = useRef<{ text: string; tools: DraftTool[] } | null>(null)
  const skipSave = useRef(false)
  const BOARD_LEAVE_MS = 400
  const live = messages.length > 0
  const expanded = asking || plusOpen || live
  const slashToken = /^\/(\S*)$/.exec(goal)
  const slashHits = slashToken
    ? SLASH_CMDS.filter((cmd) => cmd.name.slice(1).startsWith(slashToken[1].toLowerCase()))
    : []
  const slashOpen = prefs.slashHints && slashOn && slashHits.length > 0

  const pinThread = () => {
    const el = threadRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }

  useLayoutEffect(() => {
    pinThread()
  }, [messages, busy, chars, queue])

  const openBoard = (initialGoal = '') => {
    setIntent('')
    setStep('intent')
    // Keep a goal that was held for sign-in attached to the plan review. The
    // chat still owns the eventual send; onboarding should not make the owner
    // retype the idea just to get an honest company preview.
    setGoal(initialGoal)
    setConstraint('audience', '')
    setConstraint('deadline', '')
    setConstraint('budget', '')
    setConstraint('assets', '')
    setBoardKey((value) => value + 1)
    setBoardLeave(false)
    setSignup(false)
    setSignin(false)
    setBoard(true)
  }

  const askAuth = () => {
    setSettings(false)
    setBoard(false)
    if (getWorkspace().account) {
      setSignup(false)
      setSignin(true)
      return
    }
    setSignin(false)
    setSignup(true)
  }

  const resetThread = () => {
    abortRef.current?.abort()
    abortRef.current = null
    runtimeAbortRef.current?.abort()
    runtimeAbortRef.current = null
    runtimeCheckServerRef.current = false
    runtimeCheckMessageRef.current = null
    runtimeHydrationRef.current += 1
    runtimeUnsubRef.current?.()
    runtimeUnsubRef.current = null
    skipSave.current = true
    setMessages([])
    setGoal('')
    setChars([])
    setQueue([])
    queueRef.current = []
    steerRef.current = null
    setSlashOn(true)
    busyRef.current = false
    setBusy(false)
    setRuntimeRunning(false)
    setPlusOpen(false)
    setAsking(false)
  }

  const loadCurrent = () => {
    const chat = currentChat()
    runtimeHydrationRef.current += 1
    runtimeUnsubRef.current?.()
    runtimeUnsubRef.current = null
    skipSave.current = true
    abortRef.current?.abort()
    abortRef.current = null
    runtimeAbortRef.current?.abort()
    runtimeAbortRef.current = null
    runtimeCheckServerRef.current = false
    runtimeCheckMessageRef.current = null
    setMessages(((chat?.messages ?? []) as ChatMsg[]).map(presentStoredMessage))
    setChars([])
    setQueue([])
    queueRef.current = []
    steerRef.current = null
    setSlashOn(true)
    busyRef.current = false
    setBusy(false)
    setRuntimeRunning(false)
    setPlusOpen(false)
    setAsking(Boolean(chat?.messages.length))
    setBoardLeave(false)
    setBoard(false)
    setSignup(false)
    setSignin(false)
    setSettings(false)
  }

  const hydrateCurrentRuntime = () => {
    const token = ++runtimeHydrationRef.current
    runtimeUnsubRef.current?.()
    runtimeUnsubRef.current = null
    const business = currentBusiness()
    const chat = currentChat()
    const liveMessage = chat?.messages.find((message) => (message as ChatMsg).liveWork)
    if (!business?.runtimeCompanyId || !liveMessage) {
      setRuntimeRunning(false)
      return
    }

    void hydrateCompanyRuntime(business).then((hydrated) => {
      if (!hydrated || token !== runtimeHydrationRef.current) return
      const replace = (content: string, previewUrl?: string) => {
        setMessages((current) => current.map((message) => message.id === liveMessage.id
          ? { ...message, content, previewUrl: previewUrl ?? message.previewUrl, liveWork: true }
          : message))
      }
      const preview = [...hydrated.events]
        .reverse()
        .map((event) => previewFromEvent(event, hydrated.companyId))
        .find((value): value is string => Boolean(value))
      if (preview) replace("I'll keep this company running on this PC until you Stop All.", preview)

      const latestCycle = [...hydrated.events].reverse().find((event) => (
        event.event_type === 'company.started' || event.event_type === 'company.cycle_started'
      ))
      const terminal = [...hydrated.events].reverse().find((event) => (
        event.event_type === 'company.run_completed' || event.event_type === 'company.run_blocked'
      ))
      if (terminal && (!latestCycle || terminal.sequence > latestCycle.sequence)) {
        if (terminal.event_type === 'company.run_blocked') {
          replace(typeof terminal.data.summary === 'string'
            ? terminal.data.summary
            : 'The company run is blocked until its server-side AI provider is configured.')
        } else {
          const status = typeof terminal.data.status === 'string' ? terminal.data.status : 'completed'
          const summary = typeof terminal.data.summary === 'string' ? terminal.data.summary : 'The company run reached a terminal state.'
          const continuing = terminal.data.alwaysOn === true && status !== 'stopped'
          if (!continuing) replace(status === 'completed' ? `${summary}\n\nOpen Agent Grid to inspect verified specialist work.` : summary, preview || undefined)
        }
      }

      if (!hydrated.active) {
        setRuntimeRunning(false)
        return
      }

      setRuntimeRunning(true)
      let unsubscribe: (() => void) | null = null
      unsubscribe = subscribeCompanyEvents(hydrated.companyId, hydrated.objective, hydrated.cursor, (event: DomainEvent) => {
        if (token !== runtimeHydrationRef.current) {
          unsubscribe?.()
          return
        }
        const nextPreview = previewFromEvent(event, hydrated.companyId)
        if (nextPreview) replace("I'll keep this company running on this PC until you Stop All.", nextPreview)
        if (event.event_type === 'company.run_blocked') {
          replace(typeof event.data.summary === 'string'
            ? event.data.summary
            : 'The company run is blocked until its server-side AI provider is configured.')
        }
        if (event.event_type === 'company.run_completed') {
          const status = typeof event.data.status === 'string' ? event.data.status : 'completed'
          const summary = typeof event.data.summary === 'string' ? event.data.summary : 'The company run reached a terminal state.'
          const continuing = event.data.alwaysOn === true && status !== 'stopped'
          if (!continuing) {
            replace(status === 'completed' ? `${summary}\n\nOpen Agent Grid to inspect verified specialist work.` : summary, nextPreview || undefined)
            unsubscribe?.()
            if (runtimeUnsubRef.current === unsubscribe) runtimeUnsubRef.current = null
            setRuntimeRunning(false)
          }
        }
      })
      runtimeUnsubRef.current = unsubscribe
    }).catch(() => {
      if (token !== runtimeHydrationRef.current) return
      setRuntimeRunning(false)
      setMessages((current) => current.map((message) => message.id === liveMessage.id
        ? { ...message, content: 'Saved company activity is available, but the live connection could not be restored yet.', liveWork: true }
        : message))
    })
  }

  useEffect(() => {
    const onNew = (event: Event) => {
      const kind = event instanceof CustomEvent ? (event.detail as { kind?: string } | undefined)?.kind : undefined
      const room = getWorkspace()
      if (kind === 'signup' || kind === 'signin' || kind === 'settings') {
        setSignup(false)
        setSignin(false)
        setBoard(false)
        setSettings(true)
        return
      }
      if (kind === 'company') {
        if (!isSignedIn()) {
          askAuth()
          return
        }
        openBoard()
        return
      }
      if (!isSignedIn()) {
        askAuth()
        return
      }
      if (!room.currentBusinessId) {
        openBoard()
        return
      }
      newChat()
      resetThread()
      setBoardLeave(false)
      setBoard(false)
      setSignup(false)
    }
    window.addEventListener('orcha:new', onNew)
    return () => window.removeEventListener('orcha:new', onNew)
  }, [setConstraint, setIntent, setStep])

  useEffect(() => {
    loadCurrent()
    hydrateCurrentRuntime()
    const onOpen = () => {
      loadCurrent()
      hydrateCurrentRuntime()
    }
    const onOut = () => {
      resetThread()
      setBoardLeave(false)
      setBoard(false)
      setSignup(false)
      setSignin(false)
    }
    window.addEventListener('orcha:open-thread', onOpen)
    window.addEventListener('orcha:signed-out', onOut)
    const stop = subscribeWorkspace(() => setPrefs(getPrefs()))
    return () => {
      window.removeEventListener('orcha:open-thread', onOpen)
      window.removeEventListener('orcha:signed-out', onOut)
      stop()
      runtimeAbortRef.current?.abort()
      runtimeAbortRef.current = null
      runtimeCheckServerRef.current = false
      runtimeCheckMessageRef.current = null
      runtimeHydrationRef.current += 1
      runtimeUnsubRef.current?.()
      runtimeUnsubRef.current = null
    }
  }, [])

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    if (!getWorkspace().currentChatId) return
    const first = messages.find((msg) => msg.role === 'user')
    writeMessages(messages, first ? titleFrom(first.content) : undefined)
  }, [messages])

  const closeBoard = () => {
    if (!board || boardLeave) return
    if (prefersReducedMotion()) {
      setBoard(false)
      return
    }
    setBoardLeave(true)
  }

  useEffect(() => {
    if (!boardLeave) return
    const id = window.setTimeout(() => {
      setBoard(false)
      setBoardLeave(false)
    }, BOARD_LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [boardLeave])

  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const from = liftRef.current
    const to = expanded ? 1 : 0
    const start = performance.now()
    const dur = 560
    let raf = 0
    const place = (t: number) => {
      liftRef.current = t
      const full = form.parentElement?.clientWidth ?? 420
      const rest = Math.min(420, full)
      if (live) {
        form.style.top = 'auto'
        form.style.bottom = '28px'
        form.style.width = `${Math.min(768, full)}px`
        return
      }
      form.style.bottom = 'auto'
      form.style.top = `${75 - 25 * t}%`
      form.style.width = `${Math.round(rest + (full - rest) * t)}px`
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
  }, [expanded, live])

  useEffect(() => {
    const icon = plusIconRef.current
    const menu = plusMenuRef.current
    const from = plusAnimRef.current
    const to = plusOpen ? 1 : 0
    const start = performance.now()
    const dur = 360
    let raf = 0
    const place = (t: number) => {
      plusAnimRef.current = t
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
  }, [plusOpen])

  useEffect(() => {
    const menu = slashMenuRef.current
    const from = slashAnimRef.current
    const to = slashOpen ? 1 : 0
    const start = performance.now()
    const dur = 280
    let raf = 0
    const place = (t: number) => {
      slashAnimRef.current = t
      if (!menu) return
      menu.style.opacity = String(t)
      menu.style.transform = `translateY(${(1 - t) * 14}px)`
      menu.style.visibility = t === 0 ? 'hidden' : 'visible'
      menu.style.pointerEvents = t > 0.5 ? 'auto' : 'none'
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
      place(from + (to - from) * easeOut(u))
      if (u < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [slashOpen])

  useEffect(() => {
    setSlashPick(0)
  }, [goal])

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (plusRef.current?.contains(target) || formRef.current?.contains(target)) return
      setPlusOpen(false)
      if (!live) setAsking(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlusOpen(false)
        setSlashOn(false)
        if (!live) {
          setAsking(false)
          askRef.current?.blur()
        }
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [live])

  const send = async (preset?: { text: string; tools: DraftTool[]; kind?: 'steer' }) => {
    const text = (preset?.text ?? goal.trim())
    const attached = preset?.tools ?? chars
    if (!text && attached.length === 0) return
    if (busyRef.current && !preset) return
    const room = getWorkspace()
    if (!isSignedIn()) {
      pendingRef.current = { text, tools: attached }
      askAuth()
      return
    }
    if (!preset?.kind) {
      if (!room.currentBusinessId) {
        pendingRef.current = { text, tools: attached }
        openBoard(text)
        return
      }
      if (!room.currentChatId) newChat(false)
    }
    const packed = packContent(attached, text)
    if (blockedPrompt(packed)) {
      const orchaId = `o-${Date.now()}`
      const next = [
        ...messagesRef.current,
        { id: `u-${Date.now()}`, role: 'user' as const, content: text, tools: attached, kind: preset?.kind },
        { id: orchaId, role: 'orcha' as const, content: blockedReply() },
      ]
      messagesRef.current = next
      if (!preset) {
        setGoal('')
        setChars([])
      }
      setAsking(true)
      setMessages(next)
      return
    }
    if (!preset?.kind && isCompanyBuildRequest(text)) {
      const orchaId = `o-${Date.now()}`
      const next = [
        ...messagesRef.current,
        { id: `u-${Date.now()}`, role: 'user' as const, content: text, tools: attached },
        { id: orchaId, role: 'orcha' as const, content: "I'll keep this company running on this PC until you Stop All.", liveWork: true },
      ]
      messagesRef.current = next
      setGoal('')
      setChars([])
      setPlusOpen(false)
      setSlashOn(false)
      setAsking(true)
      stickRef.current = true
      setMessages(next)
      busyRef.current = true
      setBusy(true)
      setRuntimeRunning(true)
      runtimeHydrationRef.current += 1
      runtimeUnsubRef.current?.()
      runtimeUnsubRef.current = null
      beginCompanyRun(text)
      const replace = (content: string, previewUrl?: string, liveWork = true) => setMessages((current) => current.map((message) => message.id === orchaId ? { ...message, content, previewUrl: previewUrl ?? message.previewUrl, liveWork } : message))
      let unsubscribe: (() => void) | null = null
      try {
        const companyId = await ensureRuntimeCompany()
        unsubscribe = subscribeCompanyEvents(companyId, text, 0, (event) => {
          const preview = previewFromEvent(event, companyId)
          if (preview) replace("I'll keep this company running on this PC until you Stop All.", preview)
          if (event.event_type === 'company.run_blocked') {
            replace(typeof event.data.summary === 'string' ? event.data.summary : 'The company run is blocked until its server-side AI provider is configured.')
          }
          if (event.event_type === 'company.run_completed') {
            const status = typeof event.data.status === 'string' ? event.data.status : 'completed'
            const summary = typeof event.data.summary === 'string' ? event.data.summary : 'The company run reached a terminal state.'
            const continuing = event.data.alwaysOn === true && status !== 'stopped'
            if (continuing) {
              if (preview) replace("I'll keep this company running on this PC until you Stop All.", preview)
              return
            }
            replace(status === 'completed' ? `${summary}\n\nOpen Agent Grid to inspect verified specialist work.` : summary, preview || undefined)
            unsubscribe?.()
            runtimeUnsubRef.current = null
            busyRef.current = false
            setBusy(false)
            setRuntimeRunning(false)
          }
        })
        runtimeUnsubRef.current = unsubscribe
        const started = await startCompanyRun(text)
        seedPlannedTasks(text, started.tasks)
        replace("I'll keep this company running on this PC until you Stop All.")
      } catch (error) {
        if (hasLiveCompanyVisual()) {
          replace(error instanceof Error ? error.message : 'The company run is still connecting. Live work stays on this PC.')
          return
        }
        unsubscribe?.()
        runtimeUnsubRef.current = null
        abortCompanyRunVisual()
        replace(error instanceof Error ? error.message : 'The company run could not start.', undefined, false)
        busyRef.current = false
        setBusy(false)
        setRuntimeRunning(false)
      }
      return
    }
    if (!prefs.cloudAi) {
      const orchaId = `o-${Date.now()}`
      const next = [
        ...messagesRef.current,
        { id: `u-${Date.now()}`, role: 'user' as const, content: text, tools: attached, kind: preset?.kind },
        { id: orchaId, role: 'orcha' as const, content: 'Cloud AI is off. Nothing was sent to a model provider. Turn on Cloud AI in Settings → Legal & Privacy to generate a reply.' },
      ]
      messagesRef.current = next
      if (!preset) {
        setGoal('')
        setChars([])
      }
      setAsking(true)
      setMessages(next)
      return
    }
    const content = preset?.kind === 'steer'
      ? `Steer the last reply: ${text}`
      : packContent(attached, text)
    const orchaId = `o-${Date.now()}`
    const next = [
      ...messagesRef.current,
      { id: `u-${Date.now()}`, role: 'user' as const, content: text, tools: attached, kind: preset?.kind },
      { id: orchaId, role: 'orcha' as const, content: '' },
    ]
    messagesRef.current = next
    if (!preset) {
      setGoal('')
      setChars([])
    }
    setPlusOpen(false)
    setSlashOn(false)
    setAsking(true)
    stickRef.current = true
    setMessages(next)
    busyRef.current = true
    setBusy(true)
    const ac = new AbortController()
    abortRef.current = ac
    const append = (delta: string) => {
      setMessages((current) => current.map((msg) => (
        msg.id === orchaId ? { ...msg, content: msg.content + delta } : msg
      )))
    }
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: getWorkspace().account?.email || 'user-under-limit',
          instructions: instructionBlock(),
          messages: next.filter((msg) => msg.id !== orchaId).map((msg) => ({
            role: msg.role,
            content: msg.kind === 'steer' ? `Steer the last reply: ${msg.content}` : packContent(msg.tools ?? [], msg.content),
          })),
        }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) throw new Error('chat failed')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let got = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            try {
              const payload = JSON.parse(line.slice(5).trim()) as { delta?: string }
              if (payload.delta) {
                got = true
                append(payload.delta)
              }
            } catch {
              // ignore keepalives
            }
          }
        }
      }
      if (!got) append(offlineReply())
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        append(offlineReply())
      } else {
        setMessages((current) => {
          const last = current[current.length - 1]
          if (last?.id === orchaId && !last.content) return current.slice(0, -1)
          return current
        })
      }
    }
    if (abortRef.current === ac) abortRef.current = null
    const pendingSteer = steerRef.current
    if (pendingSteer) {
      steerRef.current = null
      busyRef.current = false
      setBusy(false)
      void send({ text: pendingSteer.text, tools: pendingSteer.tools, kind: 'steer' })
      return
    }
    const queued = queueRef.current[0]
    if (queued) {
      queueRef.current = queueRef.current.slice(1)
      setQueue(queueRef.current)
      busyRef.current = false
      setBusy(false)
      void send({ text: queued.text, tools: queued.tools })
      return
    }
    busyRef.current = false
    setBusy(false)
    askRef.current?.focus()
  }

  const stopGen = () => {
    const stoppingRuntime = runtimeRunning
    const stoppingWorkspaceCheck = runtimeAbortRef.current !== null
    const shouldStopServerRuntime = !stoppingWorkspaceCheck || runtimeCheckServerRef.current
    const workspaceCheckMessageId = runtimeCheckMessageRef.current
    steerRef.current = null
    abortRef.current?.abort()
    runtimeAbortRef.current?.abort()
    runtimeAbortRef.current = null
    runtimeCheckServerRef.current = false
    runtimeCheckMessageRef.current = null
    runtimeHydrationRef.current += 1
    runtimeUnsubRef.current?.()
    runtimeUnsubRef.current = null
    if (stoppingRuntime) {
      if (shouldStopServerRuntime) void stopRuntime().catch(() => undefined)
      busyRef.current = false
      setBusy(false)
      setRuntimeRunning(false)
      setMessages((current) => {
        const live = [...current].reverse().find((message) => message.liveWork)
        const targetId = workspaceCheckMessageId || live?.id
        if (!targetId) return current
        return current.map((message) => message.id === targetId
          ? { ...message, content: workspaceCheckMessageId ? 'Local Workspace check stopped by the owner.' : 'Company run stopped by the owner.', ...(workspaceCheckMessageId ? {} : { liveWork: true }) }
          : message)
      })
    }
  }

  const enqueue = (text: string, tools: DraftTool[]) => {
    if (!text && tools.length === 0) return
    const item = { id: `q-${Date.now()}`, text, tools }
    queueRef.current = [...queueRef.current, item]
    setQueue(queueRef.current)
    setGoal('')
    setChars([])
    setSlashOn(false)
  }

  const runWorkspaceCheck = async () => {
    if (!isSignedIn()) {
      askAuth()
      return
    }
    if (!currentBusiness()) {
      openBoard()
      return
    }
    if (runtimeRunning) return
    const runId = `runtime-${Date.now()}`
    const next: ChatMsg[] = [
      ...messagesRef.current,
      { id: `u-${Date.now()}`, role: 'user', content: '/workspace-check' },
      { id: runId, role: 'orcha', content: 'Checking the Local Workspace…' },
    ]
    messagesRef.current = next
    setMessages(next)
    setGoal('')
    setChars([])
    setSlashOn(false)
    setRuntimeRunning(true)
    busyRef.current = true
    setBusy(true)
    const controller = new AbortController()
    runtimeAbortRef.current = controller
    runtimeCheckServerRef.current = false
    runtimeCheckMessageRef.current = runId
    const replace = (content: string) => {
      setMessages((current) => current.map((message) => message.id === runId ? { ...message, content } : message))
    }
    try {
      const job = await startWorkspaceCheck(controller.signal)
      if (controller.signal.aborted) {
        await stopRuntime().catch(() => undefined)
        replace('Local Workspace check stopped by the owner.')
        return
      }
      runtimeCheckServerRef.current = true
      let since = 0
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 350))
        if (controller.signal.aborted) {
          replace('Local Workspace check stopped by the owner.')
          return
        }
        const events = await pollRuntimeEvents(job.companyId, since, controller.signal)
        if (!events.length) continue
        since = events[events.length - 1].sequence
        ingestRuntimeEvents(events, currentBusiness()?.brief || 'Verify the Local Workspace')
        const completed = events.find((event) => event.event_type === 'task.completed' && event.data.taskId === job.taskId)
        const failed = events.find((event) => event.event_type === 'task.failed' && event.data.taskId === job.taskId)
        const cancelled = events.find((event) => event.event_type === 'task.cancelled' && event.data.taskId === job.taskId)
        if (completed) {
          replace('Local Workspace created `test.txt` containing `hello from orcha`. Open Agent Grid to inspect the verified event.')
          return
        }
        if (failed) {
          replace(typeof failed.data.summary === 'string' ? failed.data.summary : 'The Local Workspace could not finish this check.')
          return
        }
        if (cancelled) {
          replace(typeof cancelled.data.summary === 'string' ? cancelled.data.summary : 'Local Workspace check stopped by the owner.')
          return
        }
      }
      replace('The Local Workspace is still working. Open Agent Grid for the recorded activity.')
    } catch (error) {
      replace(controller.signal.aborted
        ? 'Local Workspace check stopped by the owner.'
        : error instanceof Error ? error.message : 'Local Workspace is offline. Start orcha-worker and try again.')
    } finally {
      if (runtimeAbortRef.current === controller) runtimeAbortRef.current = null
      runtimeCheckServerRef.current = false
      if (runtimeCheckMessageRef.current === runId) runtimeCheckMessageRef.current = null
      // Workspace checks use the same composer Stop affordance as chat
      // generation; always return it to an idle, sendable state.
      busyRef.current = false
      setBusy(false)
      setRuntimeRunning(false)
    }
  }

  const runSlash = (id: string, arg = '') => {
    if (id === 'stop') {
      stopGen()
      if (runtimeRunning) setRuntimeRunning(false)
      setGoal('')
      return
    }
    if (id === 'diagnostics') {
      const replyId = `runtime-diag-${Date.now()}`
      const next: ChatMsg[] = [
        ...messagesRef.current,
        { id: `u-${Date.now()}`, role: 'user', content: '/diagnostics' },
        { id: replyId, role: 'orcha', content: 'Reading operator diagnostics…' },
      ]
      messagesRef.current = next
      setMessages(next)
      setGoal('')
      setSlashOn(false)
      const replace = (content: string) => setMessages((current) => current.map((message) => message.id === replyId ? { ...message, content } : message))
      void fetchInternalDiagnostics()
        .then((body) => {
          const providers = (body.providers || []).map((item) => {
            const status = item.status === 'configured' ? 'Ready' : item.status === 'rate_limited' ? 'Rate limited' : item.status === 'failed' ? 'Failed' : 'Unconfigured'
            return `${item.provider}: ${status}`
          }).join('\n')
          const worker = body.worker?.status === 'ready' ? 'Ready' : body.worker?.status === 'offline' ? 'Offline' : body.worker?.status || 'Unknown'
          const scheduler = body.scheduler
            ? `Scheduler: ${body.scheduler.status || 'Unknown'} · ${body.scheduler.activeTasks ?? 0} active task${body.scheduler.activeTasks === 1 ? '' : 's'} · ${body.scheduler.activeCompanies ?? 0} always-on compan${body.scheduler.activeCompanies === 1 ? 'y' : 'ies'}`
            : 'Scheduler: unavailable on this host'
          replace(`Local Workspace: ${worker}${body.worker?.detail ? ` · ${body.worker.detail}` : ''}\n${scheduler}\n${providers || 'No providers reported'}\nEvents: ${body.eventStream || 'sse'} · ${body.eventStore || 'sqlite'}`)
        })
        .catch((error: unknown) => replace(error instanceof Error ? error.message : 'Diagnostics are unavailable.'))
      return
    }
    if (id === 'workspace-check') {
      void runWorkspaceCheck()
      return
    }
    if (id === 'runtime-status' || id === 'pause-company' || id === 'resume-company') {
      const label = `/${id}`
      const replyId = `runtime-control-${Date.now()}`
      const next: ChatMsg[] = [
        ...messagesRef.current,
        { id: `u-${Date.now()}`, role: 'user', content: label },
        { id: replyId, role: 'orcha', content: 'Checking the company runtime…' },
      ]
      messagesRef.current = next
      setMessages(next)
      setGoal('')
      setSlashOn(false)
      const replace = (content: string) => setMessages((current) => current.map((message) => message.id === replyId ? { ...message, content } : message))
      const action = id === 'pause-company'
        ? pauseCompanyRuntime().then(() => 'Company work is paused. Nothing new will be dispatched until you resume it.')
        : id === 'resume-company'
          ? resumeCompanyRuntime().then(({ resumed }) => `Company work resumed. ${resumed} blocked task${resumed === 1 ? '' : 's'} requeued.`)
          : companyRuntimeStatus().then(({ status, counts }) => {
              const details = Object.entries(counts).map(([state, count]) => `${count} ${state}`).join(', ') || 'no recorded tasks'
              return `Company runtime is ${status}. Current tasks: ${details}.`
            })
      void action.then(replace).catch((error: unknown) => replace(error instanceof Error ? error.message : 'Could not read the company runtime.'))
      return
    }
    if (id === 'new') {
      window.dispatchEvent(new Event('orcha:new'))
      setGoal('')
      return
    }
    if (id === 'steer') {
      if (!arg) {
        setGoal('/steer ')
        setSlashOn(false)
        return
      }
      setGoal('')
      setChars([])
      if (busyRef.current) {
        steerRef.current = { id: `s-${Date.now()}`, text: arg, tools: [] }
        abortRef.current?.abort()
        return
      }
      void send({ text: arg, tools: [], kind: 'steer' })
      return
    }
    if (id === 'queue') {
      if (!arg) {
        setGoal('/queue ')
        setSlashOn(false)
        return
      }
      enqueue(arg, [])
      return
    }
    const action = CHAT_TOOLS.find((item) => item.id === id)
    if (!action) return
    if (action.id === 'files') {
      fileRef.current?.click()
      setGoal('')
      setSlashOn(false)
      return
    }
    addTool(action)
    setGoal('')
    setSlashOn(false)
  }

  const applySlash = (cmd: (typeof SLASH_CMDS)[number]) => {
    if (cmd.arg) {
      setGoal(`${cmd.name} `)
      setSlashOn(false)
      askRef.current?.focus()
      return
    }
    runSlash(cmd.id)
  }

  const submitComposer = () => {
    if (slashOpen) {
      const cmd = slashHits[Math.min(slashPick, slashHits.length - 1)]
      if (cmd) applySlash(cmd)
      return
    }
    const parsed = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(goal.trim())
    if (parsed) {
      const id = parsed[1].toLowerCase()
      const known = SLASH_CMDS.some((cmd) => cmd.id === id)
      if (known) {
        runSlash(id, (parsed[2] || '').trim())
        return
      }
    }
    if (busyRef.current) {
      enqueue(goal.trim(), chars)
      return
    }
    void send()
  }

  const addTool = (action: (typeof CHAT_TOOLS)[number], detail?: string) => {
    const key = `${action.id}:${detail || action.label}`
    setAsking(true)
    setPlusOpen(false)
    stickRef.current = true
    setChars((current) => (
      current.some((item) => item.key === key)
        ? current
        : [...current, { key, label: action.label, icon: action.icon, detail }]
    ))
    askRef.current?.focus()
  }

  useEffect(() => {
    const onTool = (event: Event) => {
      const id = event instanceof CustomEvent ? (event.detail as { id?: string } | undefined)?.id : undefined
      const action = CHAT_TOOLS.find((item) => item.id === id)
      if (!action) return
      if (!isSignedIn()) {
        window.dispatchEvent(new CustomEvent('orcha:new', { detail: { kind: 'settings' } }))
        return
      }
      if (action.id === 'files') {
        setAsking(true)
        fileRef.current?.click()
        return
      }
      addTool(action)
    }
    window.addEventListener('orcha:tool', onTool)
    return () => window.removeEventListener('orcha:tool', onTool)
  }, [])

  const finishSignup = (name: string, email: string) => {
    signUp(name, email)
    setSignup(false)
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    if (!getWorkspace().currentBusinessId) {
      openBoard(pending.text)
      return
    }
    setGoal('')
    void send(pending)
  }

  const finishSignin = (email: string) => {
    if (!signIn(email)) return false
    setSignin(false)
    const pending = pendingRef.current
    if (!pending) return true
    pendingRef.current = null
    if (!getWorkspace().currentBusinessId) {
      openBoard(pending.text)
      return true
    }
    setGoal('')
    void send(pending)
    return true
  }

  const boardClass = boardLeave ? 'chat-entry is-onboard is-leaving' : 'chat-entry is-onboard'

  if (settings) {
    return (
      <div className="chat-stage">
        <Settings onBack={() => setSettings(false)} />
      </div>
    )
  }

  return (
    <div className="chat-stage">
      <section
        className={`chat-entry${expanded ? ' is-asking' : ''}${live ? ' is-live' : ''}`}
        aria-hidden={board || undefined}
      >
      {!live && (
        <h1 className="chat-title" aria-label="What could we create, build, or automate?">
          <span className="visually-hidden">WHAT COULD WE CREATE, BUILD, OR AUTOMATE?</span>
          <span aria-hidden="true"><FlipWord /></span>
        </h1>
      )}
      {live && (
        <div
          ref={threadRef}
          className="chat-thread"
          aria-live="polite"
          onScroll={() => {
            const el = threadRef.current
            if (!el) return
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 56
          }}
        >
          {messages.map((msg, index) => (
            (() => {
              const renderedContent = msg.role === 'orcha' ? presentReply(msg.content) : msg.content
              const isOperationalState = renderedContent !== msg.content
              return <article key={msg.id} className={`chat-msg is-${msg.role}${prefs.showTools && msg.tools?.length ? ' is-tool' : ''}`}>
              <span className="chat-msg-who">
                {msg.role === 'orcha' ? 'Orcha · AI' : msg.kind === 'steer' ? 'You · steer' : 'You'}
                {msg.role === 'orcha' && msg.content && !isOperationalState && (
                  <button
                    type="button"
                    className="chat-flag"
                    onClick={() => {
                      setReportId(msg.id)
                      setReportReason('offensive')
                    }}
                  >
                    Report
                  </button>
                )}
              </span>
              {prefs.showTools && msg.tools?.map((tool) => (
                <div key={tool.key} className="chat-tool">
                  <span className="chat-tool-ico"><ToolGlyph name={tool.icon} /></span>
                  <span>
                    <b>{tool.label}</b>
                    {tool.detail ? <small>{tool.detail}</small> : null}
                  </span>
                </div>
              ))}
              {(msg.liveWork) ? (
                <CompanyLiveProgress
                  intro={msg.content}
                  previewUrl={msg.previewUrl}
                  running={runtimeRunning}
                />
              ) : (renderedContent || (busy && msg.role === 'orcha' && index === messages.length - 1)) && (
                <p>
                  {renderedContent}
                  {busy && msg.role === 'orcha' && index === messages.length - 1 && (
                    <span className="chat-caret" aria-hidden="true" />
                  )}
                </p>
              )}
              {!msg.liveWork && msg.previewUrl && (
                <div className="chat-preview-wrap">
                  <iframe
                    className="chat-preview"
                    title="Company preview"
                    src={msg.previewUrl}
                    sandbox="allow-scripts allow-same-origin"
                  />
                  <a className="chat-preview-link" href={msg.previewUrl} target="_blank" rel="noreferrer">Open preview</a>
                </div>
              )}
              </article>
            })()
          ))}
          {reportId && (
            <div className="chat-report" role="dialog" aria-label="Report AI content">
              <p>Report this AI reply. This stays in the app.</p>
              <select
                className="st-select"
                aria-label="Report reason"
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
              >
                <option value="offensive">Offensive</option>
                <option value="harmful">Harmful or unsafe</option>
                <option value="child">Child safety</option>
                <option value="other">Other</option>
              </select>
              <button
                type="button"
                className="st-chip is-go"
                onClick={() => {
                  const msg = messages.find((item) => item.id === reportId)
                  addReport(reportReason, msg?.content || '')
                  setReportId(null)
                }}
              >
                Submit report
              </button>
              <button type="button" className="st-chip" onClick={() => setReportId(null)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      <form
        ref={formRef}
        className={`gpt-composer${expanded ? ' is-asking' : ''}${chars.length ? ' has-chars' : ''}${busy ? ' is-busy' : ''}${queue.length ? ' has-queue' : ''}`}
        onClick={() => {
          setAsking(true)
          askRef.current?.focus()
        }}
        onFocus={() => setAsking(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setAsking(false)
            setPlusOpen(false)
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          submitComposer()
        }}
      >
        <div
          ref={slashMenuRef}
          className="slash-menu"
          role="listbox"
          aria-label="Slash commands"
          aria-hidden={!slashOpen}
        >
          {slashHits.map((cmd, index) => (
            <button
              key={cmd.id}
              type="button"
              role="option"
              aria-selected={index === slashPick}
              className={`slash-item${index === slashPick ? ' is-on' : ''}`}
              tabIndex={slashOpen ? 0 : -1}
              onMouseEnter={() => setSlashPick(index)}
              onClick={(event) => {
                event.stopPropagation()
                applySlash(cmd)
              }}
            >
              <b>{cmd.name}</b>
              <span>{cmd.hint}</span>
            </button>
          ))}
        </div>
        {queue.length > 0 && (
          <div className="chat-queue" aria-label="Queued">
            {queue.map((item) => (
              <span key={item.id} className="chat-queue-item">
                <em>Queued</em>
                {item.text || item.tools.map((tool) => tool.label).join(', ')}
                <button
                  type="button"
                  className="chat-char-x"
                  aria-label="Remove from queue"
                  onClick={(event) => {
                    event.stopPropagation()
                    queueRef.current = queueRef.current.filter((turn) => turn.id !== item.id)
                    setQueue(queueRef.current)
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={askRef}
          aria-label="Ask Orcha"
          value={goal}
          onChange={(event) => {
            const value = event.target.value
            setGoal(value)
            if (value.startsWith('/')) setSlashOn(true)
          }}
          placeholder={
            !isSignedIn()
              ? 'Sign in to chat'
              : busy ? 'Steer, queue, or /stop' : prefs.submitOnEnter ? 'Ask anything, or type /' : 'Ask anything · Ctrl+Enter to send'
          }
          rows={1}
          onKeyDown={(event) => {
            if (slashOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab')) {
              event.preventDefault()
              if (event.key === 'Tab') {
                const cmd = slashHits[Math.min(slashPick, slashHits.length - 1)]
                if (cmd) applySlash(cmd)
                return
              }
              setSlashPick((current) => {
                const last = slashHits.length - 1
                if (event.key === 'ArrowDown') return current >= last ? 0 : current + 1
                return current <= 0 ? last : current - 1
              })
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              const sendKey = prefs.submitOnEnter || event.metaKey || event.ctrlKey
              if (!sendKey) return
              event.preventDefault()
              submitComposer()
            }
          }}
        />
        {chars.length > 0 && (
          <div className="chat-chars" aria-label="Attached in the chatbox">
            {chars.map((item) => (
              <ToolChar
                key={item.key}
                item={item}
                onRemove={(key) => setChars((current) => current.filter((char) => char.key !== key))}
              />
            ))}
          </div>
        )}
        {busy && (
          <div className="chat-run">
            <button
              type="button"
              className="chat-run-btn"
              disabled={!goal.trim()}
              onClick={(event) => {
                event.stopPropagation()
                runSlash('steer', goal.trim())
              }}
            >
              Steer
            </button>
            <button
              type="button"
              className="chat-run-btn"
              disabled={!goal.trim() && chars.length === 0}
              onClick={(event) => {
                event.stopPropagation()
                enqueue(goal.trim(), chars)
              }}
            >
              Queue
            </button>
          </div>
        )}
        <div className="gpt-plus-wrap" ref={plusRef}>
          <button
            type="button"
            className={`gpt-plus${plusOpen ? ' is-open' : ''}`}
            aria-label="Add"
            aria-haspopup="menu"
            aria-expanded={plusOpen}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setAsking(true)
              setPlusOpen((open) => !open)
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              askRef.current?.focus()
            }}
          >
            <svg ref={plusIconRef} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" /></svg>
          </button>
          <div
            ref={plusMenuRef}
            className="gpt-plus-menu"
            role="menu"
            aria-label="Add to Orcha"
            aria-hidden={!plusOpen}
          >
            {CHAT_TOOLS.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="gpt-plus-item"
                tabIndex={plusOpen ? 0 : -1}
                onClick={(event) => {
                  event.stopPropagation()
                  if (action.id === 'files') {
                    fileRef.current?.click()
                    setPlusOpen(false)
                    return
                  }
                  addTool(action)
                }}
              >
                <span className="gpt-plus-ico"><ToolGlyph name={action.icon} /></span>
                {action.label}
              </button>
            ))}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const names = Array.from(event.target.files ?? []).map((file) => file.name)
            const files = CHAT_TOOLS.find((action) => action.id === 'files')
            if (names.length && files) addTool(files, names.join(', '))
            event.target.value = ''
          }}
        />
        {busy ? (
          <button type="button" className="gpt-send is-stop" aria-label="Stop generation" onClick={stopGen}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 7h10v10H7z" /></svg>
          </button>
        ) : (
          <button type="submit" className="gpt-send" aria-label="Send" disabled={!goal.trim() && chars.length === 0}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11 5.2V19h2V5.2l5.3 5.3 1.4-1.4L12 1.4 4.3 9.1l1.4 1.4z" /></svg>
          </button>
        )}
      </form>
      </section>
      {signup ? (
        <section className="chat-entry is-onboard">
          <SignUp onCancel={() => setSignup(false)} onDone={finishSignup} />
        </section>
      ) : signin ? (
        <section className="chat-entry is-onboard">
          <SignIn onCancel={() => setSignin(false)} onDone={finishSignin} />
        </section>
      ) : board ? (
        <section className={boardClass}>
          <CompanyOnboard
            key={boardKey}
            state={state}
            onCancel={closeBoard}
            onStart={(brief, name) => {
              startBusiness(name, brief)
              setBoardLeave(false)
              setBoard(false)
              const pending = pendingRef.current
              pendingRef.current = null
              setGoal('')
              void send({ text: pending?.text || brief, tools: pending?.tools ?? [] })
            }}
          />
        </section>
      ) : null}
    </div>
  )
}
