import { AGENTS, AWAY_EVENTS } from '../data'
import type { AppState } from '../types'
import { Button, Note, Region } from '../components/Wire'

export function LiveHQ({ state }: { state: AppState }) {
  const { selectedAgent, setSelectedAgent, setView } = state
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Live HQ</h1>
          <Note>Every visible connection maps to a recorded task, message, artifact, or state transition. Synthetic preview.</Note>
        </div>
        <Button onClick={() => setView('evolution')}>View evolution</Button>
      </div>
      <div className="split">
        <Region n="01" label="Live HQ map">
          <div className="map">
            <div className="edge edge-a" />
            <div className="edge edge-b" />
            <div className="edge edge-c" />
            <div className="edge edge-d" />
            <span className="edge-label el-a">dispatch</span>
            <span className="edge-label el-b">message</span>
            <span className="edge-label el-c">artifact</span>
            <span className="edge-label el-d">dependency</span>
            <div className="node center">
              <b>Orchestrator</b>
              <small>Coordinating the next move</small>
              <span className="pill">evt-018</span>
            </div>
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                className={`node node-${agent.position} ${agent.state === 'idle' ? 'idle' : ''} ${selectedAgent === agent.id ? 'selected' : ''}`}
                onClick={() => setSelectedAgent(agent.id)}
              >
                <b>{agent.name}</b>
                <small>{agent.state === 'idle' ? 'Idle' : 'Busy'}</small>
                <small>{agent.doing}</small>
              </button>
            ))}
          </div>
        </Region>
        <Region n="02" label="While you were away">
          <div className="stack">
            <p><b>3 meaningful moves</b></p>
            <Note>Only events since last seen cursor. Synthetic.</Note>
            <div className="list">
              {AWAY_EVENTS.slice(0, 4).map((event) => (
                <div className="item" key={event.id}>
                  <span>{event.time}</span>
                  <div>
                    <b>{event.title}</b>
                    <p>{event.kind} · {event.agent}</p>
                  </div>
                  <span className="pill">{event.id}</span>
                </div>
              ))}
            </div>
            <Button onClick={() => setView('timeline')}>Open full timeline</Button>
          </div>
        </Region>
      </div>
    </>
  )
}
