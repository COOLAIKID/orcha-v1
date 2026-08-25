import { useState } from 'react'
import { getWorkspace } from '../workspace'

function holdFocus(event: { preventDefault(): void; currentTarget: HTMLElement }) {
  event.preventDefault()
  event.currentTarget.focus({ preventScroll: true })
}

export function SignIn({
  onCancel,
  onDone,
}: {
  onCancel: () => void
  onDone: (email: string) => boolean
}) {
  const saved = getWorkspace().account
  const [email, setEmail] = useState(saved?.email ?? '')
  const [miss, setMiss] = useState(false)
  const can = /.+@.+\..+/.test(email.trim())

  return (
    <div className="co-sheet">
      <button type="button" className="co-back" aria-label="Back to chat" onClick={onCancel}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4L6 12l8-8z" />
        </svg>
      </button>
      <div className="co-onboard">
        <section className="co-step is-ask">
          <h1>Sign in to chat.</h1>
          <p className="co-lead">
            {saved ? `Welcome back, ${saved.name}. Use the email on this device.` : 'Orcha is locked until you sign in.'}
          </p>
          <label className="co-field">
            Email
            <input
              type="email"
              onMouseDown={holdFocus}
              value={email}
              onChange={(event) => {
                setMiss(false)
                setEmail(event.target.value.slice(0, 120))
              }}
              placeholder={saved?.email || 'you@studio.com'}
              autoComplete="email"
            />
          </label>
          {miss && <p className="st-lead">That email does not match this device.</p>}
          <div className="co-row">
            <button
              type="button"
              className="co-go"
              disabled={!can}
              onClick={() => {
                if (!onDone(email.trim())) setMiss(true)
              }}
            >
              Sign in
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
