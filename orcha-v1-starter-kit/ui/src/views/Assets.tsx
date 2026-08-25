import { ASSETS } from '../data'
import type { AppState } from '../types'
import { Button, Note, Region } from '../components/Wire'

export function Assets({ state }: { state: AppState }) {
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Assets</h1>
          <Note>File tiers: Local Only cannot be read by VM agents. Company Vault is internal. Shareable can leave the company.</Note>
        </div>
        <Button onClick={() => state.setView('hq')}>Back to Live HQ</Button>
      </div>
      <Region n="01" label="Artifact list · file tiers">
        <table className="table">
          <thead>
            <tr><th>Artifact</th><th>Tier</th><th>Updated</th><th>Status</th></tr>
          </thead>
          <tbody>
            {ASSETS.map((asset) => (
              <tr key={asset.name}>
                <td>{asset.name}</td>
                <td><span className="tier">{asset.tier}</span></td>
                <td>{asset.updated}</td>
                <td>{asset.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Region>
    </>
  )
}
