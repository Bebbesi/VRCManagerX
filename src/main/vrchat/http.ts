import { ApiError, NetworkError, RateLimitedError, UnauthorizedError, VrcError } from './errors'
import { isRecord } from './types'

export const API_ORIGIN = 'https://api.vrchat.cloud'
export const API_BASE = `${API_ORIGIN}/api/1`

/** Minimum spacing between two API calls. VRChat asks clients to meter their requests. */
const MIN_INTERVAL_MS = 1000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60_000

export interface SessionCookies {
  auth?: string
  twoFactorAuth?: string
}

export interface HttpEvents {
  /** A request returned 401 while using the stored session. */
  onUnauthorized(): void
  /** VRChat rate limited us; no calls will be made until `until`. */
  onRateLimited(until: number): void
  /** Reachability changed (network errors vs. any HTTP response). */
  onReachability(reachable: boolean): void
  /** The server issued new cookies (login, 2FA verification). */
  onCookiesChanged(cookies: SessionCookies): void
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** Pre-encoded Basic credentials, only used for the login call. */
  basicAuth?: string
  /** Do not treat 401 as "session expired" (login / 2FA / session probing). */
  expectUnauthorized?: boolean
  /** A 429 here is a per-resource cooldown and must not pause every other call. */
  local429?: boolean
  /** Number of automatic retries for transient 5xx / network failures (GET only). */
  retries?: number
}

/**
 * Minimal VRChat REST client.
 * - Every call goes through a single metered queue (MIN_INTERVAL_MS apart).
 * - A 429 pauses the whole queue with exponential backoff (or Retry-After).
 * - Cookies are kept in memory here and never exposed to the renderer.
 */
export class VrcHttpClient {
  private cookies: SessionCookies = {}
  private chain: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0
  private blockedUntil = 0
  private consecutive429 = 0

  constructor(
    private readonly userAgent: () => string,
    private readonly events: HttpEvents
  ) {}

  getCookies(): SessionCookies {
    return { ...this.cookies }
  }

  setCookies(cookies: SessionCookies): void {
    this.cookies = { ...cookies }
  }

  clearAuthCookie(): void {
    delete this.cookies.auth
  }

  clearAll(): void {
    this.cookies = {}
  }

  get rateLimitedUntil(): number {
    return this.blockedUntil > Date.now() ? this.blockedUntil : 0
  }

  get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, { retries: 2, ...opts })
  }

  post<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body })
  }

  put<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...opts, body })
  }

  request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const run = async (): Promise<T> => {
      let attempt = 0
      for (;;) {
        await this.waitForSlot()
        try {
          return await this.execute<T>(method, path, opts)
        } catch (err) {
          const retriable =
            method === 'GET' &&
            attempt < (opts.retries ?? 0) &&
            (err instanceof NetworkError || (err instanceof ApiError && err.status >= 500))
          if (!retriable) throw err
          attempt++
          await delay(attempt * 2500)
        }
      }
    }
    // Serialize calls so metering is global; a failure must not break the chain.
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    return result
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now()
    if (this.blockedUntil > now) throw new RateLimitedError(this.blockedUntil - now)
    const wait = this.lastRequestAt + MIN_INTERVAL_MS - now
    if (wait > 0) await delay(wait)
    this.lastRequestAt = Date.now()
  }

  private async execute<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
    const url = new URL(`${API_BASE}${path}`)
    if (url.origin !== API_ORIGIN) throw new VrcError('Refusing to call a non-VRChat host.', 'api')
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    const headers: Record<string, string> = {
      'User-Agent': this.userAgent(),
      Accept: 'application/json'
    }
    const cookie = this.cookieHeader()
    if (cookie) headers.Cookie = cookie
    if (opts.basicAuth) headers.Authorization = `Basic ${opts.basicAuth}`
    let body: string | undefined
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (err) {
      this.events.onReachability(false)
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new NetworkError(timedOut ? 'VRChat did not respond in time.' : undefined)
    }
    this.events.onReachability(true)
    this.captureCookies(response)

    if (response.ok) {
      this.consecutive429 = 0
      const text = await response.text()
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new VrcError('VRChat returned an unexpected response.', 'invalid_response')
      }
    }

    const message = await readErrorMessage(response)
    if (response.status === 401) {
      if (!opts.expectUnauthorized) this.events.onUnauthorized()
      throw new UnauthorizedError(message ?? undefined)
    }
    if (response.status === 429) {
      const cooldown = message ? parseCooldownMinutes(message) : null
      if (opts.local429 && cooldown !== null) {
        throw new RateLimitedError(cooldown * 60_000, message ?? 'Please wait before trying again.', true)
      }
      this.consecutive429++
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const backoff = Math.min(MAX_RATE_LIMIT_BACKOFF_MS, retryAfter ?? 30_000 * 2 ** (this.consecutive429 - 1))
      this.blockedUntil = Date.now() + backoff
      this.events.onRateLimited(this.blockedUntil)
      throw new RateLimitedError(backoff)
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ApiError(response.status, 'VRChat redirected the request unexpectedly.')
    }
    throw new ApiError(response.status, message ?? `VRChat returned HTTP ${response.status}.`)
  }

  private cookieHeader(): string {
    const parts: string[] = []
    if (this.cookies.auth) parts.push(`auth=${this.cookies.auth}`)
    if (this.cookies.twoFactorAuth) parts.push(`twoFactorAuth=${this.cookies.twoFactorAuth}`)
    return parts.join('; ')
  }

  private captureCookies(response: Response): void {
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
    let changed = false
    for (const raw of setCookies) {
      const [pair, ...attributes] = raw.split(';')
      if (!pair) continue
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (name !== 'auth' && name !== 'twoFactorAuth') continue
      const expired = attributes.some((a) => {
        const [k, v] = a.split('=')
        if (k?.trim().toLowerCase() === 'max-age') return Number(v) <= 0
        if (k?.trim().toLowerCase() === 'expires') return Date.parse(v ?? '') < Date.now()
        return false
      })
      if (expired || !value) {
        if (this.cookies[name]) {
          delete this.cookies[name]
          changed = true
        }
      } else if (this.cookies[name] !== value) {
        this.cookies[name] = value
        changed = true
      }
    }
    if (changed) this.events.onCookiesChanged(this.getCookies())
  }
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const data: unknown = JSON.parse(await response.text())
    if (isRecord(data) && isRecord(data.error) && typeof data.error.message === 'string') {
      return data.error.message.replace(/^"+|"+$/g, '').trim() || null
    }
    if (isRecord(data) && typeof data.message === 'string') return data.message
  } catch {
    // Not JSON.
  }
  return null
}

/** Parses "Please wait 42 more minutes…" style cooldown messages. */
export function parseCooldownMinutes(message: string): number | null {
  const match = /wait\s+(\d+)\s+(?:more\s+)?minute/i.exec(message)
  return match?.[1] ? Number(match[1]) : null
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(5_000, seconds * 1000)
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.max(5_000, date - Date.now())
  return null
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
