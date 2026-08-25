import { EXPERIMENTS } from '../data'
import type { AppState } from '../types'
import { Button, Note, Region } from '../components/Wire'

export function Evolution({ state }: { state: AppState }) {
  const { selectedExperiment, setSelectedExperiment, setApprovalOpen } = state
  const current = EXPERIMENTS.find((item) => item.id === selectedExperiment) ?? EXPERIMENTS[1]
  return (
    <>
      <div>
        <h1>Evolution</h1>
        <Note>Measured variants compete. Promote requires a policy check. Rollback is always available.</Note>
      </div>
      <div className="split">
        <Region n="01" label="Experiment tree">
          <div className="tree">
            <div className="tree-line" />
            {EXPERIMENTS.map((item) => (
              <button key={item.id} className={`tree-node ${selectedExperiment === item.id ? 'selected' : ''}`} onClick={() => setSelectedExperiment(item.id)}>
                <span className="dot" />
                <div>
                  <b>{item.label} · {item.version}</b>
                  <p>{item.metric} · {item.decision}</p>
                </div>
              </button>
            ))}
          </div>
        </Region>
        <Region n="02" label="Variant detail">
          <div className="stack">
            <h2>{current.label}</h2>
            <p>{current.note}</p>
            <div className="metrics">
              <div className="block dash"><h3>Metric</h3><p>{current.metric}</p></div>
              <div className="block dash"><h3>Confidence</h3><p>{current.confidence}</p></div>
              <div className="block dash"><h3>Cost</h3><p>{current.cost}</p></div>
              <div className="block dash"><h3>Reliability</h3><p>{current.reliability}</p></div>
            </div>
            <p>Decision: {current.decision}</p>
            <div className="row">
              <Button variant="primary" onClick={() => setApprovalOpen(true)} disabled={current.id !== 'variant-a'}>Promote</Button>
              <Button>Rollback</Button>
            </div>
            <Note>Promote requires policy check. Rollback always available.</Note>
          </div>
        </Region>
      </div>
    </>
  )
}
