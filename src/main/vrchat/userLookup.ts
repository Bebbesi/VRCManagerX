import type { UserLookupResult } from '@shared/types'
import { isUserId, parseUserReference } from '@shared/validation'
import type { VrcHttpClient } from './http'
import { pickAvatarUrl, type VrcUser } from './types'

const CACHE_TTL_MS = 10 * 60_000
const FRIENDS_PAGE = 50

/** User identification and search, with a short cache to avoid repeated calls. */
export class UserLookup {
  private cache = new Map<string, { at: number; user: UserLookupResult }>()

  constructor(private readonly http: VrcHttpClient) {}

  async getUser(id: string, fresh = false): Promise<UserLookupResult> {
    if (!isUserId(id)) throw new Error('Invalid VRChat user id.')
    const cached = this.cache.get(id)
    if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.user
    const user = toResult(await this.http.get<VrcUser>(`/users/${encodeURIComponent(id)}`, { retries: 1 }))
    this.cache.set(id, { at: Date.now(), user })
    return user
  }

  /** Accepts a user id, a vrchat.com profile link, or a display name to search for. */
  async search(query: string): Promise<UserLookupResult[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    const ref = parseUserReference(trimmed)
    if (ref) return [await this.getUser(ref)]
    if (trimmed.length < 2) return []
    const users = await this.http.get<VrcUser[]>('/users', { query: { search: trimmed.slice(0, 64), n: 15 }, retries: 1 })
    const results = (Array.isArray(users) ? users : []).filter((u) => typeof u?.id === 'string').map(toResult)
    for (const r of results) this.cache.set(r.id, { at: Date.now(), user: r })
    // Friends first: only friends can send invite requests.
    return results.sort((a, b) => Number(Boolean(b.isFriend)) - Number(Boolean(a.isFriend)))
  }

  async friends(offline: boolean, offset: number): Promise<{ users: UserLookupResult[]; hasMore: boolean }> {
    const users = await this.http.get<VrcUser[]>('/auth/user/friends', {
      query: { offline, n: FRIENDS_PAGE, offset: Math.max(0, Math.floor(offset)) },
      retries: 1
    })
    const list = (Array.isArray(users) ? users : []).filter((u) => typeof u?.id === 'string').map((u) => ({ ...toResult(u), isFriend: true }))
    return { users: list, hasMore: list.length === FRIENDS_PAGE }
  }

  clear(): void {
    this.cache.clear()
  }
}

function toResult(u: VrcUser): UserLookupResult {
  return {
    id: u.id,
    displayName: typeof u.displayName === 'string' && u.displayName ? u.displayName : u.id,
    avatarUrl: pickAvatarUrl(u),
    isFriend: u.isFriend,
    status: u.status,
    statusDescription: u.statusDescription
  }
}
