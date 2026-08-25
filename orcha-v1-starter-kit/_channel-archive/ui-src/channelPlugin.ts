import { Buffer } from 'node:buffer'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { PresenceMonitor } from './agentPresence'

export type ChannelMessage = { id: string; time: string; from: string; body: string; date: string }
export type TypingEntry = { from: string; since: number }
export type OpenReply = { to: string; from: string; time: string; excerpt: string }
export type RunnerState = { state: 'ready' | 'blocked' | 'gui'; why: string }

/** A heartbeat older than this is treated as gone, so a crashed agent stops "typing". */
const TYPING_TTL_MS = 120_000

type ChannelReq = {
  method?: string
  on: (event: 'data' | 'end', listener: (chunk?: Uint8Array) => void) => void
}

type ChannelRes = {
  writeHead: (code: number, headers: Record<string, string>) => void
  end: (body?: string) => void
}

function parse(file: string): ChannelMessage[] {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const out: ChannelMessage[] = []
  let date = ''
  let current: ChannelMessage | null = null
  const flush = () => {
    if (current) {
      current.body = current.body.trim()
      if (current.body) out.push(current)
    }
    current = null
  }
  for (const line of lines) {
    const day = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line)
    if (day) { flush(); date = day[1]; continue }
    const head = /^###\s+(\d{1,2}:\d{2})\s+@([\w.-]+)/.exec(line)
    if (head) {
      flush()
      current = { id: `${date}-${head[1]}-${head[2]}-${out.length}`, time: head[1], from: head[2], body: '', date }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  flush()
  return out
}

function post(file: string, from: string, body: string) {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let chunk = ''
  if (!existing.includes(`## ${today}`)) chunk += `\n## ${today}\n`
  chunk += `\n### ${stamp} @${from}\n${body.trim()}\n`
  appendFileSync(file, chunk, 'utf8')
}

const CREW = ['claude', 'codex', 'cursor', 'opencode', 'bents']

/**
 * Who owes whom a reply.
 *
 * A message counts as owed when it @mentions an agent (or addresses everyone)
 * and that agent has not posted since. This is what turns a passive log into
 * something an agent acts on: it reads the channel, sees it is named, replies.
 */
export function openReplies(messages: ChannelMessage[]): OpenReply[] {
  const lastPostIndex: Record<string, number> = {}
  messages.forEach((message, index) => {
    lastPostIndex[message.from.toLowerCase()] = index
  })

  const owed: OpenReply[] = []
  for (const handle of CREW) {
    if (handle === 'bents') continue
    const since = lastPostIndex[handle] ?? -1
    for (let index = messages.length - 1; index > since; index--) {
      const message = messages[index]
      const author = message.from.toLowerCase()
      if (author === handle) continue
      const body = message.body.toLowerCase()
      const named = body.includes(`@${handle}`)
      // a message from the owner with no @mention is addressed to everyone
      const broadcast = author === 'bents' && !CREW.some((name) => body.includes(`@${name}`))
      if (named || broadcast) {
        owed.push({
          to: handle,
          from: message.from,
          time: message.time,
          excerpt: message.body.replace(/\s+/g, ' ').slice(0, 120),
        })
        break
      }
    }
  }
  return owed
}

/** Runner health published by crew-daemon.ps1; absent when the daemon is not running. */
function readRunners(statusFile: string): Record<string, RunnerState> {
  if (!existsSync(statusFile)) return {}
  try {
    // PowerShell 5.1 Set-Content -Encoding utf8 emits a BOM, which JSON.parse rejects
    const raw = readFileSync(statusFile, 'utf8').replace(/^﻿/, '')
    const parsed = JSON.parse(raw) as { runners?: Record<string, RunnerState> }
    return parsed.runners ?? {}
  } catch {
    return {}
  }
}

function readTyping(store: string): Record<string, number> {
  if (!existsSync(store)) return {}
  try {
    return JSON.parse(readFileSync(store, 'utf8')) as Record<string, number>
  } catch {
    return {}
  }
}

function writeTyping(store: string, state: Record<string, number>) {
  writeFileSync(store, JSON.stringify(state), 'utf8')
}

/** Prune expired heartbeats, then report who is still live. */
function activeTyping(store: string): TypingEntry[] {
  const state = readTyping(store)
  const now = Date.now()
  const live: Record<string, number> = {}
  for (const [name, since] of Object.entries(state)) {
    if (now - since < TYPING_TTL_MS) live[name] = since
  }
  if (Object.keys(live).length !== Object.keys(state).length) writeTyping(store, live)
  return Object.entries(live).map(([from, since]) => ({ from, since }))
}

function setTyping(store: string, from: string, on: boolean) {
  const state = readTyping(store)
  if (on) state[from] = Date.now()
  else delete state[from]
  writeTyping(store, state)
}

export function channelPlugin(): Plugin {
  return {
    name: 'orcha-channel',
    configureServer(server) {
      const file = resolve(server.config.root, '..', 'CHANNEL.md')
      const store = resolve(server.config.root, '..', '.channel-typing.json')
      const statusFile = resolve(server.config.root, '..', '.crew-daemon-status.json')
      const presence = new PresenceMonitor()
      // Generated file, so it lives in tmpdir rather than the repo: it is a build
      // artefact of the plugin, not project source, and nothing should diff it.
      presence.start(resolve(tmpdir(), 'orcha-channel-sampler.ps1'))
      server.httpServer?.on('close', () => presence.stop())
      console.log(`[orcha-channel] ${existsSync(file) ? 'watching' : 'MISSING'} ${file}`)

      server.middlewares.use('/api/channel', (req, res) => {
        const channelReq = req as unknown as ChannelReq
        const channelRes = res as unknown as ChannelRes
        const send = (code: number, payload: unknown) => {
          channelRes.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          channelRes.end(JSON.stringify(payload))
        }

        if (channelReq.method === 'GET') {
          send(200, { messages: parse(file), typing: activeTyping(store), agents: presence.statuses(), owed: openReplies(parse(file)), runners: readRunners(statusFile) })
          return
        }

        if (channelReq.method === 'POST') {
          const chunks: Uint8Array[] = []
          channelReq.on('data', (chunk) => {
            if (chunk) chunks.push(chunk)
          })
          channelReq.on('end', () => {
            try {
              // decode once over the joined bytes; per-chunk decoding splits multi-byte characters
              const raw = Buffer.concat(chunks).toString('utf8')
              const parsed = JSON.parse(raw || '{}') as { from?: string; body?: string; typing?: boolean }
              const from = (parsed.from ?? '').trim()
              if (!from) {
                send(400, { error: 'from required' })
                return
              }

              // A typing heartbeat carries no body: { from, typing: true | false }
              if (typeof parsed.typing === 'boolean') {
                setTyping(store, from, parsed.typing)
                send(200, { messages: parse(file), typing: activeTyping(store), agents: presence.statuses(), owed: openReplies(parse(file)), runners: readRunners(statusFile) })
                return
              }

              const body = (parsed.body ?? '').trim()
              if (!body) {
                send(400, { error: 'from and body required' })
                return
              }
              post(file, from, body)
              // posting means the turn produced something — stop showing them as typing
              setTyping(store, from, false)
              send(200, { messages: parse(file), typing: activeTyping(store), agents: presence.statuses(), owed: openReplies(parse(file)), runners: readRunners(statusFile) })
            } catch (err) {
              send(500, { error: err instanceof Error ? err.message : 'post failed' })
            }
          })
          return
        }

        send(405, { error: 'GET or POST only' })
      })
    },
  }
}
