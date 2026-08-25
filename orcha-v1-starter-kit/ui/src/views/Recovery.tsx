import { RECOVERY_STEPS } from '../data'
import type { AppState } from '../types'
import { Button, Note, Region } from '../components/Wire'

export function Recovery({ state }: { state: AppState }) {
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Recovery</h1>
          <Note>A failed task shows cause, recovery attempt, and final status.</Note>
        </div>
        <Button onClick={() => state.setView('timeline')}>Back to timeline</Button>
      </div>
      <div className="grid-3">
        <Region n="01" label="Cause"><p>Build 0.3.0 failed on a transitive dependency pin. Event evt-12. Synthetic.</p></Region>
        <Region n="02" label="Recovery attempt"><p>Engineering regenerated the lockfile and reran the acceptance suite.</p></Region>
        <Region n="03" label="Final status"><p>Succeeded. Preview 0.3.1 healthy. Rollback target remains 0.2.</p></Region>
      </div>
      <Region n="04" label="Recovery timeline">
        <div className="list">
          {RECOVERY_STEPS.map((step) => (
            <div className="item" key={step.t}>
              <span>{step.t}</span>
              <div>
                <b>{step.title}</b>
                <p>{step.body}</p>
              </div>
              <span className="pill">recorded</span>
            </div>
          ))}
        </div>
      </Region>
    </>
  )
}
