export function openAgentGrid(agentId?: string, inspect = false) {
  window.dispatchEvent(new CustomEvent('orcha:agent-grid', { detail: { open: true, agentId, inspect } }))
}

export function closeAgentGrid() {
  window.dispatchEvent(new CustomEvent('orcha:agent-grid', { detail: { open: false } }))
}
