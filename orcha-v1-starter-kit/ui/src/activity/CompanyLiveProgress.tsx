import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatAggregateStrip, markTone, workLog } from './workLog.ts'
import { useTweenedAggregates } from './useTweenedAggregates.ts'
import { StdoutPeek } from './StdoutPeek.tsx'

export function CompanyLiveProgress({
  intro,
  previewUrl,
  running,
}: {
  intro: string
  previewUrl?: string
  running: boolean
}) {
  const snap = useSyncExternalStore(workLog.subscribe, workLog.getSnapshot, workLog.getSnapshot)
  const [tick, setTick] = useState(Date.now())
  const aggregates = useTweenedAggregates(snap.aggregates)
  useEffect(() => {
    if (!running && snap.previewFreshUntil < Date.now() && snap.beatUntil < Date.now()) return
    const id = window.setInterval(() => setTick(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [running, snap.previewFreshUntil, snap.beatUntil, snap.revision])
  const strip = formatAggregateStrip(aggregates, running, tick)
  const specialistsWorking = snap.roles.some((row) => row.status === 'working') || (snap.aggregates.agentsWorking ?? 0) > 0
  const beating = snap.beatUntil > tick || (running && specialistsWorking)
  const previewFresh = snap.previewReady && snap.previewFreshUntil > tick
  const introLine = intro.split('\n')[0] || intro
  const feed = snap.lines.slice(0, 8)

  return (
    <div className={`chat-live${beating ? ' is-beating' : ''}`}>
      <p className="chat-live-intro">{introLine}</p>
      <p className="chat-live-headline">{snap.headline}</p>
      {snap.roles.length > 0 && (
        <ul className="chat-live-roles">
          {snap.roles.map((row) => (
            <li key={row.role} className={`chat-live-row is-${row.status}`}>
              <span className={`chat-live-mark is-${markTone(row.mark)}${row.status === 'working' ? ' is-live' : ''}`} aria-hidden="true">
                {row.mark}
              </span>
              <span className="chat-live-name">{row.name}</span>
              <span className="chat-live-activity">{row.activity}</span>
            </li>
          ))}
        </ul>
      )}
      {feed.length > 0 && (
        <ol className="chat-live-feed" aria-label="Live company work">
          {feed.map((line) => (
            <li key={line.id} className={`is-${markTone(line.mark)}${line.freshUntil > tick ? ' is-fresh' : ''}${line.checks?.length || line.stdoutPreview ? ' has-checks' : ''}`}>
              <span aria-hidden="true">{line.mark}</span>
              <span>
                {line.text}
                {line.checks?.map((check) => (
                  <small key={check.name} className={`chat-live-check is-${check.pass ? 'mint' : 'coral'}`}>
                    {check.pass ? '✓' : '×'} {check.name}
                  </small>
                ))}
                {line.stdoutPreview && <StdoutPeek text={line.stdoutPreview} />}
              </span>
            </li>
          ))}
        </ol>
      )}
      {running && strip && <p className="chat-live-strip">{strip}</p>}
      {snap.previewReady && (
        <p className={`chat-live-preview-ack${previewFresh ? ' is-fresh' : ''}`}>Preview ready ✓</p>
      )}
      {previewUrl && (
        <div className={`chat-preview-wrap${previewFresh ? ' is-fresh' : ''}`}>
          <iframe
            className="chat-preview"
            title="Company preview"
            src={previewUrl}
            sandbox="allow-scripts allow-same-origin"
          />
          <a className="chat-preview-link" href={previewUrl} target="_blank" rel="noreferrer">Open preview</a>
        </div>
      )}
    </div>
  )
}
