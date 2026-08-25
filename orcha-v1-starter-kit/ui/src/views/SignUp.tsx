import { useState } from 'react'
import { LegalConsent } from './LegalConsent'

function holdFocus(event: { preventDefault(): void; currentTarget: HTMLElement }) {
  event.preventDefault()
  event.currentTarget.focus({ preventScroll: true })
}

export function SignUp({
  onCancel,
  onDone,
}: {
  onCancel: () => void
  onDone: (name: string, email: string) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [age, setAge] = useState(false)
  const [legal, setLegal] = useState(false)
  const can = name.trim().length > 0 && /.+@.+\..+/.test(email.trim()) && age && legal

  return (
    <div className="co-sheet">
      <button type="button" className="co-back" aria-label="Back to chat" onClick={onCancel}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4L6 12l8-8z" />
        </svg>
      </button>
      <div className="co-onboard">
        <section className="co-step is-ask">
          <h1>Sign up to start.</h1>
          <p className="co-lead">Saved on this device. You must be 13 or older. Then you start the business.</p>
          <label className="co-field">
            Name
            <input
              onMouseDown={holdFocus}
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 80))}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>
          <label className="co-field">
            Email
            <input
              type="email"
              onMouseDown={holdFocus}
              value={email}
              onChange={(event) => setEmail(event.target.value.slice(0, 120))}
              placeholder="you@studio.com"
              autoComplete="email"
            />
          </label>
          <LegalConsent age={age} legal={legal} onAge={setAge} onLegal={setLegal} />
          <div className="co-row">
            <button
              type="button"
              className="co-go"
              disabled={!can}
              onClick={() => onDone(name.trim(), email.trim())}
            >
              Continue
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
