import { LEGAL_DOCS, LEGAL_UPDATED, type LegalId } from '../legal'

export function LegalDoc({
  id,
  onBack,
}: {
  id: LegalId
  onBack?: () => void
}) {
  const doc = LEGAL_DOCS[id]
  return (
    <article className="st-doc">
      {onBack ? (
        <button type="button" className="st-doc-back" onClick={onBack}>All legal</button>
      ) : (
        <a className="st-doc-back" href="/">Back to Orcha</a>
      )}
      <h1>{doc.title}</h1>
      <p className="st-lead">Updated {LEGAL_UPDATED}.</p>
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <p>{section.body}</p>
        </section>
      ))}
    </article>
  )
}

export function LegalPage({ id }: { id: LegalId }) {
  return (
    <div className="st-page st-legal-page">
      <LegalDoc id={id} />
    </div>
  )
}
