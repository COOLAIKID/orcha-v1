import { useEffect, useRef, useState } from 'react'
import { motionReduced } from '../workspace.ts'
import type { WorkAggregates } from './workLog.ts'

const KEYS = ['filesAdded', 'filesChanged', 'linesAdded', 'linesRemoved', 'checksPassed', 'checksFailed', 'tasksComplete', 'tasksTotal', 'agentsCreated', 'agentsWorking', 'artifacts', 'previews', 'modelRequests'] as const

export function useTweenedAggregates(aggregates: WorkAggregates) {
  const [shown, setShown] = useState(aggregates)
  const shownRef = useRef(aggregates)
  shownRef.current = shown
  const sig = KEYS.map((key) => aggregates[key] ?? '').join('|')
  useEffect(() => {
    if (motionReduced()) {
      shownRef.current = aggregates
      setShown(aggregates)
      return
    }
    const from = { ...shownRef.current }
    const started = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 280)
      const next: WorkAggregates = { ...aggregates }
      for (const key of KEYS) {
        const target = aggregates[key]
        if (target == null) {
          next[key] = undefined
          continue
        }
        const origin = from[key] ?? 0
        next[key] = Math.round(origin + (target - origin) * t)
      }
      shownRef.current = next
      setShown(next)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sig])
  return { ...shown, startedAt: aggregates.startedAt }
}
