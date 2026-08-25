import { useEffect, useState, type ReactNode } from 'react'
import { SUPPORT_MAIL, type LegalId } from '../legal'
import {
  addReport,
  clearAllChats,
  deleteAccount,
  exportWorkspace,
  getWorkspace,
  isSignedIn,
  openBusiness,
  signIn,
  signOut,
  signUp,
  subscribeWorkspace,
  updateAccount,
  updatePrefs,
  workspaceStats,
  type Prefs,
} from '../workspace'
import { LegalConsent } from './LegalConsent'
import { LegalDoc } from './LegalDoc'

type Pane = 'general' | 'chat' | 'personal' | 'company' | 'data' | 'legal' | 'account'

const PANES: { id: Pane; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'chat', label: 'Chat' },
  { id: 'personal', label: 'Personalization' },
  { id: 'company', label: 'Companies' },
  { id: 'data', label: 'Data controls' },
  { id: 'legal', label: 'Legal & Privacy' },
  { id: 'account', label: 'Account' },
]

function holdFocus(event: { preventDefault(): void; currentTarget: HTMLElement }) {
  event.preventDefault()
  event.currentTarget.focus({ preventScroll: true })
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="st-item">
      <div className="st-item-copy">
        <b>{title}</b>
        {hint ? <p>{hint}</p> : null}
      </div>
      <div className="st-item-ctrl">{children}</div>
    </div>
  )
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`st-switch${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
    />
  )
}

function Select({
  value,
  label,
  options,
  onChange,
}: {
  value: string
  label: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <select
      aria-label={label}
      className="st-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

export function Settings({ onBack }: { onBack: () => void }) {
  const [room, setRoom] = useState(getWorkspace)
  const account = room.account
  const inSession = isSignedIn()
  const prefs = room.prefs
  const [pane, setPane] = useState<Pane>(inSession ? 'general' : 'account')
  const [name, setName] = useState(account?.name ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [saved, setSaved] = useState(false)
  const [miss, setMiss] = useState(false)
  const [wipe, setWipe] = useState<'chats' | 'account' | null>(null)
  const [age, setAge] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [doc, setDoc] = useState<LegalId | null>(null)
  const [flagged, setFlagged] = useState(false)
  const canProfile = name.trim().length > 0 && /.+@.+\..+/.test(email.trim())
  const canSignUp = canProfile && age && agreed
  const canSignIn = /.+@.+\..+/.test(email.trim())
  const dirty = name.trim() !== (account?.name ?? '') || email.trim() !== (account?.email ?? '')
  const stats = workspaceStats()
  const companies = inSession
    ? [...room.businesses].sort((left, right) => right.createdAt - left.createdAt)
    : []

  useEffect(() => subscribeWorkspace(() => setRoom(getWorkspace())), [])

  useEffect(() => {
    setName(account?.name ?? '')
    setEmail(account?.email ?? '')
  }, [account?.name, account?.email, inSession])

  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    updatePrefs({ [key]: value })
  }

  const save = () => {
    if (!canProfile) return
    updateAccount(name.trim(), email.trim())
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  const create = () => {
    if (!canSignUp) return
    signUp(name.trim(), email.trim())
    setSaved(true)
    setPane('general')
    window.setTimeout(() => setSaved(false), 1600)
  }

  const enter = () => {
    if (!signIn(email.trim())) {
      setMiss(true)
      return
    }
    setMiss(false)
    setPane('general')
  }

  return (
    <div className="st-page">
      <header className="st-head">
        <button type="button" className="co-back" aria-label="Back to chat" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path fill="currentColor" d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4L6 12l8-8z" />
          </svg>
        </button>
        <h1>Settings</h1>
      </header>

      <div className="st-body">
        <nav className="st-nav" aria-label="Settings">
          {PANES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`st-nav-item${pane === item.id ? ' is-on' : ''}`}
              aria-current={pane === item.id ? 'page' : undefined}
              onClick={() => {
                setWipe(null)
                setDoc(null)
                setPane(item.id)
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="st-panel">
          {doc ? (
            <LegalDoc id={doc} onBack={() => setDoc(null)} />
          ) : null}
          {!doc && pane === 'general' && (
            <>
              <h2>General</h2>
              <div className="st-group">
                <Row title="Language" hint="Used for this browser session.">
                  <Select
                    label="Language"
                    value={prefs.language}
                    onChange={(value) => setPref('language', value === 'en' ? 'en' : 'auto')}
                    options={[
                      { value: 'auto', label: 'Auto-detect' },
                      { value: 'en', label: 'English' },
                    ]}
                  />
                </Row>
                <Row title="Motion" hint="Controls landing, menus, and sheet motion.">
                  <Select
                    label="Motion"
                    value={prefs.motion}
                    onChange={(value) => setPref('motion', value as Prefs['motion'])}
                    options={[
                      { value: 'system', label: 'Match system' },
                      { value: 'full', label: 'Full motion' },
                      { value: 'reduce', label: 'Reduce motion' },
                    ]}
                  />
                </Row>
                <Row title="Density" hint="How tight chat and controls sit.">
                  <Select
                    label="Density"
                    value={prefs.density}
                    onChange={(value) => setPref('density', value === 'compact' ? 'compact' : 'comfortable')}
                    options={[
                      { value: 'comfortable', label: 'Comfortable' },
                      { value: 'compact', label: 'Compact' },
                    ]}
                  />
                </Row>
              </div>
            </>
          )}

          {!doc && pane === 'chat' && (
            <>
              <h2>Chat</h2>
              <div className="st-group">
                <Row title="Submit with Enter" hint="Shift+Enter still adds a new line. When off, use Ctrl+Enter or Cmd+Enter to send.">
                  <Switch
                    on={prefs.submitOnEnter}
                    label="Submit with Enter"
                    onChange={(value) => setPref('submitOnEnter', value)}
                  />
                </Row>
                <Row title="Slash command menu" hint="Show matching commands when you type /.">
                  <Switch
                    on={prefs.slashHints}
                    label="Slash command menu"
                    onChange={(value) => setPref('slashHints', value)}
                  />
                </Row>
                <Row title="Show attached tools" hint="Keep files, constraints, and other attachments visible in the thread.">
                  <Switch
                    on={prefs.showTools}
                    label="Show attached tools"
                    onChange={(value) => setPref('showTools', value)}
                  />
                </Row>
                <Row title="Open last chat on sign in" hint="Return to the most recent company and thread after you sign in.">
                  <Switch
                    on={prefs.restoreLatest}
                    label="Open last chat on sign in"
                    onChange={(value) => setPref('restoreLatest', value)}
                  />
                </Row>
              </div>
            </>
          )}

          {!doc && pane === 'personal' && (
            <>
              <h2>Personalization</h2>
              <p className="st-lead">Orcha uses this on the next reply. It stays on this device.</p>
              <div className="st-group st-group-stack">
                <label className="st-field">
                  Custom instructions
                  <textarea
                    onMouseDown={holdFocus}
                    value={prefs.customInstructions}
                    onChange={(event) => setPref('customInstructions', event.target.value.slice(0, 1500))}
                    placeholder="How should Orcha work with you? Tone, constraints, what to skip."
                    rows={5}
                  />
                </label>
                <label className="st-field">
                  About you
                  <textarea
                    onMouseDown={holdFocus}
                    value={prefs.aboutYou}
                    onChange={(event) => setPref('aboutYou', event.target.value.slice(0, 800))}
                    placeholder="What should Orcha know about you or the companies you run?"
                    rows={4}
                  />
                </label>
              </div>
            </>
          )}

          {!doc && pane === 'company' && (
            <>
              <h2>Companies</h2>
              {!inSession ? (
                <p className="st-lead">Sign in to see companies on this device.</p>
              ) : (
                <>
                  <p className="st-lead">
                    {stats.businesses === 0
                      ? 'No companies on this device yet.'
                      : `${stats.businesses} compan${stats.businesses === 1 ? 'y' : 'ies'} · ${stats.chats} chat${stats.chats === 1 ? '' : 's'}`}
                  </p>
                  {companies.length > 0 && (
                    <ul className="st-list">
                      {companies.map((business) => (
                        <li key={business.id}>
                          <button
                            type="button"
                            className="st-company"
                            onClick={() => {
                              openBusiness(business.id)
                              onBack()
                            }}
                          >
                            <span>
                              <b>{business.name}</b>
                              <small>{business.chats.length} chat{business.chats.length === 1 ? '' : 's'}</small>
                            </span>
                            <small>{new Date(business.createdAt).toLocaleDateString()}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}

          {!doc && pane === 'data' && (
            <>
              <h2>Data controls</h2>
              <div className="st-group">
                <Row title="Save chat history" hint="When off, new messages stay in this session only and are not written to the device.">
                  <Switch
                    on={prefs.saveHistory}
                    label="Save chat history"
                    onChange={(value) => setPref('saveHistory', value)}
                  />
                </Row>
                <Row title="Export data" hint="Download account, companies, chats, and settings as JSON.">
                  <button type="button" className="st-chip" onClick={exportWorkspace}>Export</button>
                </Row>
              </div>
              <div className="st-group">
                <Row title="Delete all chats" hint="Keeps companies. Removes messages from every thread on this device.">
                  <button
                    type="button"
                    className="st-chip is-warn"
                    disabled={!inSession || stats.chats === 0}
                    onClick={() => {
                      if (wipe !== 'chats') {
                        setWipe('chats')
                        return
                      }
                      clearAllChats()
                      setWipe(null)
                    }}
                  >
                    {wipe === 'chats' ? 'Confirm delete' : 'Delete'}
                  </button>
                </Row>
                <Row title="Delete account" hint="Removes the account, companies, chats, reports, and settings from this device now. Sign out is not deletion.">
                  <button
                    type="button"
                    className="st-chip is-warn"
                    disabled={!account}
                    onClick={() => {
                      if (wipe !== 'account') {
                        setWipe('account')
                        return
                      }
                      deleteAccount()
                      setWipe(null)
                      setPane('account')
                    }}
                  >
                    {wipe === 'account' ? 'Confirm delete' : 'Delete'}
                  </button>
                </Row>
              </div>
            </>
          )}

          {!doc && pane === 'legal' && (
            <>
              <h2>Legal & Privacy</h2>
              <p className="st-lead">
                Replies are AI-generated. Account data stays on this device. Cloud AI sends chat text to the model providers Orcha uses. Orcha is for people 13 and older.
              </p>
              <div className="st-group">
                <Row title="Cloud AI" hint="When on, chat text, custom instructions, and About you are sent to whichever model providers Orcha has connected, not a single vendor. Turn off to keep prompts on this device. That is how you withdraw consent.">
                  <Switch
                    on={prefs.cloudAi}
                    label="Cloud AI"
                    onChange={(value) => setPref('cloudAi', value)}
                  />
                </Row>
                <Row title="Live models" hint="The catalog refreshes about every 15 minutes. A free model that ranks at or above GPT-5.6 — Ox Alpha today — takes everyday and hard work. Video files are planned here and rendered elsewhere.">
                  <span className="st-chip">Ox Alpha</span>
                </Row>
              </div>
              <div className="st-group">
                <Row title="Privacy Policy" hint="What we store, what model providers receive, retention, and deletion.">
                  <button type="button" className="st-chip" onClick={() => setDoc('privacy')}>View</button>
                </Row>
                <Row title="Terms of Use" hint="Eligibility, acceptable use, and how AI output may be used.">
                  <button type="button" className="st-chip" onClick={() => setDoc('terms')}>View</button>
                </Row>
                <Row title="Delete account" hint="Also at /delete-account for a store listing web resource. This is full deletion, not a freeze.">
                  <button type="button" className="st-chip" onClick={() => setDoc('delete')}>View</button>
                </Row>
              </div>
              <div className="st-group">
                <Row title="Report AI content" hint="Flag an offensive or unsafe reply without leaving Orcha. Required for generative AI on Google Play. Reports stay on this device in the prototype.">
                  <button
                    type="button"
                    className="st-chip"
                    onClick={() => {
                      addReport('settings', 'Flagged from Settings')
                      setFlagged(true)
                      window.setTimeout(() => setFlagged(false), 1600)
                    }}
                  >
                    {flagged ? 'Reported' : 'Report'}
                  </button>
                </Row>
                <Row title="Contact" hint="Apple requires a support path. This address must match the store listing.">
                  <a className="st-chip" href={`mailto:${SUPPORT_MAIL}`}>{SUPPORT_MAIL}</a>
                </Row>
              </div>
              {inSession && (
                <div className="st-group">
                  <Row title="Delete account" hint="Removes all associated data on this device immediately.">
                    <button
                      type="button"
                      className="st-chip is-warn"
                      onClick={() => {
                        if (wipe !== 'account') {
                          setWipe('account')
                          return
                        }
                        deleteAccount()
                        setWipe(null)
                        setPane('account')
                      }}
                    >
                      {wipe === 'account' ? 'Confirm delete' : 'Delete'}
                    </button>
                  </Row>
                </div>
              )}
            </>
          )}

          {!doc && pane === 'account' && (
            <>
              <h2>Account</h2>
              {!inSession && !account && (
                <p className="st-lead">Create an account on this device. Then the AI can run.</p>
              )}
              {!inSession && account && (
                <p className="st-lead">Signed out. Sign in with {account.email} to use the AI again.</p>
              )}
              {inSession && (
                <p className="st-lead">This name shows in the sidebar. Saved on this device.</p>
              )}
              <div className="st-group st-group-stack">
                {(!inSession && !account) || inSession ? (
                  <label className="st-field">
                    Name
                    <input
                      onMouseDown={holdFocus}
                      value={name}
                      onChange={(event) => setName(event.target.value.slice(0, 80))}
                      placeholder="Your name"
                      autoComplete="name"
                    />
                  </label>
                ) : null}
                <label className="st-field">
                  Email
                  <input
                    type="email"
                    onMouseDown={holdFocus}
                    value={email}
                    onChange={(event) => {
                      setMiss(false)
                      setEmail(event.target.value.slice(0, 120))
                    }}
                    placeholder="you@studio.com"
                    autoComplete="email"
                  />
                </label>
                {miss && <p className="st-lead">That email does not match this device.</p>}
                {!inSession && !account && (
                  <LegalConsent age={age} legal={agreed} onAge={setAge} onLegal={setAgreed} />
                )}
                <div className="st-item">
                  <div className="st-item-copy">
                    <b>{inSession ? 'Profile' : account ? 'This device' : 'Create account'}</b>
                    <p>{inSession ? 'Save changes to name or email.' : account ? 'Use the email saved on this browser.' : 'No password. 13 or older. Terms and Privacy required.'}</p>
                  </div>
                  <div className="st-item-ctrl">
                    {inSession ? (
                      <button type="button" className="st-chip is-go" disabled={!canProfile || !dirty} onClick={save}>
                        {saved ? 'Saved' : 'Save'}
                      </button>
                    ) : account ? (
                      <button type="button" className="st-chip is-go" disabled={!canSignIn} onClick={enter}>
                        Sign in
                      </button>
                    ) : (
                      <button type="button" className="st-chip is-go" disabled={!canSignUp} onClick={create}>
                        {saved ? 'Signed up' : 'Sign up'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="st-group">
                <Row title="Orcha Pro" hint="$20/month. Hosted on a ~$10 VM. About $5 of frontier models (GPT-5.6) for the hardest questions. All other chat uses free-tier Gemini, then Groq, so replies can continue after the 50,000 premium-token allowance. This prototype does not collect payment.">
                  <span className="st-chip">$20 / mo</span>
                </Row>
              </div>
              {inSession && (
                <div className="st-group">
                  <Row title="Sign out" hint="Locks the AI on this device until you sign in again. Data stays here.">
                    <button type="button" className="st-chip" onClick={() => signOut()}>Sign out</button>
                  </Row>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
