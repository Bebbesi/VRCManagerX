import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { protocol } from 'electron'
import { API_ORIGIN, type SessionCookies } from '../vrchat/http'

export const IMAGE_SCHEME = 'vrcmx-img'

const CACHE_TTL_MS = 7 * 24 * 60 * 60_000
const MAX_BYTES = 5 * 1024 * 1024
const MAX_CONCURRENT = 2
const ALLOWED_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$/

/** Hosts VRChat serves profile images from. The auth cookie is only ever sent to the API host. */
function isAllowedHost(host: string): boolean {
  return (
    host === 'api.vrchat.cloud' ||
    host === 'assets.vrchat.com' ||
    host === 'files.vrchat.cloud' ||
    host.endsWith('.vrchat.cloud') ||
    host.endsWith('.vrchat.com') ||
    host.endsWith('.cloudfront.net') ||
    host.endsWith('.amazonaws.com')
  )
}

/** Must run before the app is ready. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } }
  ])
}

/**
 * Serves VRChat profile pictures to the renderer as `vrcmx-img://img/<base64url(url)>`.
 * Images are fetched by the main process (with the proper User-Agent, and the session
 * cookie only for api.vrchat.cloud) and cached on disk, so the renderer never needs
 * network access or credentials.
 */
export function handleImageProtocol(opts: {
  cacheDir: string
  userAgent: () => string
  cookies: () => SessionCookies
  blockedUntil: () => number
}): void {
  let active = 0
  const waiting: Array<() => void> = []
  const acquire = async () => {
    if (active < MAX_CONCURRENT) {
      active++
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
    active++
  }
  const release = () => {
    active--
    waiting.shift()?.()
  }

  protocol.handle(IMAGE_SCHEME, async (request) => {
    let target: URL
    try {
      const encoded = new URL(request.url).pathname.replace(/^\/+/, '')
      target = new URL(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      return new Response(null, { status: 400 })
    }
    if (target.protocol !== 'https:' || !isAllowedHost(target.hostname)) return new Response(null, { status: 403 })

    mkdirSync(opts.cacheDir, { recursive: true })
    const key = createHash('sha256').update(target.href).digest('hex')
    const dataPath = join(opts.cacheDir, `${key}.bin`)
    const typePath = join(opts.cacheDir, `${key}.type`)
    if (existsSync(dataPath) && existsSync(typePath) && Date.now() - statSync(dataPath).mtimeMs < CACHE_TTL_MS) {
      return new Response(readFileSync(dataPath), { headers: { 'Content-Type': readFileSync(typePath, 'utf8') } })
    }
    if (opts.blockedUntil() > Date.now()) return new Response(null, { status: 503 })

    await acquire()
    try {
      const response = await fetchFollowingRedirects(target, opts)
      if (!response) return new Response(null, { status: 502 })
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (!response.ok || !ALLOWED_TYPES.test(type)) return new Response(null, { status: 502 })
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length > MAX_BYTES) return new Response(null, { status: 413 })
      try {
        writeFileSync(dataPath, body)
        writeFileSync(typePath, type)
      } catch {
        // Cache is best effort.
      }
      return new Response(body, { headers: { 'Content-Type': type } })
    } catch {
      return new Response(null, { status: 502 })
    } finally {
      release()
    }
  })
}

async function fetchFollowingRedirects(
  start: URL,
  opts: { userAgent: () => string; cookies: () => SessionCookies }
): Promise<Response | null> {
  let url = start
  for (let hop = 0; hop < 4; hop++) {
    const headers: Record<string, string> = { 'User-Agent': opts.userAgent(), Accept: 'image/*' }
    if (url.origin === API_ORIGIN) {
      const auth = opts.cookies().auth
      if (auth) headers.Cookie = `auth=${auth}`
    }
    const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      const next = new URL(location, url)
      if (next.protocol !== 'https:' || !isAllowedHost(next.hostname)) return null
      url = next
      continue
    }
    return response
  }
  return null
}
