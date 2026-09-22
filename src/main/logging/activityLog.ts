import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { ActivityEntry, ActivityPage, ActivityQuery } from '@shared/types'
import { redact } from './redact'

const MAX_ENTRIES = 5000

const entrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  kind: z.enum(['invite', 'error']),
  notificationId: z.string().optional(),
  user: z
    .object({
      id: z.string(),
      displayName: z.string(),
      username: z.string().optional(),
      avatarUrl: z.string().optional()
    })
    .optional(),
  listStatus: z.enum(['whitelist', 'blacklist', 'unknown']).optional(),
  rule: z.enum(['BLACKLIST', 'WHITELIST', 'TRUSTED_ONLY', 'UNKNOWN', 'AUTOMATION_DISABLED', 'STATUS_NOT_ASK_ME', 'SYSTEM']),
  action: z.enum(['ACCEPTED', 'REJECTED', 'IGNORED', 'ERROR']),
  reason: z.string(),
  mode: z.string(),
  result: z.enum(['success', 'failed', 'skipped']),
  detail: z.string().optional()
})

/**
 * Persistent activity log stored as JSON lines (logs/activity.jsonl).
 * Keeps the newest MAX_ENTRIES in memory; damaged lines are skipped on load.
 */
export class ActivityLog {
  private entries: ActivityEntry[] = []
  private skippedOnLoad = 0

  constructor(private readonly path: string) {}

  load(): { warning?: string } {
    this.entries = []
    this.skippedOnLoad = 0
    if (!existsSync(this.path)) return {}
    try {
      const lines = readFileSync(this.path, 'utf8').split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = entrySchema.safeParse(JSON.parse(line))
          if (parsed.success) this.entries.push(parsed.data as ActivityEntry)
          else this.skippedOnLoad++
        } catch {
          this.skippedOnLoad++
        }
      }
    } catch {
      renameSync(this.path, `${this.path}.corrupt-${Date.now()}`)
      return { warning: 'The activity log could not be read and was reset.' }
    }
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES)
      this.compact()
    }
    if (this.skippedOnLoad > 0) {
      this.compact()
      return { warning: `${this.skippedOnLoad} damaged activity log line(s) were skipped.` }
    }
    return {}
  }

  add(input: Omit<ActivityEntry, 'id' | 'timestamp'> & { timestamp?: string }): ActivityEntry {
    const entry: ActivityEntry = {
      ...input,
      id: randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      reason: redact(input.reason),
      detail: input.detail === undefined ? undefined : redact(input.detail)
    }
    this.entries.push(entry)
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Keep the in-memory copy even if the disk write fails.
    }
    if (this.entries.length > MAX_ENTRIES * 1.2) {
      this.entries = this.entries.slice(-MAX_ENTRIES)
      this.compact()
    }
    return entry
  }

  query(q: ActivityQuery): ActivityPage {
    const search = q.search?.trim().toLowerCase()
    const filtered = this.entries.filter((e) => {
      switch (q.filter) {
        case 'accepted':
          if (e.action !== 'ACCEPTED') return false
          break
        case 'rejected':
          if (e.action !== 'REJECTED') return false
          break
        case 'ignored':
          if (e.action !== 'IGNORED') return false
          break
        case 'whitelist':
          if (e.listStatus !== 'whitelist') return false
          break
        case 'blacklist':
          if (e.listStatus !== 'blacklist') return false
          break
        case 'errors':
          if (e.action !== 'ERROR' && e.result !== 'failed') return false
          break
      }
      if (!search) return true
      return (
        e.user?.displayName.toLowerCase().includes(search) ||
        e.user?.id.toLowerCase().includes(search) ||
        e.reason.toLowerCase().includes(search) ||
        (e.detail?.toLowerCase().includes(search) ?? false)
      )
    })
    const newestFirst = filtered.reverse()
    const offset = Math.max(0, q.offset ?? 0)
    const limit = Math.min(500, Math.max(1, q.limit ?? 100))
    return { entries: newestFirst.slice(offset, offset + limit), total: newestFirst.length }
  }

  recent(limit: number): ActivityEntry[] {
    return this.entries.filter((e) => e.kind === 'invite').slice(-limit).reverse()
  }

  all(): ActivityEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
    this.compact()
  }

  private compact(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''), {
        encoding: 'utf8',
        mode: 0o600
      })
      renameSync(tmp, this.path)
    } catch {
      // ignore
    }
  }
}
