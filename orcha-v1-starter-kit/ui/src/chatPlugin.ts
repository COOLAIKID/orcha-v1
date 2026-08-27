import { Buffer } from 'node:buffer'
import { loadEnv, type Plugin } from 'vite'
import { offlineReply } from './chatReply.ts'
import { routeChat, seedMockUsers, type ChatTurn } from './smartAiRouter.ts'
import { catalogStatus, startCatalogRefresh } from './modelCatalog.ts'
import { createTunnelGate, isProtectedTunnelPath, isSecureForwardedRequest, tokenFromAccessUrl, type TunnelRequest } from './tunnelGate.ts'

function applyEnv() {
  const env = loadEnv('development', '.', '')
  for (const key of [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'GROQ_API_KEY',
    'GROQ_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_FRONTIER_MODEL',
    'PREMIUM_TOKEN_BUDGET',
    'FRONTIER_USD_BUDGET',
    'TIER2_DELAY_MS',
    'SMART_ROUTER_MOCK',
    'OPENROUTER_API_KEY',
    'ORCHA_TUNNEL_TOKEN',
  ]) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }
}

type StreamReq = {
  method?: string
  on: (event: 'data' | 'end' | 'aborted', listener: (chunk?: Uint8Array) => void) => void
  removeListener?: (event: 'data' | 'end' | 'aborted', listener: (chunk?: Uint8Array) => void) => void
}

type StreamRes = {
  writeHead: (code: number, headers: Record<string, string>) => void
  write: (chunk: string) => void
  end: () => void
}

function push(res: StreamRes, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function streamFallback(text: string, res: StreamRes) {
  const parts = text.split(/(\s+)/).filter(Boolean)
  for (const part of parts) {
    push(res, { delta: part })
    await new Promise((resolve) => setTimeout(resolve, 14))
  }
}

export function chatPlugin(): Plugin {
  return {
    name: 'orcha-chat',
    configureServer(server) {
      applyEnv()
      seedMockUsers()
      startCatalogRefresh()
      const gemini = Boolean(process.env.GEMINI_API_KEY)
      const groq = Boolean(process.env.GROQ_API_KEY)
      const frontier = Boolean(process.env.OPENAI_API_KEY)
      const openrouter = Boolean(process.env.OPENROUTER_API_KEY)
      const tunnelSecret = (process.env.ORCHA_TUNNEL_TOKEN || '').trim()
      const tunnel = tunnelSecret ? createTunnelGate(tunnelSecret) : null
      console.log(`[orcha-chat] smart-router gemini ${gemini ? 'on' : 'off'} · groq ${groq ? 'on' : 'off'} · openrouter ${openrouter ? 'on' : 'off'} · frontier ${frontier ? 'on' : 'off'} · pilot-gate ${tunnel ? 'on' : 'off'}`)
      if (tunnel) {
        server.middlewares.use('/__orcha_access', (req, res, next) => {
          const accessReq = req as unknown as TunnelRequest & { method?: string }
          const accessRes = res as unknown as {
            writeHead: (code: number, headers?: Record<string, string>) => void
            end: (body?: string) => void
          }
          if (accessReq.method !== 'GET') {
            next()
            return
          }
          if (!tunnel.matchesToken(tokenFromAccessUrl(accessReq.url))) {
            accessRes.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
            accessRes.end('Orcha pilot access was not authorized.')
            return
          }
          const secure = isSecureForwardedRequest(accessReq)
          const cookie = `${tunnel.cookieName}=${tunnel.cookieValue}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure ? '; Secure' : ''}`
          accessRes.writeHead(302, {
            'Cache-Control': 'no-store',
            Location: '/',
            'Set-Cookie': cookie,
          })
          accessRes.end()
        })
        server.middlewares.use((req, res, next) => {
          const accessReq = req as unknown as TunnelRequest
          if (!isProtectedTunnelPath(accessReq.url) || tunnel.isAuthorized(accessReq)) {
            next()
            return
          }
          const accessRes = res as unknown as {
            writeHead: (code: number, headers?: Record<string, string>) => void
            end: (body?: string) => void
          }
          accessRes.writeHead(401, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'WWW-Authenticate': 'Bearer realm="orcha-pilot"',
          })
          accessRes.end(JSON.stringify({ error: 'pilot_access_required', accessPath: '/__orcha_access' }))
        })
      }
      server.middlewares.use('/api/models', (req, res, next) => {
        const modelsReq = req as unknown as { method?: string }
        const modelsRes = res as unknown as { setHeader: (name: string, value: string) => void; end: (body: string) => void }
        if (modelsReq.method !== 'GET') {
          next()
          return
        }
        modelsRes.setHeader('Content-Type', 'application/json')
        modelsRes.end(JSON.stringify(catalogStatus()))
      })
      server.middlewares.use('/api/usage', (req, res, next) => {
        const usageReq = req as unknown as { method?: string; url?: string }
        const usageRes = res as unknown as { setHeader: (name: string, value: string) => void; end: (body: string) => void }
        if (usageReq.method !== 'GET') {
          next()
          return
        }
        void import('./smartAiRouter.ts').then(({ getUsage, listUsage, SMART_ROUTER }) => {
          const url = usageReq.url || '/'
          const match = url.match(/^\/([^/?#]+)/)
          const payload = match
            ? getUsage(decodeURIComponent(match[1]))
            : { users: listUsage(), mock: SMART_ROUTER.mockUsers, config: SMART_ROUTER }
          usageRes.setHeader('Content-Type', 'application/json')
          usageRes.end(JSON.stringify(payload))
        })
      })
      server.middlewares.use('/api/chat', (req, res, next) => {
        const streamReq = req as unknown as StreamReq
        const streamRes = res as unknown as StreamRes
        if (streamReq.method !== 'POST') {
          next()
          return
        }
        const chunks: Uint8Array[] = []
        streamReq.on('data', (chunk) => {
          if (chunk) chunks.push(chunk)
        })
        streamReq.on('end', () => {
          let messages: ChatTurn[] = []
          let extra = ''
          let userId = 'user-under-limit'
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
              messages?: ChatTurn[]
              instructions?: string
              userId?: string
            }
            messages = body.messages ?? []
            extra = typeof body.instructions === 'string' ? body.instructions : ''
            if (typeof body.userId === 'string' && body.userId.trim()) userId = body.userId.trim()
          } catch {
            messages = []
          }
          const last = messages[messages.length - 1]?.content ?? ''
          streamRes.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })

          const FIRST_TOKEN_MS = 25000
          let sent = false
          let clientGone = false

          const describe = (err: unknown) =>
            err instanceof Error && err.name === 'AbortError'
              ? 'router timeout'
              : err instanceof Error ? err.message : 'router failed'

          const attempt = async () => {
            const ac = new AbortController()
            const onAborted = () => { clientGone = true; ac.abort() }
            streamReq.on('aborted', onAborted)
            let got = false
            const firstTimer = setTimeout(() => ac.abort(), FIRST_TOKEN_MS)
            try {
              await routeChat({
                userId,
                messages,
                instructions: extra,
                signal: ac.signal,
                onWait: () => streamRes.write(': throttle\n\n'),
                onDelta: (delta) => {
                  if (!got) clearTimeout(firstTimer)
                  got = true
                  sent = true
                  push(streamRes, { delta })
                },
              })
            } finally {
              clearTimeout(firstTimer)
              if (clientGone) return
              streamReq.removeListener?.('aborted', onAborted)
            }
          }

          void (async () => {
            try {
              await attempt()
            } catch (first) {
              console.error(`[orcha-chat] ${describe(first)}${clientGone ? ' (client gone)' : ''}`)
              if (sent || clientGone) return
              try {
                await attempt()
                return
              } catch (second) {
                console.error(`[orcha-chat] retry failed: ${describe(second)}`)
              }
              await streamFallback(offlineReply(last), streamRes)
            }
          })().finally(() => {
            push(streamRes, { done: true })
            streamRes.end()
          })
        })
      })
    },
  }
}
