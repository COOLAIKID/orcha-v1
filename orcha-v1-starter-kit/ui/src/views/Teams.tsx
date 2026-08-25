import { useMemo, useState } from 'react'
import {
  DEPARTMENTS,
  SPECIALISTS,
  allTeams,
  hiredCount,
  hiredIn,
  type DepartmentId,
  type Specialist,
} from '../teams'

/**
 * Consumer view of the company. Departments are the unit — individual specialists
 * only appear when a department is opened, or in dev mode.
 */
export function Teams() {
  const [roster, setRoster] = useState<Specialist[]>(SPECIALISTS)
  const [open, setOpen] = useState<DepartmentId | null>(null)
  const [devMode, setDevMode] = useState(false)

  const proposed = useMemo(() => roster.filter((person) => person.hire === 'proposed'), [roster])

  const decide = (id: string, hire: 'hired' | 'available') => {
    setRoster((current) =>
      current.map((person) =>
        person.id === id
          ? { ...person, hire, state: hire === 'hired' ? 'idle' : 'idle', doing: hire === 'hired' ? 'Getting up to speed' : '' }
          : person,
      ),
    )
  }

  return (
    <div className="tm-wrap">
      <header className="tm-head">
        <div>
          <h1>Your company</h1>
          <p className="tm-sub">
            {hiredCount(roster)} working · {DEPARTMENTS.length} departments · synthetic prototype data
          </p>
        </div>
        <button
          type="button"
          className={`tm-toggle${devMode ? ' on' : ''}`}
          onClick={() => setDevMode((value) => !value)}
          aria-pressed={devMode}
        >
          {devMode ? 'Dev mode' : 'Simple'}
        </button>
      </header>

      {proposed.length > 0 && (
        <section className="tm-proposed" aria-label="Suggested hires">
          {proposed.map((person) => (
            <div className="tm-propose-row" key={person.id}>
              <p>
                <strong>Orcha wants to hire a {person.name}.</strong>{' '}
                <span>{blurbFor(person.department)}</span>
              </p>
              <div className="tm-propose-actions">
                <button type="button" className="tm-yes" onClick={() => decide(person.id, 'hired')}>
                  Hire
                </button>
                <button type="button" className="tm-no" onClick={() => decide(person.id, 'available')}>
                  Not yet
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="tm-grid">
        {allTeams(roster).map((team) => {
          const hired = hiredIn(team.id, roster)
          const isOpen = open === team.id
          return (
            <section key={team.id} className={`tm-card tone-${team.status.tone}`}>
              <button
                type="button"
                className="tm-card-head"
                onClick={() => setOpen(isOpen ? null : team.id)}
                aria-expanded={isOpen}
              >
                <span className="tm-dot" style={{ background: team.tint }} aria-hidden="true" />
                <span className="tm-card-name">{team.name}</span>
                <span className="tm-count">
                  {hired.length > 0 ? `${hired.length} of ${team.members.length}` : '—'}
                </span>
              </button>
              <p className="tm-blurb">{team.blurb}</p>
              <p className={`tm-status tone-${team.status.tone}`}>{team.status.line}</p>

              {(isOpen || devMode) && (
                <ul className="tm-people">
                  {team.members.map((person) => (
                    <li key={person.id} className={`tm-person hire-${person.hire}`}>
                      <span className="tm-person-name">{person.name}</span>
                      <span className="tm-person-state">
                        {person.hire === 'hired' ? person.doing || 'Idle' : person.hire === 'proposed' ? 'Suggested' : 'Not hired'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <p className="tm-foot">
        Departments are what you see. Individual specialists live behind each department, or in dev mode.
      </p>
    </div>
  )
}

function blurbFor(id: DepartmentId) {
  return DEPARTMENTS.find((dept) => dept.id === id)?.blurb ?? ''
}
