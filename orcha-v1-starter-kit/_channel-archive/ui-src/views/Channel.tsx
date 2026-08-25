import { useCallback, useEffect, useRef, useState } from 'react'

type Message = { id: string; time: string; from: string; body: string; date: string }
type Typing = { from: string; since: number }
type AgentStatus = { from: string; running: boolean; working: boolean; load: number; baseline: number }
type OpenReply = { to: string; from: string; time: string; excerpt: string }
type RunnerState = { state: 'ready' | 'blocked' | 'gui'; why: string }

const ME = 'bents'

const CREW: Record<string, { label: string; tint: string }> = {
  bents: { label: 'You', tint: '#6FA8E9' },
  claude: { label: 'Claude', tint: '#9B8CFF' },
  codex: { label: 'Codex', tint: '#62D9B1' },
  cursor: { label: 'Cursor', tint: '#EAB365' },
  opencode: { label: 'opencode', tint: '#EF7D83' },
  changes: { label: 'Orcha changed', tint: '#62D9B1' },
}

function who(from: string) {
  return CREW[from.toLowerCase()] ?? { label: from, tint: '#8D96A8' }
}

function dayLabel(date: string) {
  if (!date) return ''
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  if (date === iso) return 'Today'
  const d = new Date(`${date}T00:00:00`)
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function Channel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState<Typing[]>([])
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [owed, setOwed] = useState<OpenReply[]>([])
  const [runners, setRunners] = useState<Record<string, RunnerState>>({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/channel')
      if (!res.ok) throw new Error(`channel ${res.status}`)
      const data = await res.json()
      setMessages(data.messages ?? [])
      setTyping(data.typing ?? [])
      setAgents(data.agents ?? [])
      setOwed(data.owed ?? [])
      setRunners(data.runners ?? {})
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'cannot reach channel')
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    const el = threadRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, typing, agents])

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    stick.current = true
    try {
      const res = await fetch('/api/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: ME, body }),
      })
      if (!res.ok) throw new Error(`post ${res.status}`)
      const data = await res.json()
      setMessages(data.messages ?? [])
      setTyping(data.typing ?? [])
      setAgents(data.agents ?? [])
      setOwed(data.owed ?? [])
      setRunners(data.runners ?? {})
      setDraft('')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'send failed')
    } finally {
      setSending(false)
    }
  }

  const active = Array.from(new Set(messages.map((m) => m.from.toLowerCase())))
  let lastDate = ''
  let lastFrom = ''

  return (
    <div className="ch-wrap">
      <header className="ch-head">
        <div>
          <h1>Channel</h1>
          <p className="ch-sub">
            {active.length ? active.map((a) => who(a).label).join(', ') : 'no messages yet'}
            {error ? ` · ${error}` : ''}
          </p>
        </div>
        <div className="ch-dots" aria-label="Crew">
          {Object.entries(CREW).filter(([id]) => id !== ME && id !== 'changes').map(([id, meta]) => {
            const status = agents.find((agent) => agent.from.toLowerCase() === id)
            const state = !status || !status.running ? 'off' : status.working ? 'busy' : 'idle'
            const label = state === 'off' ? 'not running' : state === 'busy' ? 'responding now' : 'running, idle'
            return (
              <span
                key={id}
                className={`ch-dot state-${state}`}
                style={{ background: meta.tint }}
                title={`${meta.label} · ${label}`}
              />
            )
          })}
        </div>
      </header>

      <div
        className="ch-thread"
        ref={threadRef}
        onScroll={() => {
          const el = threadRef.current
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages.length === 0 && !error && (
          <p className="ch-empty">Nothing in CHANNEL.md yet. Say something and the others will see it on their next read.</p>
        )}
        {messages.map((msg) => {
          const mine = msg.from.toLowerCase() === ME
          const meta = who(msg.from)
          const showDay = msg.date !== lastDate
          const showName = !mine && msg.from !== lastFrom
          lastDate = msg.date
          lastFrom = msg.from
          return (
            <div key={msg.id}>
              {showDay && <div className="ch-day">{dayLabel(msg.date)}</div>}
              <div className={`ch-row${mine ? ' mine' : ''}`}>
                {showName && <span className="ch-name" style={{ color: meta.tint }}>{meta.label}</span>}
                <div
                  className={`ch-bubble${mine ? ' mine' : ''}`}
                  style={mine ? undefined : { borderColor: `${meta.tint}44` }}
                >
                  {msg.body}
                  <time className="ch-time">{msg.time}</time>
                </div>
              </div>
            </div>
          )
        })}

        {Array.from(
          new Set([
            ...typing.map((entry) => entry.from.toLowerCase()),
            ...agents.filter((agent) => agent.working).map((agent) => agent.from.toLowerCase()),
          ]),
        )
          .filter((name) => name !== ME)
          .map((name) => {
            const meta = who(name)
            const entry = { from: name }
            return (
              <div className="ch-row" key={`typing-${entry.from}`}>
                <span className="ch-name" style={{ color: meta.tint }}>{meta.label}</span>
                <div
                  className="ch-bubble ch-typing"
                  style={{ borderColor: `${meta.tint}44` }}
                  role="status"
                  aria-label={`${meta.label} is responding`}
                >
                  <span className="ch-typing-dots" aria-hidden="true">
                    <i style={{ background: meta.tint }} />
                    <i style={{ background: meta.tint }} />
                    <i style={{ background: meta.tint }} />
                  </span>
                </div>
              </div>
            )
          })}
      </div>

      {owed.length > 0 && (
        <div className="ch-owed" role="status">
          {owed.map((item) => (
            <span
              className={`ch-owed-chip needs-${runners[item.to]?.state ?? 'unknown'}`}
              key={`${item.to}-${item.time}`}
              style={{ borderColor: `${who(item.to).tint}55` }}
              title={runners[item.to]?.why || 'the relay will wake this agent'}
            >
              <b style={{ color: who(item.to).tint }}>{who(item.to).label}</b>
              {runners[item.to]?.state === 'ready'
                ? ' — relay is waking them'
                : ' — prompt them yourself'}
            </span>
          ))}
        </div>
      )}

      <form
        className="ch-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder="Give the crew an instruction"
          aria-label="Message the crew"
          rows={1}
        />
        <button type="submit" disabled={sending || !draft.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M11 5.2V19h2V5.2l5.3 5.3 1.4-1.4L12 1.4 4.3 9.1l1.4 1.4z" />
          </svg>
        </button>
      </form>
    </div>
  )
}
