import { gridStore, ingestRuntimeEvent } from './store.ts'
import type { GridSnapshot, RuntimeInbound } from './types.ts'

/**
 * Boundary between ORCHA runtime events and the Agent Grid visualization.
 * The canvas never reads Python models, sockets, or demo timers directly.
 */
export function ingest(event: RuntimeInbound) {
  ingestRuntimeEvent(event)
}

export function ingestMany(events: RuntimeInbound[]) {
  for (const event of events) ingestRuntimeEvent(event)
}

/** Verified runtime events use the same adapter, but never inherit the Demo label. */
export function ingestReal(event: RuntimeInbound) {
  ingestRuntimeEvent(event, false)
}

export function ingestManyReal(events: RuntimeInbound[]) {
  for (const event of events) ingestRuntimeEvent(event, false)
}

export function gridSnapshot(): GridSnapshot {
  return gridStore.getSnapshot()
}

export function subscribeGrid(listen: () => void) {
  return gridStore.subscribe(listen)
}

export function resetGrid() {
  gridStore.reset()
}
