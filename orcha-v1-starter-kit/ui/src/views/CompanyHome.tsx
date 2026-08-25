import type { AppState } from '../types'
import { Button, Note, Region } from '../components/Wire'

export function CompanyHome({ state }: { state: AppState }) {
  const { setView } = state
  return (
    <>
      <div>
        <h1>Company home</h1>
        <Note>Outcome-oriented dashboard. Raw logs live in Studio.</Note>
      </div>
      <div className="grid-home">
        <Region n="01" label="Current objective">
          <div className="stack">
            <h2>Ship the first useful slice</h2>
            <p>Upload → understand → return to the same workspace.</p>
          </div>
        </Region>
        <Region n="02" label="Progress">
          <div className="stack">
            <h2>18%</h2>
            <div className="meter" aria-label="Milestone progress 18%"><span /></div>
            <p>Milestone 1 of 4 · synthetic</p>
          </div>
        </Region>
        <Region n="03" label="Active team">
          <div className="team-row">
            <div className="person"><span className="avatar">EN</span>Eng · busy</div>
            <div className="person"><span className="avatar">RS</span>Research · busy</div>
            <div className="person"><span className="avatar">DS</span>Design · busy</div>
            <div className="person"><span className="avatar">QA</span>QA · idle</div>
          </div>
        </Region>
        <Region n="04" label="Live HQ">
          <div className="stack">
            <p>Orchestrator plus 4 roles. Edges are recorded events.</p>
            <Button onClick={() => setView('hq')}>Open Live HQ</Button>
          </div>
        </Region>
        <Region n="05" label="Experiments">
          <div className="stack">
            <p>Onboarding promise · 3 variants · Variant A recommended</p>
            <Button onClick={() => setView('evolution')}>Open Evolution</Button>
          </div>
        </Region>
        <Region n="06" label="Results">
          <div className="stack">
            <p>Preview 0.3.1 healthy. Acceptance 18/18. Synthetic.</p>
            <Button onClick={() => setView('assets')}>View artifacts</Button>
          </div>
        </Region>
        <Region n="07" label="Assets">
          <div className="stack">
            <p>5 artifacts across Local Only, Company Vault, Shareable.</p>
            <Button onClick={() => setView('assets')}>Open Assets</Button>
          </div>
        </Region>
        <Region n="08" label="Cost">
          <div className="stack">
            <div className="cost-bar"><strong>$2.18 today</strong><span>$25 budget</span></div>
            <div className="meter" aria-label="Budget used"><span /></div>
            <Note>Cost meter. Not a live billing feed.</Note>
          </div>
        </Region>
        <Region n="09" label="Timeline">
          <div className="stack">
            <p>3 meaningful moves while away · 2h 18m of recorded work</p>
            <div className="row">
              <Button onClick={() => setView('timeline')}>While you were away</Button>
              <Button variant="ghost" onClick={() => setView('recovery')}>Recovery</Button>
            </div>
          </div>
        </Region>
      </div>
    </>
  )
}
