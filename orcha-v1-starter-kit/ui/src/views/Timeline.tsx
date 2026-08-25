import { AWAY_EVENTS } from '../data'
import type { AppState } from '../types'
import { Button, Note, Region } from '../components/Wire'

export function Timeline({ state }: { state: AppState }) {
  return (
    <>
      <div>
        <h1>While you were away</h1>
        <Note>Summarize only recorded events since the last seen cursor. Synthetic.</Note>
      </div>
      <Region n="01" label="Away summary">
        <div className="grid-3">
          <div className="block"><h3>Shipped previews</h3><p>1 · build 0.3.1</p></div>
          <div className="block"><h3>Completed tasks</h3><p>1 · research synthesis</p></div>
          <div className="block"><h3>Failures repaired</h3><p>1 · lockfile mismatch</p></div>
          <div className="block"><h3>Experiments decided</h3><p>1 · onboarding promise</p></div>
          <div className="block"><h3>New questions</h3><p>1 · extra document source</p></div>
          <div className="block"><h3>Next actions</h3><p>QA can run after next preview</p></div>
        </div>
      </Region>
      <Region n="02" label="Event list">
        <div className="list">
          {AWAY_EVENTS.map((event) => (
            <div className="item" key={event.id}>
              <span>{event.time}</span>
              <div>
                <b>{event.title}</b>
                <p>{event.kind} · {event.body}</p>
              </div>
              <span className="pill">{event.id}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button onClick={() => state.setView('recovery')}>Open recovery timeline</Button>
          <Button variant="ghost" onClick={() => state.setView('studio')}>Raw logs in Studio</Button>
        </div>
      </Region>
    </>
  )
}
