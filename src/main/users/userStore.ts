import type { AddUserOutcome, ListKind, ListStatus, ManagedUser, UserLookupResult } from '@shared/types'
import { isUserId } from '@shared/validation'
import { JsonFile } from '../storage/jsonStore'
import { parseLists } from '../storage/schemas'

interface ListsFile {
  version: 1
  users: ManagedUser[]
}

/**
 * Whitelist and blacklist. A user id can only appear once across both lists,
 * which makes duplicates and whitelist/blacklist conflicts impossible.
 */
export class UserStore {
  private users = new Map<string, ManagedUser>()
  private readonly file: JsonFile<ListsFile>
  private dropped = 0

  constructor(path: string, private readonly onChange: () => void) {
    this.file = new JsonFile<ListsFile>(
      path,
      'Whitelist/Blacklist file',
      (raw) => {
        const { users, dropped } = parseLists(raw)
        this.dropped = dropped
        return { version: 1, users }
      },
      () => ({ version: 1, users: [] })
    )
  }

  load(): string[] {
    const warnings: string[] = []
    this.dropped = 0
    const { value, warning } = this.file.load()
    if (warning) warnings.push(warning)
    if (this.dropped > 0) warnings.push(`${this.dropped} invalid or duplicate list entr${this.dropped === 1 ? 'y was' : 'ies were'} removed.`)
    this.users = new Map(value.users.map((u) => [u.id, u]))
    if (this.dropped > 0) this.persist()
    return warnings
  }

  all(): ManagedUser[] {
    return [...this.users.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
  }

  get(id: string): ManagedUser | undefined {
    return this.users.get(id)
  }

  statusOf(id: string): ListStatus {
    return this.users.get(id)?.list ?? 'unknown'
  }

  counts(): { whitelist: number; blacklist: number } {
    let whitelist = 0
    let blacklist = 0
    for (const u of this.users.values()) {
      if (u.list === 'whitelist') whitelist++
      else blacklist++
    }
    return { whitelist, blacklist }
  }

  /** Adds a user. If they are already in the other list, returns a conflict unless `move` is set. */
  add(user: UserLookupResult, list: ListKind, note?: string, move = false): AddUserOutcome {
    if (!isUserId(user.id)) throw new Error('Invalid VRChat user id.')
    const existing = this.users.get(user.id)
    const now = new Date().toISOString()
    if (existing) {
      if (existing.list === list) return { kind: 'conflict', existing }
      if (!move) return { kind: 'conflict', existing }
      const moved: ManagedUser = {
        ...existing,
        list,
        displayName: cleanName(user.displayName) ?? existing.displayName,
        avatarUrl: user.avatarUrl ?? existing.avatarUrl,
        note: note ?? existing.note,
        updatedAt: now
      }
      this.users.set(moved.id, moved)
      this.persist()
      return { kind: 'added', user: moved }
    }
    const created: ManagedUser = {
      id: user.id,
      displayName: cleanName(user.displayName) ?? user.id,
      avatarUrl: user.avatarUrl,
      note: note?.trim() ? note.trim() : undefined,
      list,
      addedAt: now,
      updatedAt: now
    }
    this.users.set(created.id, created)
    this.persist()
    return { kind: 'added', user: created }
  }

  remove(id: string): boolean {
    const removed = this.users.delete(id)
    if (removed) this.persist()
    return removed
  }

  move(id: string, to: ListKind): ManagedUser {
    const user = this.require(id)
    if (user.list === to) return user
    const updated = { ...user, list: to, updatedAt: new Date().toISOString() }
    this.users.set(id, updated)
    this.persist()
    return updated
  }

  update(id: string, patch: { note?: string; displayName?: string; avatarUrl?: string; lastRequestAt?: string }): ManagedUser {
    const user = this.require(id)
    const updated: ManagedUser = { ...user, updatedAt: new Date().toISOString() }
    if (patch.note !== undefined) updated.note = patch.note.trim() ? patch.note.trim() : undefined
    if (patch.displayName !== undefined) updated.displayName = cleanName(patch.displayName) ?? user.displayName
    if (patch.avatarUrl !== undefined) updated.avatarUrl = patch.avatarUrl.startsWith('https://') ? patch.avatarUrl : undefined
    if (patch.lastRequestAt !== undefined) updated.lastRequestAt = patch.lastRequestAt
    this.users.set(id, updated)
    this.persist()
    return updated
  }

  /** Keeps a listed user's name fresh when they send a request (no API call needed). */
  touch(id: string, displayName: string | undefined): void {
    const user = this.users.get(id)
    if (!user) return
    const name = displayName ? cleanName(displayName) : undefined
    this.users.set(id, {
      ...user,
      displayName: name ?? user.displayName,
      lastRequestAt: new Date().toISOString()
    })
    this.persist()
  }

  private require(id: string): ManagedUser {
    const user = this.users.get(id)
    if (!user) throw new Error('User not found in your lists.')
    return user
  }

  private persist(): void {
    this.file.save({ version: 1, users: [...this.users.values()] })
    this.onChange()
  }
}

function cleanName(name: string | undefined): string | undefined {
  const trimmed = name?.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return trimmed ? trimmed.slice(0, 64) : undefined
}
