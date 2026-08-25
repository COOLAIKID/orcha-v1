import { INTENTS } from '../data'
import type { AppState } from '../types'
import { Button, Note, Region } from '../components/Wire'

export function Onboarding({ state }: { state: AppState }) {
  const { step, setStep, intent, setIntent, goal, setGoal, constraints, setConstraint } = state

  const startCompany = () => {
    state.setView('home')
  }

  return (
    <>
      <div>
        <h1>What do you want your company to accomplish?</h1>
        <Note>Onboarding flow. Ordinary internal work after Start does not require repeated approval.</Note>
      </div>

      {step === 'intent' && (
        <Region n="01" label="Intent cards">
          <div className="stack">
            <p>Pick a starting shape. You can still write the outcome in your own words next.</p>
            <div className="intent-grid">
              {INTENTS.map((item) => (
                <button key={item.id} className={`intent ${intent === item.id ? 'selected' : ''}`} onClick={() => setIntent(item.id)}>
                  <b>{item.title}</b>
                  <span>{item.detail}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <Button variant="primary" onClick={() => setStep('goal')} disabled={!intent}>Continue to goal</Button>
            </div>
          </div>
        </Region>
      )}

      {step === 'goal' && (
        <Region n="02" label="Goal input">
          <div className="stack">
            <label className="field">
              Company outcome
              <textarea value={goal} onChange={(event) => setGoal(event.target.value)} aria-label="Company goal" />
            </label>
            <Note>Synthetic placeholder copy. Character count {goal.length}/500.</Note>
            <div className="row">
              <Button variant="ghost" onClick={() => setStep('intent')}>Back</Button>
              <Button onClick={() => setStep('constraints')}>Add constraints</Button>
              <Button variant="primary" onClick={() => setStep('plan')}>Skip constraints</Button>
            </div>
          </div>
        </Region>
      )}

      {step === 'constraints' && (
        <Region n="03" label="Optional constraints">
          <div className="stack">
            <p>Audience, deadline, budget, and existing assets. All optional.</p>
            <div className="grid-2">
              <label className="field">Audience<input value={constraints.audience} onChange={(e) => setConstraint('audience', e.target.value)} /></label>
              <label className="field">Deadline<input value={constraints.deadline} onChange={(e) => setConstraint('deadline', e.target.value)} /></label>
              <label className="field">Budget<input value={constraints.budget} onChange={(e) => setConstraint('budget', e.target.value)} /></label>
              <label className="field">Existing assets<input value={constraints.assets} onChange={(e) => setConstraint('assets', e.target.value)} /></label>
            </div>
            <div className="row">
              <Button variant="ghost" onClick={() => setStep('goal')}>Back</Button>
              <Button variant="primary" onClick={() => setStep('plan')}>Generate company plan</Button>
            </div>
          </div>
        </Region>
      )}

      {step === 'plan' && (
        <Region n="04" label="Company plan · start">
          <div className="stack">
            <div className="row">
              <h2>StudyFlow</h2>
              <span className="pill">Ready to start · synthetic</span>
            </div>
            <p>{goal}</p>
            <div className="plan-grid">
              <div className="block"><h3>Objective</h3><p>Students can add course material, get a clear summary, and return later.</p></div>
              <div className="block"><h3>First milestone</h3><p>Ship a useful first slice. Target: first preview in 7 days.</p><div className="meter" aria-label="Milestone 0%"><span /></div></div>
              <div className="block">
                <h3>Team</h3>
                <div className="team-row">
                  <div className="person"><span className="avatar">EN</span>Engineering</div>
                  <div className="person"><span className="avatar">RS</span>Research</div>
                  <div className="person"><span className="avatar">DS</span>Design</div>
                </div>
                <Note>QA joins when the first build is ready.</Note>
              </div>
              <div className="block"><h3>Assumptions</h3><p>Single owner. English. No payments in V1. Isolated VM workspace.</p></div>
              <div className="block"><h3>Permissions</h3><p>repo.write and shell.test required. external.send blocked by default.</p></div>
              <div className="block"><h3>Expected outputs</h3><p>Plan, repo, preview URL, experiment record, activity timeline.</p></div>
            </div>
            <div className="row">
              <Button variant="ghost" onClick={() => setStep('constraints')}>Back</Button>
              <Button variant="primary" onClick={startCompany}>Start Company</Button>
            </div>
            <Note>Start Company. Ordinary internal work does not require repeated approval.</Note>
          </div>
        </Region>
      )}
    </>
  )
}
