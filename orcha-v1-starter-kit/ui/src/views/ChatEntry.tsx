import { useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { FIELD_H, FIELD_W, getBlueFieldHref } from '../blueField'
import { offlineReply, replyTo } from '../chatReply'
import { blockedPrompt, blockedReply } from '../legal'
import type { AppState } from '../types'
import {
  addReport,
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
}

type QueuedTurn = { id: string; text: string; tools: DraftTool[] }

function packContent(tools: DraftTool[], text: string) {
  const head = tools.map((tool) => (tool.detail ? `${tool.label}: ${tool.detail}` : tool.label)).join(', ')
  return [head, text].filter(Boolean).join('\n\n')
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
  patternRef,
  sizerRef,
  textRef,
}: {
  text: string
  href: string
  patternRef: Ref<SVGPatternElement>
  sizerRef?: Ref<HTMLSpanElement>
  textRef?: Ref<SVGTextElement>
}) {
  const uid = useId().replace(/:/g, '')
  return (
    <span className="hollow-wrap">
      <span className="hollow-sizer" ref={sizerRef}>{text}</span>
      <svg className="hollow-glyph" overflow="visible" aria-hidden="true">
        <defs>
          <pattern
            ref={patternRef}
            id={`field-${uid}`}
            patternUnits="userSpaceOnUse"
            width={FIELD_W}
            height={FIELD_H}
            x="0"
            y="0"
          >
            <image href={href} width={FIELD_W} height={FIELD_H} />
          </pattern>
        </defs>
        <text ref={textRef} x="0" y="50%" dominantBaseline="central" fill={`url(#field-${uid})`}>{text}</text>
      </svg>
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
  const shownRef = useRef({ front: 'CREATE', bottom: 'BUILD' })
  const [fieldHref, setFieldHref] = useState('')
  const leadPatRef = useRef<SVGPatternElement>(null)
  const frontPatRef = useRef<SVGPatternElement>(null)
  const bottomPatRef = useRef<SVGPatternElement>(null)
  const qPatRef = useRef<SVGPatternElement>(null)
  const frontSizerRef = useRef<HTMLSpanElement>(null)
  const frontTextRef = useRef<SVGTextElement>(null)
  const bottomSizerRef = useRef<HTMLSpanElement>(null)
  const bottomTextRef = useRef<SVGTextElement>(null)
  const cropRef = useRef({ x: 360, y: 280 })

  const writeFace = (
    word: string,
    sizer: HTMLSpanElement | null,
    glyph: SVGTextElement | null,
  ) => {
    if (sizer && sizer.textContent !== word) sizer.textContent = word
    if (glyph && glyph.textContent !== word) glyph.textContent = word
  }

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
    if (!fieldHref) {
      setFieldHref(getBlueFieldHref())
      return
    }

    let raf = 0
    let phase: 'glow' | 'flip' = 'glow'
    let mark = performance.now()
    let turn = 0
    let last = performance.now()
    let spotX = cropRef.current.x
    let spotY = cropRef.current.y
    let destX = spotX
    let destY = spotY
    let targetX = spotX
    let targetY = spotY
    let nextTarget = 0
    let lastPaint = 0

    const pickTarget = (fromCurX: number, fromCurY: number) => {
      let nextX = fromCurX
      let nextY = fromCurY
      for (let i = 0; i < 8; i += 1) {
        nextX = 40 + Math.random() * (FIELD_W * 0.68)
        nextY = 40 + Math.random() * (FIELD_H * 0.68)
        if ((nextX - fromCurX) ** 2 + (nextY - fromCurY) ** 2 > 160000) break
      }
      targetX = nextX
      targetY = nextY
    }
    pickTarget(spotX, spotY)
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
      shownRef.current.front = WORDS[from]
      shownRef.current.bottom = WORDS[to]
      writeFace(WORDS[from], frontSizerRef.current, frontTextRef.current)
      writeFace(WORDS[to], bottomSizerRef.current, bottomTextRef.current)
      const maxW = Math.max(0, ...widthsRef.current)
      if (maxW > 8) {
        stage.style.width = `${maxW}px`
        stage.style.flexBasis = `${maxW}px`
      }
      const verbW = (fromW > 8 && toW > 8) ? fromW + (toW - fromW) * slide : fromW
      if (maxW > 8 && verbW > 8) {
        const shift = (maxW - verbW) / 2
        line.style.transform = `translate3d(${shift}px, 0, 0)`
        q.style.transform = `translate3d(${verbW - maxW}px, 0, 0)`
      }
      cube.style.transform = `rotateX(${spin * 90}deg)`
      stage.classList.toggle('is-flipping', flipping)

      const dt = Math.min(0.05, Math.max(0.008, (now - last) / 1000))
      last = now
      if (now >= nextTarget) {
        pickTarget(targetX, targetY)
        nextTarget = now + 5200 + Math.random() * 2800
      }
      const toward = 1 - Math.exp(-dt / 1.6)
      const follow = 1 - Math.exp(-dt / 0.7)
      destX += (targetX - destX) * toward
      destY += (targetY - destY) * toward
      spotX += (destX - spotX) * follow
      spotY += (destY - spotY) * follow
      cropRef.current = { x: spotX, y: spotY }

      const box = line.getBoundingClientRect()
      const place = (pat: SVGPatternElement | null, host: HTMLElement) => {
        if (!pat) return
        const el = host.getBoundingClientRect()
        pat.setAttribute('patternTransform', `translate(${-(spotX + el.left - box.left)} ${-spotY})`)
      }
      place(leadPatRef.current, lead)
      place(frontPatRef.current, stage)
      place(bottomPatRef.current, stage)
      place(qPatRef.current, q)
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
          phase = 'glow'
          mark = now
          paint(0, 0, false, now)
        }
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
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
            <HollowGlyph text="WHAT COULD WE" href={fieldHref} patternRef={leadPatRef} />
          ) : 'WHAT COULD WE'}
        </span>
        <span className="flip-stage" ref={stageRef}>
          <span className="flip-cube" ref={cubeRef}>
            <span className="flip-verb flip-front" ref={frontHostRef}>
              {fieldHref ? (
                <HollowGlyph
                  text="CREATE"
                  href={fieldHref}
                  patternRef={frontPatRef}
                  sizerRef={frontSizerRef}
                  textRef={frontTextRef}
                />
              ) : 'CREATE'}
            </span>
            <span className="flip-bottom" ref={bottomRef} aria-hidden="true">
              {fieldHref ? (
                <HollowGlyph
                  text="BUILD"
                  href={fieldHref}
                  patternRef={bottomPatRef}
                  sizerRef={bottomSizerRef}
                  textRef={bottomTextRef}
                />
              ) : 'BUILD'}
            </span>
          </span>
        </span>
        <span className="flip-q" ref={qHostRef}>
          {fieldHref ? (
            <HollowGlyph text="?" href={fieldHref} patternRef={qPatRef} />
          ) : '?'}
        </span>
      </span>
    </>
  )
}

const SLASH_CMDS = [
  { id: 'stop', name: '/stop', hint: 'Stop this generation', arg: false },
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

  const openBoard = () => {
    setIntent('')
    setStep('intent')
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
    setPlusOpen(false)
    setAsking(false)
  }

  const loadCurrent = () => {
    const chat = currentChat()
    skipSave.current = true
    abortRef.current?.abort()
    abortRef.current = null
    setMessages((chat?.messages ?? []) as ChatMsg[])
    setChars([])
    setQueue([])
    queueRef.current = []
    steerRef.current = null
    setSlashOn(true)
    busyRef.current = false
    setBusy(false)
    setPlusOpen(false)
    setAsking(Boolean(chat?.messages.length))
    setBoardLeave(false)
    setBoard(false)
    setSignup(false)
    setSignin(false)
    setSettings(false)
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
    const onOpen = () => loadCurrent()
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
        openBoard()
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
      if (!got) append(offlineReply(replyTo(content)))
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        append(offlineReply(replyTo(content)))
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
    steerRef.current = null
    abortRef.current?.abort()
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

  const runSlash = (id: string, arg = '') => {
    if (id === 'stop') {
      stopGen()
      setGoal('')
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
      openBoard()
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
      openBoard()
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
        <h1 className="chat-title">
          <span className="visually-hidden">WHAT COULD WE CREATE, BUILD, OR AUTOMATE?</span>
          <FlipWord />
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
            <article key={msg.id} className={`chat-msg is-${msg.role}${prefs.showTools && msg.tools?.length ? ' is-tool' : ''}`}>
              <span className="chat-msg-who">
                {msg.role === 'orcha' ? 'Orcha · AI' : msg.kind === 'steer' ? 'You · steer' : 'You'}
                {msg.role === 'orcha' && msg.content && (
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
              {(msg.content || (busy && msg.role === 'orcha' && index === messages.length - 1)) && (
                <p>
                  {msg.content}
                  {busy && msg.role === 'orcha' && index === messages.length - 1 && (
                    <span className="chat-caret" aria-hidden="true" />
                  )}
                </p>
              )}
            </article>
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
