/**
 * Orcha Smart AI Router — Cursor-style infinite fallback on 100% free tiers.
 *
 * Plan economics (owner): $20/mo subscription, ~$10 VM, ~$5 GPT-5.6 for the
 * hardest questions only — unless a free model ranks at or above GPT-5.6
 * (Ox Alpha today). Then that model takes general AND advanced work.
 *
 * Prototype rule: no paid keys required. Frontier (GPT-5.6) runs only when
 * OPENAI_API_KEY is set, the $5 envelope remains, AND no free star model is live.
 */

import {
  bestFreeFrontier,
  isVideoCreate,
  VIDEO_OUTSOURCE_NOTE,
} from './modelCatalog.ts'

export type ChatTurn = { role?: string; content?: string }

export type RoutedChat = {
  userId: string
  tier: 'star' | 'frontier' | 'premium' | 'infinite'
  model: string
  delayedMs: number
  tokensIn: number
  tokensOut: number
  premiumTokensUsed: number
  premiumBudget: number
  frontierUsdUsed: number
  frontierUsdBudget: number
  videoOutsourced: boolean
}

type ProviderName = 'openai' | 'gemini' | 'groq' | 'openrouter'

type UsageRow = {
  userId: string
  month: string
  premiumTokens: number
  frontierUsd: number
}

function premiumBudget() {
  return envInt('PREMIUM_TOKEN_BUDGET', 50_000)
}

function frontierBudget() {
  return envFloat('FRONTIER_USD_BUDGET', 5)
}

function tier2Delay() {
  return envInt('TIER2_DELAY_MS', 5_000)
}

function frontierInPerM() {
  return envFloat('FRONTIER_INPUT_PER_MILLION', 5)
}

function frontierOutPerM() {
  return envFloat('FRONTIER_OUTPUT_PER_MILLION', 15)
}

function geminiModel() {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash'
}

function groqModel() {
  return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
}

function frontierModel() {
  return process.env.OPENAI_FRONTIER_MODEL || 'gpt-5.6'
}

const FULL_SYSTEM = [
  'You are Orcha, an autonomous AI company builder.',
  'Voice: clear, calm, capable, outcome-oriented.',
  'Help the user create, build, or automate a company around one outcome.',
  'Ask for missing audience and deadline. Propose a first useful slice in 7 days.',
  'Keep replies concise. Do not invent live metrics.',
  'Never generate sexual content involving minors, child sexual abuse material, or assistance exploiting children. Refuse clearly.',
  'Do not present yourself as a human. You are an AI.',
].join(' ')

/** Infinite Mode: one sentence. Heavy Orcha briefing is stripped here. */
const INFINITE_SYSTEM =
  'You are Orcha, an AI company builder; answer this latest question clearly and briefly.'

const HARD_QUESTION = [
  'architecture',
  'production-ready',
  'production grade',
  'production-grade',
  'stack trace',
  'race condition',
  'deadlock',
  'multi-file',
  'migrate the',
  'security audit',
  'design a system',
  'distributed',
  'formally prove',
  'refactor this entire',
  'end-to-end',
]

/** In-memory usage ledger. Resets when the process restarts; keyed by user + month. */
const usage = new Map<string, UsageRow>()

function envInt(name: string, fallback: number) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}

function envFloat(name: string, fallback: number) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}

function monthKey(at = new Date()) {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
}

function usageKey(userId: string, month = monthKey()) {
  return `${userId}::${month}`
}

function emptyRow(userId: string, month = monthKey()): UsageRow {
  return { userId, month, premiumTokens: 0, frontierUsd: 0 }
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function normalizeTurns(messages: ChatTurn[]) {
  return messages
    .map((msg) => ({
      role: msg.role === 'orcha' || msg.role === 'assistant' || msg.role === 'model' ? 'assistant' : 'user',
      content: (msg.content || '').trim(),
    }))
    .filter((msg) => msg.content)
}

/**
 * CONTEXT TRUNCATION (Infinite Mode only).
 * Keep the last 2 conversation turns: up to two user/assistant pairs (4 messages),
 * always including the latest user input.
 */
export function slidingWindow(messages: ChatTurn[]) {
  const mapped = normalizeTurns(messages)
  if (mapped.length <= 4) return mapped
  return mapped.slice(-4)
}

export function isChallenging(messages: ChatTurn[]) {
  const last = [...messages].reverse().find((msg) => (msg.role || 'user') !== 'orcha' && msg.role !== 'assistant')
  const text = last?.content || ''
  if (text.length >= 1600) return true
  const fences = text.split('```').length - 1
  if (fences >= 2 && text.length >= 400) return true
  const lower = text.toLowerCase()
  return HARD_QUESTION.some((needle) => lower.includes(needle))
}

export function getUsage(userId: string) {
  const id = userId.trim() || 'anonymous'
  const month = monthKey()
  const row = usage.get(usageKey(id, month)) ?? emptyRow(id, month)
  const budget = premiumBudget()
  const premiumLeft = Math.max(0, budget - row.premiumTokens)
  return {
    userId: id,
    month,
    premiumTokens: row.premiumTokens,
    premiumBudget: budget,
    premiumLeft,
    percent: Math.min(100, Math.round((row.premiumTokens / budget) * 100)),
    frontierUsd: row.frontierUsd,
    frontierUsdBudget: frontierBudget(),
    infinite: row.premiumTokens >= budget,
  }
}

export function listUsage() {
  return [...usage.values()].map((row) => getUsage(row.userId))
}

export function resetUsage(userId: string, premiumTokens = 0, frontierUsd = 0) {
  const id = userId.trim() || 'anonymous'
  const month = monthKey()
  usage.set(usageKey(id, month), { userId: id, month, premiumTokens, frontierUsd })
  return getUsage(id)
}

/**
 * Mock users so both routing paths can be hit without burning a real budget:
 *   user-under-limit → 0%  → Tier 1 Gemini, full context, no delay
 *   user-at-limit    → 100% → Tier 2 Groq/Gemini, truncated context, 5s delay
 */
export function seedMockUsers() {
  resetUsage('user-under-limit', 0, 0)
  resetUsage('user-at-limit', premiumBudget(), 0)
}

seedMockUsers()

function readRow(userId: string) {
  const id = userId.trim() || 'anonymous'
  const month = monthKey()
  const key = usageKey(id, month)
  const current = usage.get(key)
  if (current) return current
  const row = emptyRow(id, month)
  usage.set(key, row)
  return row
}

export type RoutePlan = {
  tier: RoutedChat['tier']
  model: string
  provider: ProviderName
  delayedMs: number
  system: string
  messages: { role: string; content: string }[]
}

/**
 * ROUTING DECISION.
 * 0. Live free model ranked ≥ GPT-5.6 (Ox Alpha) → full context, no delay, all tasks.
 * 1. Else hard questions with remaining $5 frontier envelope → GPT-5.6.
 * 2. Under 50k premium tokens → Gemini 2.5 Flash free, full system + history.
 * 3. At/over 50k → Infinite Mode: 1-sentence system, last 2 turns, 5s throttle, Groq then Gemini.
 */
export function planRoute(userId: string, messages: ChatTurn[], instructions = ''): RoutePlan {
  const row = readRow(userId)
  const extra = instructions.trim()
  const lastUser = [...messages].reverse().find((msg) => (msg.role || 'user') !== 'orcha' && msg.role !== 'assistant')
  const video = isVideoCreate(lastUser?.content || '')
  const videoNote = video ? `\n${VIDEO_OUTSOURCE_NOTE}` : ''
  const star = bestFreeFrontier()

  if (star) {
    return {
      tier: 'star',
      model: star.id,
      provider: star.provider,
      delayedMs: 0,
      system: extra ? `${FULL_SYSTEM}${videoNote}\n${extra}` : `${FULL_SYSTEM}${videoNote}`,
      messages: normalizeTurns(messages),
    }
  }

  const hard = isChallenging(messages)
  const frontierKey = Boolean(process.env.OPENAI_API_KEY)
  const frontierLeft = row.frontierUsd < frontierBudget()

  if (hard && frontierKey && frontierLeft) {
    return {
      tier: 'frontier',
      model: frontierModel(),
      provider: 'openai',
      delayedMs: 0,
      system: extra ? `${FULL_SYSTEM}${videoNote}\n${extra}` : `${FULL_SYSTEM}${videoNote}`,
      messages: normalizeTurns(messages),
    }
  }

  if (row.premiumTokens < premiumBudget()) {
    return {
      tier: 'premium',
      model: geminiModel(),
      provider: 'gemini',
      delayedMs: 0,
      system: extra ? `${FULL_SYSTEM}${videoNote}\n${extra}` : `${FULL_SYSTEM}${videoNote}`,
      messages: normalizeTurns(messages),
    }
  }

  return {
    tier: 'infinite',
    model: process.env.GROQ_API_KEY ? groqModel() : geminiModel(),
    provider: process.env.GROQ_API_KEY ? 'groq' : 'gemini',
    delayedMs: tier2Delay(),
    system: video ? `${INFINITE_SYSTEM} ${VIDEO_OUTSOURCE_NOTE}` : INFINITE_SYSTEM,
    messages: slidingWindow(messages),
  }
}

function frontierCostUsd(tokensIn: number, tokensOut: number) {
  return (tokensIn / 1_000_000) * frontierInPerM() + (tokensOut / 1_000_000) * frontierOutPerM()
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function toOpenAi(plan: RoutePlan) {
  return [{ role: 'system', content: plan.system }, ...plan.messages]
}

function toGemini(plan: RoutePlan) {
  return plan.messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }))
}

async function* iterateSse(body: ReadableStream<Uint8Array> | null) {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload && payload !== '[DONE]') yield payload
    }
  }
}

async function streamOpenRouter(
  plan: RoutePlan,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  const key = process.env.OPENROUTER_API_KEY || ''
  if (!key) throw new Error('missing openrouter key')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://orcha.app',
      'X-Title': 'Orcha',
    },
    body: JSON.stringify({
      model: plan.model,
      temperature: 0.6,
      max_tokens: 700,
      stream: true,
      messages: toOpenAi(plan),
    }),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}`)
  let out = ''
  for await (const payload of iterateSse(res.body)) {
    try {
      const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
      const piece = json.choices?.[0]?.delta?.content
      if (piece) {
        out += piece
        onDelta(piece)
      }
    } catch {
      // keepalives
    }
  }
  return out
}

async function streamOpenAi(
  plan: RoutePlan,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  const key = process.env.OPENAI_API_KEY || ''
  if (!key) throw new Error('missing openai key')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: plan.model,
      temperature: 0.6,
      max_tokens: 700,
      stream: true,
      messages: toOpenAi(plan),
    }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}`)
  let out = ''
  for await (const payload of iterateSse(res.body)) {
    try {
      const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
      const piece = json.choices?.[0]?.delta?.content
      if (piece) {
        out += piece
        onDelta(piece)
      }
    } catch {
      // keepalives
    }
  }
  return out
}

async function streamGroq(
  plan: RoutePlan,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  const key = process.env.GROQ_API_KEY || ''
  if (!key) throw new Error('missing groq key')
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: groqModel(),
      temperature: 0.6,
      max_tokens: plan.tier === 'infinite' ? 256 : 400,
      stream: true,
      messages: toOpenAi(plan),
    }),
  })
  if (!res.ok) throw new Error(`groq ${res.status}`)
  let out = ''
  for await (const payload of iterateSse(res.body)) {
    try {
      const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
      const piece = json.choices?.[0]?.delta?.content
      if (piece) {
        out += piece
        onDelta(piece)
      }
    } catch {
      // keepalives
    }
  }
  return out
}

async function streamGemini(
  plan: RoutePlan,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  const key = process.env.GEMINI_API_KEY || ''
  if (!key) throw new Error('missing gemini key')
  const model = geminiModel()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: plan.system }] },
      contents: toGemini(plan),
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: plan.tier === 'infinite' ? 256 : 400,
      },
    }),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  let out = ''
  for await (const payload of iterateSse(res.body)) {
    try {
      const json = JSON.parse(payload) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const piece = json.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
      if (piece) {
        out += piece
        onDelta(piece)
      }
    } catch {
      // keepalives
    }
  }
  return out
}

async function dispatch(
  plan: RoutePlan,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  if (process.env.SMART_ROUTER_MOCK === '1') {
    const text = `mock:${plan.tier}:${plan.model}`
    onDelta(text)
    return text
  }
  if (plan.provider === 'openrouter') {
    try {
      return await streamOpenRouter(plan, onDelta, signal)
    } catch (err) {
      if (process.env.GROQ_API_KEY) return streamGroq({ ...plan, provider: 'groq', model: groqModel() }, onDelta, signal)
      if (process.env.GEMINI_API_KEY) return streamGemini({ ...plan, provider: 'gemini', model: geminiModel() }, onDelta, signal)
      throw err
    }
  }
  if (plan.provider === 'openai') return streamOpenAi(plan, onDelta, signal)
  if (plan.provider === 'groq') {
    try {
      return await streamGroq(plan, onDelta, signal)
    } catch (err) {
      if (process.env.GEMINI_API_KEY) {
        return streamGemini({ ...plan, provider: 'gemini', model: geminiModel() }, onDelta, signal)
      }
      throw err
    }
  }
  return streamGemini(plan, onDelta, signal)
}

export async function routeChat(opts: {
  userId: string
  messages: ChatTurn[]
  instructions?: string
  onDelta: (text: string) => void
  onWait?: (ms: number) => void
  signal?: AbortSignal
}): Promise<RoutedChat> {
  const userId = opts.userId.trim() || 'anonymous'
  const plan = planRoute(userId, opts.messages, opts.instructions)

  // ARTIFICIAL THROTTLE: Tier 2 only. Tier 1 and frontier dispatch immediately.
  if (plan.delayedMs > 0) {
    opts.onWait?.(plan.delayedMs)
    await sleep(plan.delayedMs, opts.signal)
  }

  const packed = [plan.system, ...plan.messages.map((msg) => msg.content)].join('\n')
  const tokensIn = estimateTokens(packed)
  const output = await dispatch(plan, opts.onDelta, opts.signal)
  const tokensOut = estimateTokens(output)
  const row = readRow(userId)
  const lastUser = [...opts.messages].reverse().find((msg) => (msg.role || 'user') !== 'orcha' && msg.role !== 'assistant')

  if (plan.tier === 'frontier') {
    row.frontierUsd += frontierCostUsd(tokensIn, tokensOut)
  } else if (plan.tier === 'premium') {
    row.premiumTokens += tokensIn + tokensOut
  }

  return {
    userId,
    tier: plan.tier,
    model: plan.model,
    delayedMs: plan.delayedMs,
    tokensIn,
    tokensOut,
    premiumTokensUsed: row.premiumTokens,
    premiumBudget: premiumBudget(),
    frontierUsdUsed: row.frontierUsd,
    frontierUsdBudget: frontierBudget(),
    videoOutsourced: isVideoCreate(lastUser?.content || ''),
  }
}

export const SMART_ROUTER = {
  get premiumTokenBudget() { return premiumBudget() },
  get frontierUsdBudget() { return frontierBudget() },
  get tier2DelayMs() { return tier2Delay() },
  get geminiModel() { return geminiModel() },
  get groqModel() { return groqModel() },
  get frontierModel() { return frontierModel() },
  get starModel() { return bestFreeFrontier()?.id || null },
  priceUsd: 20,
  vmUsd: 10,
  mockUsers: ['user-under-limit', 'user-at-limit'] as const,
}
