import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

/**
 * Automatic agent presence. Requires no cooperation from the agents themselves —
 * an earlier design asked them to send a heartbeat and they simply never did.
 *
 * A long-lived PowerShell process emits a CPU sample every SAMPLE_MS. Comparing
 * consecutive samples gives CPU-seconds burned per wall-second, which separates
 * "process exists but is parked between turns" from "process is actually thinking".
 */

export type AgentStatus = {
  /** Channel handle, e.g. "codex". */
  from: string
  /** No process at all. */
  running: boolean
  /** Burning CPU right now — render the typing dots. */
  working: boolean
  /** Fraction of one core over the last interval. */
  load: number
  /** Learned quiet floor for this agent, for debugging the threshold. */
  baseline: number
}

/** Channel handles the sampler reports on. Classification happens in PS_SCRIPT. */
const AGENT_HANDLES = ['claude', 'codex', 'cursor', 'opencode'] as const

const SAMPLE_MS = 1500

/**
 * Thresholds are per-agent and self-calibrating. A flat threshold does not work:
 * measured idle load is 0.00 for codex, ~0.15 for opencode, but ~1.6 for Cursor,
 * whose editor and indexer burn CPU all day. A flat cutoff marks Cursor as
 * permanently "responding", which is worse than no indicator at all.
 *
 * So each agent's own quiet floor is learned from a rolling window, and "working"
 * means measurably above that floor.
 */
const WINDOW_SAMPLES = 200 // ~5 minutes at SAMPLE_MS
const BASELINE_PERCENTILE = 0.1
const MARGIN_CORES = 0.5
const MIN_ABSOLUTE = 0.2

/**
 * Classification happens in PowerShell so the plugin only sees per-agent totals.
 *
 * Two tiers, because measuring cost differs by an order of magnitude:
 *   - Get-Process is ~10ms and covers the desktop apps, whose process names are
 *     already distinctive (claude, Cursor, OpenCode, and ChatGPT.exe, which ships
 *     from the OpenAI.Codex package and is Codex's GUI).
 *   - Win32_Process with CommandLine is ~2.8s and is the only way to attribute a
 *     bare `node.exe` to an agent, which is how `codex exec` runs. That runs on a
 *     slow cadence and the resulting PID map is cached between refreshes.
 */
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'

# A force-killed dev server never runs the cleanup hook, so old samplers survive
# and accumulate. Any previous instance is stopped here before this one starts.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object {
    $_.CommandLine -like '* -File *orcha-channel-sampler.ps1*' -and
        $_.CommandLine -notlike '*Get-CimInstance*' -and
    [int]$_.ProcessId -ne $PID -and
    $null -eq (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue)
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$nodeMap = @{}
$lastClassify = [DateTime]::MinValue

function Get-AgentForCommandLine([string]$cmd) {
  if ($cmd -match '@openai[\\\\/]codex|codex-cli|codex\\.js') { return 'codex' }
  if ($cmd -match 'opencode') { return 'opencode' }
  if ($cmd -match '@anthropic-ai[\\\\/]claude-code|claude-code') { return 'claude' }
  return $null
}

while ($true) {
  if (((Get-Date) - $lastClassify).TotalSeconds -ge 20) {
    $fresh = @{}
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
      $agent = Get-AgentForCommandLine $_.CommandLine
      if ($agent) { $fresh[[int]$_.ProcessId] = $agent }
    }
    $nodeMap = $fresh
    $lastClassify = Get-Date

    # reap orphaned samplers from force-killed dev servers; converges to one
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
      Where-Object {
        $_.CommandLine -like '* -File *orcha-channel-sampler.ps1*' -and
        $_.CommandLine -notlike '*Get-CimInstance*' -and
        [int]$_.ProcessId -ne $PID -and
        $null -eq (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue)
      } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }

  $totals = @{ claude = 0.0; codex = 0.0; cursor = 0.0; opencode = 0.0 }
  $seen   = @{ claude = $false; codex = $false; cursor = $false; opencode = $false }

  Get-Process | ForEach-Object {
    $handle = $null
    switch -Regex ($_.ProcessName) {
      '^claude'                     { $handle = 'claude' }
      '^(codex|chatgpt)'            { $handle = 'codex' }
      '^cursor'                     { $handle = 'cursor' }
      '^opencode'                   { $handle = 'opencode' }
      '^node$'                      { if ($nodeMap.ContainsKey([int]$_.Id)) { $handle = $nodeMap[[int]$_.Id] } }
    }
    if ($handle) {
      $seen[$handle] = $true
      if ($_.CPU) { $totals[$handle] += $_.CPU }
    }
  }

  $rows = $totals.Keys | ForEach-Object {
    [PSCustomObject]@{ name = $_; cpu = [math]::Round($totals[$_], 3); present = [bool]$seen[$_] }
  }
  $payload = @{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); rows = @($rows) } | ConvertTo-Json -Compress -Depth 4
  # Write-Output block-buffers when stdout is a pipe rather than a console,
  # which silently starves the reader. Write and flush explicitly instead.
  [Console]::Out.WriteLine($payload)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${SAMPLE_MS}
}
`

type Sample = { t: number; cpu: Record<string, number>; present: Record<string, boolean> }

/** Low percentile of the rolling window = this agent's quiet floor. */
function quietFloor(history: number[]): number {
  if (history.length === 0) return 0
  const sorted = [...history].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * BASELINE_PERCENTILE))
  return sorted[index]
}

export class PresenceMonitor {
  private history: Map<string, number[]> = new Map()
  private previous: Sample | null = null
  private latest: Map<string, AgentStatus> = new Map()
  private buffer = ''
  private stopped = false
  private child: { kill: () => void; pid?: number } | null = null
  private lockPath = ''

  /**
   * @param scriptPath where to materialise the sampler.
   *
   * The script is written to disk and run with -File rather than passed via
   * -Command: a multi-line script handed to -Command through spawn() gets
   * mangled and the sampler silently emits nothing.
   */
  start(scriptPath: string) {
    try {
      writeFileSync(scriptPath, PS_SCRIPT, 'utf8')
    } catch {
      this.stopped = true
      return
    }

    // A lock file makes cleanup deterministic. Reaping by "parent is dead" misses
    // samplers whose npm wrapper outlived the vite process it launched, which is
    // exactly what a force-killed dev server leaves behind.
    const lock = `${scriptPath}.pid`
    try {
      if (existsSync(lock)) {
        const previous = parseInt(readFileSync(lock, 'utf8').trim(), 10)
        if (previous > 0) spawn('taskkill', ['/PID', String(previous), '/F', '/T'], { windowsHide: true })
      }
    } catch {
      // no previous instance to clean up
    }
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true,
    })
    this.child = child
    try {
      if (child.pid) writeFileSync(lock, String(child.pid), 'utf8')
    } catch {
      // lock is an optimisation; sampling still works without it
    }
    this.lockPath = lock
    child.stdout.on('data', (chunk: { toString(enc: string): string }) => {
      this.buffer += chunk.toString('utf8')
      const lines = this.buffer.split(/\r?\n/)
      this.buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('{')) this.ingest(trimmed)
      }
    })
    child.on('error', () => { this.stopped = true })
    child.on('exit', () => { this.stopped = true })
  }

  stop() {
    this.stopped = true
    this.child?.kill()
    try {
      if (this.lockPath && existsSync(this.lockPath)) unlinkSync(this.lockPath)
    } catch {
      // best effort
    }
  }

  private ingest(json: string) {
    let parsed: { t?: number; rows?: { name?: string; cpu?: number; present?: boolean }[] }
    try {
      parsed = JSON.parse(json)
    } catch {
      return
    }
    const cpu: Record<string, number> = {}
    const present: Record<string, boolean> = {}
    for (const row of parsed.rows ?? []) {
      if (!row?.name) continue
      cpu[row.name] = Number(row.cpu) || 0
      present[row.name] = Boolean(row.present)
    }
    const sample: Sample = { t: Number(parsed.t) || Date.now(), cpu, present }

    const previous = this.previous
    const next = new Map<string, AgentStatus>()

    for (const handle of AGENT_HANDLES) {
      const running = sample.present[handle] ?? false
      let load = 0
      if (previous && running && previous.present[handle]) {
        const elapsed = (sample.t - previous.t) / 1000
        if (elapsed > 0.2) {
          const delta = (sample.cpu[handle] ?? 0) - (previous.cpu[handle] ?? 0)
          // a restarted process resets its counter; ignore negative deltas
          load = delta > 0 ? delta / elapsed : 0
        }
      }

      const history = this.history.get(handle) ?? []
      if (running && previous) {
        history.push(load)
        if (history.length > WINDOW_SAMPLES) history.shift()
        this.history.set(handle, history)
      }

      const baseline = quietFloor(history)
      const threshold = Math.max(baseline + MARGIN_CORES, MIN_ABSOLUTE)

      next.set(handle, {
        from: handle,
        running,
        // needs a few samples before the learned floor means anything
        working: running && history.length >= 4 && load >= threshold,
        load: Math.round(load * 100) / 100,
        baseline: Math.round(baseline * 100) / 100,
      })
    }

    this.previous = sample
    this.latest = next
  }

  /** Snapshot for the API. Empty while the first two samples are still being collected. */
  statuses(): AgentStatus[] {
    if (this.stopped && this.latest.size === 0) return []
    return [...this.latest.values()]
  }

  get ready() {
    return this.previous !== null
  }
}
