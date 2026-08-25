import { AGENTS } from '../data'
import type { AppState } from '../types'
import { Button, Note, Region } from './Wire'

export function AgentDrawer({ state }: { state: AppState }) {
  const agent = AGENTS.find((item) => item.id === state.selectedAgent)
  if (!agent) return null
  return (
    <div className="backdrop" onClick={() => state.setSelectedAgent(null)}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="avatar">{agent.name.slice(0, 2).toUpperCase()}</span>
          <Button variant="ghost" onClick={() => state.setSelectedAgent(null)}>Close</Button>
        </div>
        <Region n="01" label="Agent evidence">
          <div className="stack">
            <h2>{agent.name}</h2>
            <p>{agent.role} · {agent.state}</p>
            <div className="block"><h3>Doing</h3><p>{agent.doing}</p></div>
            <div className="block"><h3>Why</h3><p>{agent.why}</p></div>
            <div className="block"><h3>Files changed</h3><p>{agent.files}</p></div>
            <div className="block"><h3>Tools used</h3><p>{agent.tools}</p></div>
            <div className="block"><h3>Outcome</h3><p>{agent.outcome}</p></div>
            <Note>Idle agents stay idle on the map. This drawer is evidence, not a chat.</Note>
            <Button onClick={() => { state.setSelectedAgent(null); state.setView('studio') }}>Open in Studio</Button>
          </div>
        </Region>
      </aside>
    </div>
  )
}

export function ApprovalGate({ state }: { state: AppState }) {
  if (!state.approvalOpen) return null
  return (
    <div className="backdrop center" onClick={() => state.setApprovalOpen(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <Region n="01" label="Approval gate · promote">
          <div className="stack">
            <h2>Promote Variant A?</h2>
            <p>Policy check required. Baseline stays the rollback target. Synthetic evidence only.</p>
            <div className="block dash">
              <h3>Policy checklist</h3>
              <p>Guardrail healthy · sample window complete · rollback target 0.2 present · no external.send</p>
            </div>
            <div className="row">
              <Button variant="ghost" onClick={() => state.setApprovalOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => state.setApprovalOpen(false)}>Confirm promote</Button>
            </div>
            <Note>Promote requires a policy check. Rollback remains available after promote.</Note>
          </div>
        </Region>
      </div>
    </div>
  )
}
