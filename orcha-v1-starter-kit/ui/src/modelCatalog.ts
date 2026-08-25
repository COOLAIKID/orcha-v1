/**
 * Live model catalog. Poll OpenRouter so a new free high-reasoning model
 * (Ox Alpha today) can take both everyday chat and hard questions without
 * spending the $5 GPT-5.6 envelope.
 *
 * Ranking rule: a free model at or above GPT-5.6 reasoning wins for all work.
 * Video *input* may be native. Video *creation* is always outsourced; the
 * reasoning model writes the brief.
 */

export type Modality = 'text' | 'image' | 'video' | 'audio' | 'file'
export type CatalogProvider = 'openrouter' | 'gemini' | 'groq' | 'openai'

export type CatalogModel = {
  id: string
  name: string
  provider: CatalogProvider
  free: boolean
  reasoningRank: number
  contextLength: number
  input: Modality[]
  output: Modality[]
  live: boolean
  updatedAt: number
}

/** Paid frontier floor. A free model at this rank or higher replaces GPT-5.6. */
export const PAID_FRONTIER_RANK = 94

const KNOWN_RANK: Record<string, number> = {
  'stealth/ox-alpha': 96,
  'gpt-5.6': 94,
  'openai/gpt-5.6': 94,
  'z-ai/glm-5.2:free': 88,
  'llama-3.3-70b-versatile': 72,
  'gemini-2.5-flash': 70,
}

type OpenRouterRow = {
  id?: string
  name?: string
  description?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  reasoning?: { mandatory?: boolean }
}

const catalog = new Map<string, CatalogModel>()
let refreshedAt = 0

function now() {
  return Date.now()
}

function seed(model: Omit<CatalogModel, 'updatedAt'>) {
  catalog.set(model.id, { ...model, updatedAt: now() })
}

seed({
  id: 'stealth/ox-alpha',
  name: 'Ox Alpha',
  provider: 'openrouter',
  free: true,
  reasoningRank: 96,
  contextLength: 1_048_576,
  input: ['text', 'image', 'video'],
  output: ['text'],
  live: true,
})
seed({
  id: 'gemini-2.5-flash',
  name: 'Gemini 2.5 Flash',
  provider: 'gemini',
  free: true,
  reasoningRank: 70,
  contextLength: 1_000_000,
  input: ['text', 'image'],
  output: ['text'],
  live: true,
})
seed({
  id: 'llama-3.3-70b-versatile',
  name: 'Llama 3.3 70B',
  provider: 'groq',
  free: true,
  reasoningRank: 72,
  contextLength: 131_072,
  input: ['text'],
  output: ['text'],
  live: true,
})
seed({
  id: 'gpt-5.6',
  name: 'GPT-5.6',
  provider: 'openai',
  free: false,
  reasoningRank: 94,
  contextLength: 256_000,
  input: ['text'],
  output: ['text'],
  live: true,
})

function asModality(value: string): Modality | null {
  if (value === 'text' || value === 'image' || value === 'video' || value === 'audio' || value === 'file') return value
  return null
}

function scoreOpenRouter(row: OpenRouterRow, free: boolean) {
  const id = row.id || ''
  if (KNOWN_RANK[id] != null) return KNOWN_RANK[id]
  if (free && row.reasoning?.mandatory && (row.context_length || 0) >= 256_000) return 96
  if (free && /reasoning|agentic|coding/i.test(`${row.name || ''} ${row.description || ''}`)) return 85
  if (free) return 55
  return 40
}

export function listCatalog() {
  return [...catalog.values()].sort((a, b) => b.reasoningRank - a.reasoningRank || b.contextLength - a.contextLength)
}

export function catalogStatus() {
  const star = bestFreeFrontier()
  return {
    refreshedAt,
    star: star ? { id: star.id, name: star.name, rank: star.reasoningRank, free: star.free } : null,
    models: listCatalog(),
    video: {
      nativeOutput: listCatalog().some((model) => model.live && model.output.includes('video')),
      outsourceCreation: true,
      planner: star?.id || 'stealth/ox-alpha',
    },
  }
}

function hasKey(model: CatalogModel) {
  if (process.env.SMART_ROUTER_MOCK === '1') {
    if (model.provider === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY)
    if (model.provider === 'openai') return Boolean(process.env.OPENAI_API_KEY)
    if (model.provider === 'groq') return Boolean(process.env.GROQ_API_KEY)
    if (model.provider === 'gemini') return Boolean(process.env.GEMINI_API_KEY)
    return false
  }
  if (model.provider === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY)
  if (model.provider === 'openai') return Boolean(process.env.OPENAI_API_KEY)
  if (model.provider === 'groq') return Boolean(process.env.GROQ_API_KEY)
  if (model.provider === 'gemini') return Boolean(process.env.GEMINI_API_KEY)
  return false
}

/**
 * Free model at or above GPT-5.6 reasoning. Used for general and advanced
 * tasks so the $5 paid envelope is not spent while a better free model is live.
 */
export function bestFreeFrontier() {
  return listCatalog().find((model) => (
    model.live && model.free && model.reasoningRank >= PAID_FRONTIER_RANK && hasKey(model) && model.output.includes('text')
  )) ?? null
}

export function markCatalog(id: string, patch: Partial<CatalogModel>) {
  const current = catalog.get(id)
  if (!current) return
  catalog.set(id, { ...current, ...patch, updatedAt: now() })
}

export async function refreshCatalog(fetcher: typeof fetch = fetch) {
  try {
    const res = await fetcher('https://openrouter.ai/api/v1/models')
    if (!res.ok) throw new Error(`openrouter models ${res.status}`)
    const body = await res.json() as { data?: OpenRouterRow[] }
    const rows = body.data ?? []
    const seen = new Set<string>()
    for (const row of rows) {
      const id = row.id || ''
      if (!id) continue
      const prompt = Number(row.pricing?.prompt)
      const completion = Number(row.pricing?.completion)
      const free = prompt === 0 && completion === 0
      const input = (row.architecture?.input_modalities || []).map(asModality).filter((item): item is Modality => Boolean(item))
      const output = (row.architecture?.output_modalities || []).map(asModality).filter((item): item is Modality => Boolean(item))
      seen.add(id)
      seed({
        id,
        name: row.name || id,
        provider: 'openrouter',
        free,
        reasoningRank: scoreOpenRouter(row, free),
        contextLength: row.context_length || 0,
        input: input.length ? input : ['text'],
        output: output.length ? output : ['text'],
        live: true,
      })
    }
    for (const model of catalog.values()) {
      if (model.provider === 'openrouter' && !seen.has(model.id)) {
        markCatalog(model.id, { live: false, free: false })
      }
    }
    refreshedAt = now()
  } catch {
    refreshedAt = now()
  }
  return catalogStatus()
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

export function startCatalogRefresh(ms = 15 * 60 * 1000) {
  void refreshCatalog()
  if (refreshTimer) return
  refreshTimer = setInterval(() => { void refreshCatalog() }, ms)
  const handle = refreshTimer as unknown as { unref?: () => void }
  handle.unref?.()
}

export const VIDEO_CREATE = /\b(make|create|generate|render|produce|shoot)\b.{0,40}\bvideo\b|\bvideo\b.{0,20}\b(ad|ads|clip|commercial|promo)\b/i

export function isVideoCreate(text: string) {
  return VIDEO_CREATE.test(text)
}

export const VIDEO_OUTSOURCE_NOTE = [
  'You cannot emit video bytes. If the user wants a video created, write a precise production brief',
  '(length, shot list, voice, captions, aspect ratio) and say the render step is outsourced.',
  'Do not claim a video file was generated.',
].join(' ')
