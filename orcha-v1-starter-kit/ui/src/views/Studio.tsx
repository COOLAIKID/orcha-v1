import { AGENTS, ASSETS, STUDIO_TABS } from '../data'
import type { AppState, StudioTab } from '../types'
import { Button, Note, Region } from '../components/Wire'

const COPY: Record<StudioTab, { title: string; body: string }> = {
  Agents: { title: 'Agents', body: 'Inspect role, version, current task, and idle vs busy. No prompt editing from this table.' },
  Prompts: { title: 'Prompts', body: '18 versions. Changes stay proposed until evaluation and policy checks pass.' },
  Tools: { title: 'Tools', body: 'Allowlisted tools only. Typed inputs, output filtering, rate limits.' },
  Workflows: { title: 'Workflows', body: 'Build → verify → learn. Promoted workflow is the current loop.' },
  Files: { title: 'Files', body: 'Same artifacts as Assets, with tier and agent-readability.' },
  Environment: { title: 'Environment', body: 'Model routing and runtime config. Inspect first; propose, do not apply live.' },
  Permissions: { title: 'Permissions', body: 'Capability grants. external.send blocked. Destructive actions remain gated.' },
  Logs: { title: 'Logs', body: 'Raw event stream. Consumer home stays outcome-oriented; this is the inspect surface.' },
  VM: { title: 'VM', body: 'Dedicated company workspace. Status healthy. Synthetic.' },
  Evaluations: { title: 'Evaluations', body: 'Experiment scoring windows, guardrails, and rollback targets.' },
}

export function Studio({ state }: { state: AppState }) {
  const { studioTab, setStudioTab } = state
  const copy = COPY[studioTab]
  return (
    <>
      <div>
        <h1>Orcha Studio</h1>
        <Note>Inspect-first. Destructive or externally consequential actions remain gated.</Note>
      </div>
      <Region n="01" label="Studio tabs">
        <div className="tabs">
          {STUDIO_TABS.map((tab) => (
            <button key={tab} className={`tab ${studioTab === tab ? 'active' : ''}`} onClick={() => setStudioTab(tab)}>{tab}</button>
          ))}
        </div>
      </Region>
      <Region n="02" label={copy.title}>
        <div className="stack">
          <p>{copy.body}</p>
          {studioTab === 'Agents' && (
            <table className="table">
              <thead><tr><th>Role</th><th>State</th><th>Doing</th><th>Outcome</th></tr></thead>
              <tbody>
                {AGENTS.map((agent) => (
                  <tr key={agent.id}><td>{agent.name}</td><td>{agent.state}</td><td>{agent.doing}</td><td>{agent.outcome}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {studioTab === 'Permissions' && (
            <table className="table">
              <thead><tr><th>Capability</th><th>State</th></tr></thead>
              <tbody>
                <tr><td>repo.write</td><td>Allowed</td></tr>
                <tr><td>shell.test</td><td>Allowed</td></tr>
                <tr><td>preview.deploy</td><td>Allowed</td></tr>
                <tr><td>external.send</td><td>Blocked</td></tr>
              </tbody>
            </table>
          )}
          {studioTab === 'Files' && (
            <table className="table">
              <thead><tr><th>File</th><th>Tier</th><th>Readable by VM</th></tr></thead>
              <tbody>
                {ASSETS.map((asset) => (
                  <tr key={asset.name}><td>{asset.name}</td><td>{asset.tier}</td><td>{asset.tier === 'Local Only' ? 'No' : 'Yes'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {studioTab !== 'Agents' && studioTab !== 'Permissions' && studioTab !== 'Files' && (
            <div className="block dash">
              <h3>Inspector</h3>
              <p>Placeholder rows for {studioTab.toLowerCase()}. Content is synthetic and inspect-only.</p>
            </div>
          )}
          <div className="row">
            <Button disabled>Propose change</Button>
            <Note>Gated until evaluation and policy pass.</Note>
          </div>
        </div>
      </Region>
    </>
  )
}
