import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FIELD_H, FIELD_W, getBlueFieldHref } from '../blueField'
import { buildPath, labelOf, teamFrom } from '../onboardFlow'
import type { AppState } from '../types'

function holdFocus(event: { preventDefault(): void; currentTarget: HTMLElement }) {
  event.preventDefault()
  event.currentTarget.focus({ preventScroll: true })
}

function ChoiceGrid({
  items,
  values,
  note,
  placeholder,
  onToggle,
  onNote,
}: {
  items: { id: string; title: string }[]
  values: string[]
  note: string
  placeholder: string
  onToggle: (id: string) => void
  onNote: (value: string) => void
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sizerRef = useRef<HTMLDivElement>(null)
  const tileRef = useRef<HTMLDivElement>(null)
  const [noteH, setNoteH] = useState(32)
  const editing = values.includes('other')
  const line = 32

  useEffect(() => {
    if (!editing) return
    const id = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 200)
    return () => window.clearTimeout(id)
  }, [editing])

  useLayoutEffect(() => {
    const tile = tileRef.current
    const sizer = sizerRef.current
    const box = inputRef.current
    if (!editing || !note || !tile || !sizer) {
      setNoteH(line)
      if (box) box.style.overflowY = 'hidden'
      return
    }
    const maxH = Math.max(line, tile.clientHeight - 20)
    sizer.style.width = `${Math.max(0, tile.clientWidth - 20)}px`
    const nextH = Math.min(maxH, Math.max(line, sizer.offsetHeight))
    setNoteH(nextH)
    if (box) box.style.overflowY = sizer.offsetHeight > maxH ? 'auto' : 'hidden'
  }, [editing, note])

  return (
    <div className="co-intents">
      {items.map((item, i) => {
        const on = values.includes(item.id)
        const edit = item.id === 'other' && on
        return (
          <div
            key={item.id}
            ref={item.id === 'other' ? tileRef : undefined}
            className={`co-intent${on ? ' is-on' : ''}${edit ? ' is-edit' : ''}`}
            style={{ '--i': i } as CSSProperties}
          >
            <button
              type="button"
              className="co-intent-pick"
              tabIndex={edit ? -1 : 0}
              aria-pressed={on}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onToggle(item.id)}
            >
              <b>{item.title}</b>
              <span className="co-intent-state" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path d="m3.3 8.2 2.8 2.8 6.3-6.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            {item.id === 'other' && (
              <>
                <div ref={sizerRef} className="co-intent-sizer" aria-hidden="true">{note}</div>
                <textarea
                  ref={inputRef}
                  className="co-intent-note"
                  style={{ height: noteH }}
                  value={note}
                  rows={1}
                  placeholder={placeholder}
                  aria-label={placeholder}
                  tabIndex={edit ? 0 : -1}
                  onMouseDown={(event) => {
                    event.stopPropagation()
                    holdFocus(event)
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      onToggle('other')
                    }
                  }}
                  onChange={(event) => onNote(event.target.value.slice(0, 140))}
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function guessName(goal: string) {
  const stop = new Set(['a', 'an', 'the', 'to', 'for', 'my', 'our', 'and', 'or', 'of', 'in', 'on'])
  const words = goal
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !stop.has(word.toLowerCase()))
  if (words.length === 0) return ''
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase()
}

function FieldBar({ fill, pct }: { fill: number; pct: number }) {
  const uid = useId().replace(/:/g, '')
  const barRef = useRef<HTMLDivElement>(null)
  const picRef = useRef<SVGSVGElement>(null)
  const patRef = useRef<SVGPatternElement>(null)
  const [href, setHref] = useState('')

  useEffect(() => {
    const win = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    const run = () => setHref(getBlueFieldHref())
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(run, { timeout: 2500 })
      return () => win.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(run, 0)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    const bar = barRef.current
    const pic = picRef.current
    if (!bar || !pic) return
    const sync = () => {
      pic.style.width = `${bar.clientWidth}px`
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [href])

  useEffect(() => {
    const pat = patRef.current
    if (!pat || !href) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let spotX = 360
    let spotY = 280
    let destX = spotX
    let destY = spotY
    let targetX = spotX
    let targetY = spotY
    let nextTarget = 0
    let last = performance.now()
    let raf = 0

    const pickTarget = (fromX: number, fromY: number) => {
      let nextX = fromX
      let nextY = fromY
      for (let i = 0; i < 8; i += 1) {
        nextX = 40 + Math.random() * (FIELD_W * 0.68)
        nextY = 40 + Math.random() * (FIELD_H * 0.68)
        if ((nextX - fromX) ** 2 + (nextY - fromY) ** 2 > 160000) break
      }
      targetX = nextX
      targetY = nextY
    }
    pickTarget(spotX, spotY)

    const paint = (now: number) => {
      if (!reduce) {
        const dt = Math.min(0.05, Math.max(0.008, (now - last) / 1000))
        last = now
        if (now >= nextTarget) {
          pickTarget(targetX, targetY)
          nextTarget = now + 5200 + Math.random() * 2800
        }
        destX += (targetX - destX) * (1 - Math.exp(-dt / 2.4))
        destY += (targetY - destY) * (1 - Math.exp(-dt / 2.4))
        spotX += (destX - spotX) * (1 - Math.exp(-dt / 0.95))
        spotY += (destY - spotY) * (1 - Math.exp(-dt / 0.95))
      }
      pat.setAttribute('x', String(-spotX))
      pat.setAttribute('y', String(-spotY))
    }

    paint(performance.now())
    if (reduce) return
    const tick = (now: number) => {
      paint(now)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [href])

  return (
    <div
      ref={barRef}
      className="co-bar"
      role="progressbar"
      aria-label="Onboarding progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="co-bar-clip" style={{ transform: `scaleX(${fill / 100})` }}>
        <svg ref={picRef} className="co-bar-pic" aria-hidden="true">
          <defs>
            <pattern
              ref={patRef}
              id={`bar-field-${uid}`}
              patternUnits="userSpaceOnUse"
              width={FIELD_W}
              height={FIELD_H}
              x={-360}
              y={-280}
            >
              {href ? <image href={href} width={FIELD_W} height={FIELD_H} /> : null}
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#bar-field-${uid})`} />
        </svg>
      </span>
    </div>
  )
}

export function CompanyOnboard({
  state,
  onCancel,
  onStart,
}: {
  state: AppState
  onCancel: () => void
  onStart: (brief: string, name: string) => void
}) {
  const { setStep, setIntent, goal, setGoal, constraints, setConstraint } = state
  const [name, setName] = useState('')
  const [picks, setPicks] = useState<string[]>([])
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [page, setPage] = useState(0)
  const [fill, setFill] = useState(10)
  const path = useMemo(() => buildPath(picks), [picks])
  const index = Math.min(page, path.length - 1)
  const current = path[index]
  const lastIndex = useRef(index)
  const dir = index >= lastIndex.current ? 1 : -1
  const goingBack = index < lastIndex.current
  const pct = index === 0 ? 10 : Math.round((index / Math.max(1, path.length - 1)) * 100)
  const company = name.trim() || guessName(goal) || 'New business'
  const team = teamFrom(picks)
  const noun = labelOf(picks)
  const card = current.kind === 'cards' ? current : null
  const selected = card ? (answers[card.id] ?? (card.id === 'shape' ? picks : [])) : []
  const note = card ? (notes[card.id] ?? '') : ''
  const canCards = selected.length > 0 && (!selected.includes('other') || note.trim().length > 0)

  const setNote = (id: string, value: string) => {
    setNotes((current) => ({ ...current, [id]: value }))
  }

  const toggle = (id: string) => {
    if (!card) return
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]
    if (card.id === 'shape') {
      setPicks(next)
      setIntent(next.join(','))
      setAnswers((current) => {
        const kept: Record<string, string[]> = { ...current, shape: next }
        for (const key of Object.keys(kept)) {
          if (key.startsWith('follow-') && !next.includes(key.slice(7))) delete kept[key]
        }
        return kept
      })
      return
    }
    setAnswers((current) => ({ ...current, [card.id]: next }))
  }

  const goNext = () => setPage((value) => Math.min(path.length - 1, value + 1))
  const goBack = () => {
    if (index <= 0) {
      onCancel()
      return
    }
    setPage((value) => Math.max(0, value - 1))
  }

  useEffect(() => {
    lastIndex.current = index
  }, [index])

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const apply = () => setFill((current) => (goingBack ? pct : Math.max(current, pct)))
    if (reduce) {
      apply()
      return
    }
    const id = window.requestAnimationFrame(apply)
    return () => window.cancelAnimationFrame(id)
  }, [goingBack, pct])

  useEffect(() => {
    if (page > path.length - 1) setPage(path.length - 1)
  }, [page, path.length])

  useEffect(() => {
    const id = current.id
    setStep(id === 'shape' ? 'intent' : id === 'plan' ? 'plan' : id.startsWith('follow-') ? 'kind' : id === 'name' || id === 'offer' || id === 'audience' || id === 'deadline' || id === 'budget' || id === 'extra' ? id : 'intent')
  }, [current.id, setStep])

  const plan = useMemo(() => {
    const followBits = Object.entries(answers)
      .filter(([key, value]) => key.startsWith('follow-') && value.length)
      .map(([key, value]) => `${key.slice(7)}: ${value.join(', ')}`)
    const extraNotes = Object.values(notes).map((value) => value.trim()).filter(Boolean)
    return {
      objective: goal.trim() || extraNotes[0] || `${noun} still to be named.`,
      milestone: constraints.deadline.trim()
        ? `First paying user. Target: ${constraints.deadline.trim()}.`
        : 'First paying user in 14 days.',
      audience: constraints.audience.trim() || 'Not named yet.',
      budget: constraints.budget.trim() || 'Stay inside the daily budget.',
      assets: [constraints.assets.trim(), ...extraNotes.slice(1), ...followBits].filter(Boolean).join(' · ') || 'Nothing else noted.',
    }
  }, [answers, constraints, goal, notes, noun])

  const startCompany = () => {
    const lines = [
      `Start a business named ${company}.`,
      `Kind: ${noun}${notes.shape?.trim() ? ` · ${notes.shape.trim()}` : ''}.`,
      `What it does: ${plan.objective}`,
      `Users: ${plan.audience}`,
      `First milestone: ${plan.milestone}`,
      `Budget: ${plan.budget}`,
      `Other: ${plan.assets}`,
      'This is fully online. Orcha runs it end to end. No physical shop, shipping, or in-person work. Ordinary internal work does not need repeated approval.',
    ]
    onStart(lines.join('\n'), company)
  }

  return (
    <div className="co-sheet">
      <button
        type="button"
        className="co-back"
        aria-label={index <= 0 ? 'Back to chat' : 'Back'}
        onClick={goBack}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4L6 12l8-8z" />
        </svg>
      </button>
      <div
        className="co-onboard"
        onScroll={(event) => {
          event.currentTarget.scrollTop = 0
          event.currentTarget.scrollLeft = 0
        }}
      >
      <div className="co-meter">
        <FieldBar fill={fill} pct={pct} />
        <b className="co-pct">{Math.round(fill)}%</b>
      </div>

      {current.kind === 'cards' && (
        <section key={current.id} className="co-step" data-dir={dir}>
          <h1>{current.title}</h1>
          {current.id === 'shape' && <p className="co-lead">Choose everything that matters. You can pick more than one.</p>}
          <ChoiceGrid
            items={current.items}
            values={selected}
            note={note}
            placeholder={current.placeholder}
            onToggle={toggle}
            onNote={(value) => setNote(current.id, value)}
          />
          <div className="co-row">
            <button type="button" className="co-go" disabled={!canCards} onClick={goNext}>
              Continue{selected.length > 0 ? ` · ${selected.length} selected` : ''}
            </button>
          </div>
        </section>
      )}

      {current.kind === 'ask' && (
        <section key={current.id} className={`co-step is-ask`} data-dir={dir}>
          <h1>{current.title}</h1>
          <label className="co-field">
            <input
              onMouseDown={holdFocus}
              value={
                current.id === 'name' ? name
                  : current.id === 'offer' ? goal
                    : current.id === 'audience' ? constraints.audience
                      : current.id === 'deadline' ? constraints.deadline
                        : current.id === 'budget' ? constraints.budget
                          : constraints.assets
              }
              onChange={(event) => {
                const value = event.target.value
                if (current.id === 'name') setName(value)
                else if (current.id === 'offer') setGoal(value.slice(0, 140))
                else if (current.id === 'audience') setConstraint('audience', value)
                else if (current.id === 'deadline') setConstraint('deadline', value)
                else if (current.id === 'budget') setConstraint('budget', value)
                else setConstraint('assets', value)
              }}
              placeholder={current.id === 'name' ? (guessName(goal) || current.placeholder) : current.placeholder}
            />
          </label>
          <div className="co-row">
            <button
              type="button"
              className="co-go"
              disabled={current.required && !goal.trim()}
              onClick={goNext}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {current.kind === 'plan' && (
        <section key="plan" className="co-step" data-dir={dir}>
          <h1>{company} is ready to run.</h1>
          <div className="co-plan">
            <article style={{ '--i': 0 } as CSSProperties}>
              <h2>The offer</h2>
              <p>{plan.objective}</p>
            </article>
            <article style={{ '--i': 1 } as CSSProperties}>
              <h2>First ship</h2>
              <p>{plan.milestone}</p>
            </article>
            <article style={{ '--i': 2 } as CSSProperties}>
              <h2>Who works it</h2>
              <div className="co-team">
                {team.map((role) => (
                  <span key={role}><i>{initials(role)}</i>{role}</span>
                ))}
              </div>
            </article>
            <article style={{ '--i': 3 } as CSSProperties}>
              <h2>Customers</h2>
              <p>{plan.audience}</p>
            </article>
            <article style={{ '--i': 4 } as CSSProperties}>
              <h2>Money</h2>
              <p>{plan.budget}</p>
            </article>
            <article style={{ '--i': 5 } as CSSProperties}>
              <h2>Other</h2>
              <p>{plan.assets}</p>
            </article>
          </div>
          <div className="co-row">
            <button type="button" className="co-go" onClick={startCompany}>Start the business</button>
          </div>
        </section>
      )}
      </div>
    </div>
  )
}
