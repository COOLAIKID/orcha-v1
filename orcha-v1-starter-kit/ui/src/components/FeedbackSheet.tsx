import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { feedbackDiagnostics } from '../diagnostics'

type FeedbackType = 'bug' | 'suggestion' | 'feature' | 'other'

export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [type, setType] = useState<FeedbackType>('bug')
  const [message, setMessage] = useState('')
  const [actual, setActual] = useState('')
  const [expected, setExpected] = useState('')
  const [technical, setTechnical] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    const active = document.activeElement
    previousFocusRef.current = active instanceof HTMLElement ? active : null
    messageRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const sheet = sheetRef.current
      if (!sheet) return
      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'))
        .filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('aria-hidden'))
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
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previousFocusRef.current?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (state === 'sent') doneRef.current?.focus({ preventScroll: true })
  }, [state])

  const prompt = type === 'feature' ? 'What should Orcha be able to do?' : 'Tell us about it'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim() || state === 'sending') return
    setState('sending')
    setError('')
    try {
      const diagnostics = technical ? feedbackDiagnostics() : {}
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message: message.trim(), actual: actual.trim() || undefined, expected: expected.trim() || undefined, include_technical_info: technical, ...diagnostics }),
      })
      if (!response.ok) throw new Error('Feedback could not be sent.')
      setState('sent')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Feedback could not be sent.')
      setState('error')
    }
  }

  return (
    <div className="feedback-layer" role="presentation">
      <button type="button" className="feedback-dim" aria-label="Close feedback" onClick={onClose} />
      <section ref={sheetRef} className="feedback-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div>
            <h2 id={titleId}>Feedback</h2>
            <p>Help make Orcha more useful.</p>
          </div>
          <button type="button" className="feedback-close" aria-label="Close feedback" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>
        {state === 'sent' ? (
          <div className="feedback-sent" aria-live="polite">
            <strong>Received.</strong>
            <p>Thanks for helping shape Orcha.</p>
            <button ref={doneRef} type="button" className="feedback-send" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset className="feedback-types">
              <legend className="visually-hidden">Feedback type</legend>
              {([['bug', 'Bug'], ['suggestion', 'Suggestion'], ['feature', 'Feature request'], ['other', 'Other']] as const).map(([id, label]) => (
                <button key={id} type="button" className={type === id ? 'is-selected' : ''} aria-pressed={type === id} onClick={() => setType(id)}>{label}</button>
              ))}
            </fieldset>
            <label className="feedback-field">
              <span>{prompt}</span>
              <textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} rows={5} required />
            </label>
            {type === 'bug' && (
              <div className="feedback-bug-fields">
                <label className="feedback-field"><span>What happened? <em>Optional</em></span><textarea value={actual} onChange={(event) => setActual(event.target.value)} maxLength={2000} rows={2} /></label>
                <label className="feedback-field"><span>What did you expect? <em>Optional</em></span><textarea value={expected} onChange={(event) => setExpected(event.target.value)} maxLength={2000} rows={2} /></label>
              </div>
            )}
            <label className="feedback-tech">
              <input type="checkbox" checked={technical} onChange={(event) => setTechnical(event.target.checked)} />
              <span><b>Include technical info</b><small>Version, route, platform, and recent sanitized app errors only.</small></span>
            </label>
            {error && <p className="feedback-error" role="alert">{error}</p>}
            <footer>
              <button type="button" className="feedback-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="feedback-send" disabled={!message.trim() || state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send feedback'}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
