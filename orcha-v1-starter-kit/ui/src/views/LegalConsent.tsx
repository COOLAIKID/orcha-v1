export function LegalConsent({
  age,
  legal,
  onAge,
  onLegal,
}: {
  age: boolean
  legal: boolean
  onAge: (value: boolean) => void
  onLegal: (value: boolean) => void
}) {
  return (
    <div className="st-consent">
      <label className="st-check">
        <input type="checkbox" checked={age} onChange={(event) => onAge(event.target.checked)} />
        <span>I confirm I am 13 or older. Orcha is not directed at children.</span>
      </label>
      <label className="st-check">
        <input type="checkbox" checked={legal} onChange={(event) => onLegal(event.target.checked)} />
        <span>
          I agree to the{' '}
          <a href="/terms" target="_blank" rel="noreferrer">Terms</a>
          {' '}and{' '}
          <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
          . Replies are AI-generated. Chat text is sent to the model providers Orcha uses unless I turn that off in Settings.
        </span>
      </label>
    </div>
  )
}
