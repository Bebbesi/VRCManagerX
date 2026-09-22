import type { Stats } from '@shared/types'
import { JsonFile } from '../storage/jsonStore'
import { parseStats, processedFileSchema } from '../storage/schemas'

function freshStats(): Stats {
  return { since: new Date().toISOString(), received: 0, accepted: 0, rejected: 0, ignored: 0, errors: 0 }
}

/** Invite counters shown on the dashboard. */
export class StatsStore {
  private stats: Stats = freshStats()
  private readonly file: JsonFile<Stats>

  constructor(path: string) {
    this.file = new JsonFile(path, 'Statistics file', parseStats, freshStats)
  }

  load(): string[] {
    const { value, warning } = this.file.load()
    this.stats = value
    return warning ? [warning] : []
  }

  get(): Stats {
    return { ...this.stats }
  }

  bump(field: Exclude<keyof Stats, 'since'>): void {
    this.stats[field]++
    this.file.save(this.stats)
  }

  reset(): void {
    this.stats = freshStats()
    this.file.save(this.stats)
  }
}

const MAX_PROCESSED = 2000
const PROCESSED_TTL_MS = 7 * 24 * 60 * 60_000

/** Notification ids already handled, so a request is never processed twice (e.g. after reconnects). */
export class ProcessedStore {
  private ids = new Map<string, number>()
  private readonly file: JsonFile<{ entries: Array<[string, number]> }>

  constructor(path: string) {
    this.file = new JsonFile(path, 'Processed requests file', (raw) => processedFileSchema.parse(raw), () => ({ entries: [] }))
  }

  load(): string[] {
    const { value, warning } = this.file.load()
    const cutoff = Date.now() - PROCESSED_TTL_MS
    this.ids = new Map(value.entries.filter(([, at]) => at > cutoff))
    return warning ? [warning] : []
  }

  has(id: string): boolean {
    return this.ids.has(id)
  }

  add(id: string): void {
    this.ids.set(id, Date.now())
    if (this.ids.size > MAX_PROCESSED) {
      const oldest = [...this.ids.entries()].sort((a, b) => a[1] - b[1]).slice(0, this.ids.size - MAX_PROCESSED)
      for (const [key] of oldest) this.ids.delete(key)
    }
    this.file.save({ entries: [...this.ids.entries()] })
  }
}
