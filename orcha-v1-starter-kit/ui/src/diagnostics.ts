const errors: string[] = []
let started = false

function sanitize(value: unknown) {
  return String(value ?? '')
    .replace(/\b(?:api[_-]?key|token|secret|password|authorization|bearer)\b\s*(?:[:=]|is)\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
    .replace(/\b(?:sk-or-v1-|sk-|gsk_|AIza)[A-Za-z0-9_-]{16,}\b/g, '[redacted]')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s,;]+/g, '[redacted]')
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|]+/g, '[path]')
    .replace(/(?<![A-Za-z0-9:])\/(?:Users|home|var|tmp|opt|mnt|workspace|private|etc|usr|root)(?:[\\/][^\s"'<>|]+)+/g, '[path]')
    .replace(/https?:\/\/[^\s]+/g, '[url]')
    .slice(0, 500)
}

function record(value: unknown) {
  const entry = sanitize(value)
  if (!entry) return
  errors.unshift(entry)
  errors.splice(5)
}

export function startDiagnosticCapture() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('error', (event) => record(event.message))
  window.addEventListener('unhandledrejection', (event) => record(event.reason instanceof Error ? event.reason.message : event.reason))
}

export function feedbackDiagnostics() {
  return { route: window.location.pathname, client_errors: [...errors] }
}
