import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'

type HeaderValue = string | string[] | undefined

export type TunnelRequest = {
  url?: string
  headers?: Record<string, HeaderValue>
}

const ACCESS_COOKIE = '__orcha_access'

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function sameSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function firstHeader(value: HeaderValue) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function pathnameOf(url: string | undefined) {
  try {
    return new URL(url || '/', 'http://orcha.local').pathname
  } catch {
    return '/'
  }
}

export function isProtectedTunnelPath(url: string | undefined) {
  const pathname = pathnameOf(url)
  return pathname === '/v1'
    || pathname.startsWith('/v1/')
    || pathname.startsWith('/api/')
}

export function createTunnelGate(rawSecret: string) {
  const secret = rawSecret.trim()
  const cookieValue = digest(secret)

  return {
    cookieName: ACCESS_COOKIE,
    cookieValue,
    matchesToken(candidate: string | null | undefined) {
      return Boolean(candidate && sameSecret(digest(candidate), cookieValue))
    },
    isAuthorized(request: TunnelRequest) {
      const cookieHeader = firstHeader(request.headers?.cookie)
      const cookie = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${ACCESS_COOKIE}=`))
        ?.slice(ACCESS_COOKIE.length + 1)
      return Boolean(cookie && sameSecret(cookie, cookieValue))
    },
  }
}

export function tokenFromAccessUrl(url: string | undefined) {
  try {
    return new URL(url || '/', 'http://orcha.local').searchParams.get('token')
  } catch {
    return null
  }
}

export function isSecureForwardedRequest(request: TunnelRequest) {
  const proto = firstHeader(request.headers?.['x-forwarded-proto']).split(',')[0].trim().toLowerCase()
  return proto === 'https' || firstHeader(request.headers?.host).endsWith('.trycloudflare.com')
}
