import type { ListKind, ManagedUser, UserLookupResult } from '@shared/types'
import type { UserLookup } from '../vrchat/userLookup'
import type { UserStore } from './userStore'

/** Remote search (VRChat) annotated with local list membership. */
export class UserSearch {
  constructor(
    private readonly lookup: UserLookup,
    private readonly store: UserStore
  ) {}

  async search(query: string): Promise<UserLookupResult[]> {
    const results = await this.lookup.search(query)
    return results.map((r) => this.annotate(r))
  }

  async friends(offline: boolean, offset: number): Promise<{ users: UserLookupResult[]; hasMore: boolean }> {
    const page = await this.lookup.friends(offline, offset)
    return { users: page.users.map((u) => this.annotate(u)), hasMore: page.hasMore }
  }

  /** Re-fetches a listed user's public profile (display name, picture). */
  async refresh(id: string): Promise<ManagedUser> {
    const fresh = await this.lookup.getUser(id, true)
    return this.store.update(id, { displayName: fresh.displayName, avatarUrl: fresh.avatarUrl ?? '' })
  }

  private annotate(result: UserLookupResult): UserLookupResult {
    const list: ListKind | undefined = this.store.get(result.id)?.list
    return list ? { ...result, list } : result
  }
}
