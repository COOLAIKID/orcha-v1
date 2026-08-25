/**
 * Production Express entry for the Smart AI Router.
 * Run on the $10 VM: `npm start` from this folder (or `node --experimental-strip-types smart-ai-router.ts`).
 *
 * Uses Express when it is installed. If `npm install` is skipped, boots on node:http
 * so the prototype still has zero extra operational cost.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  getUsage,
  listUsage,
  resetUsage,
  routeChat,
  seedMockUsers,
  SMART_ROUTER,
  type ChatTurn,
} from '../ui/src/smartAiRouter.ts'
import { catalogStatus, startCatalogRefresh } from '../ui/src/modelCatalog.ts'

const PORT = Number(process.env.PORT || process.env.SMART_ROUTER_PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'

seedMockUsers()
startCatalogRefresh()

type ChatBody = {
  userId?: string
  messages?: ChatTurn[]
  instructions?: string
}

const SSE = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Access-Control-Allow-Origin': '*',
}

function push(res: { write: (chunk: string) => void }, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8') || '{}'
  return JSON.parse(raw) as ChatBody
}

async function handleChat(body: ChatBody, res: { write: (chunk: string) => void; end: () => void }, signal?: AbortSignal) {
  const userId = body.userId || 'user-under-limit'
  const messages = body.messages || []
  try {
    const routed = await routeChat({
      userId,
      messages,
      instructions: body.instructions || '',
      signal,
      onWait: () => {
        res.write(': throttle\n\n')
      },
      onDelta: (delta) => push(res, { delta }),
    })
    push(res, { done: true, route: routed })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    if (!aborted) push(res, { error: err instanceof Error ? err.message : 'router failed' })
    push(res, { done: true })
  }
  res.end()
}

function sendJson(res: ServerResponse, code: number, payload: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(payload))
}

async function withExpress() {
  const express = (await import('express')).default
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use((_, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    next()
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'orcha-smart-ai-router', planUsd: SMART_ROUTER.priceUsd, vmUsd: SMART_ROUTER.vmUsd })
  })

  app.get('/api/models', (_req, res) => {
    res.json(catalogStatus())
  })

  app.get('/api/usage', (_req, res) => {
    res.json({ users: listUsage(), mock: SMART_ROUTER.mockUsers, config: SMART_ROUTER })
  })

  app.get('/api/usage/:userId', (req, res) => {
    res.json(getUsage(String(req.params.userId)))
  })

  app.post('/api/usage/:userId/reset', (req, res) => {
    const tokens = Number((req.body as { premiumTokens?: number })?.premiumTokens)
    res.json(resetUsage(String(req.params.userId), Number.isFinite(tokens) ? tokens : 0))
  })

  app.post('/api/chat', (req, res) => {
    res.writeHead(200, SSE)
    const ac = new AbortController()
    req.on('aborted', () => ac.abort())
    void handleChat(req.body as ChatBody, res, ac.signal)
  })

  return app
}

function withHttp() {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      })
      res.end()
      return
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'orcha-smart-ai-router', planUsd: SMART_ROUTER.priceUsd, vmUsd: SMART_ROUTER.vmUsd })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/models') {
      sendJson(res, 200, catalogStatus())
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      sendJson(res, 200, { users: listUsage(), mock: SMART_ROUTER.mockUsers, config: SMART_ROUTER })
      return
    }
    const usageOne = url.pathname.match(/^\/api\/usage\/([^/]+)$/)
    if (req.method === 'GET' && usageOne) {
      sendJson(res, 200, getUsage(decodeURIComponent(usageOne[1])))
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/api/chat') {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    res.writeHead(200, SSE)
    const ac = new AbortController()
    req.on('aborted', () => ac.abort())
    void readJson(req)
      .then((body) => handleChat(body, res, ac.signal))
      .catch((err) => {
        push(res, { error: err instanceof Error ? err.message : 'bad json' })
        push(res, { done: true })
        res.end()
      })
  })
}

async function main() {
  try {
    const app = await withExpress()
    app.listen(PORT, HOST, () => {
      console.log(`[orcha-router] express http://${HOST}:${PORT} · premium ${SMART_ROUTER.premiumTokenBudget} tok · mock ${SMART_ROUTER.mockUsers.join(', ')}`)
    })
  } catch {
    withHttp().listen(PORT, HOST, () => {
      console.log(`[orcha-router] http://${HOST}:${PORT} (express not installed, using node:http) · mock ${SMART_ROUTER.mockUsers.join(', ')}`)
    })
  }
}

void main()
