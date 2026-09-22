import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface LoadResult<T> {
  value: T
  /** Set when the file existed but could not be used and was quarantined. */
  warning?: string
}

/**
 * A small JSON document on disk with atomic writes, a rolling `.bak` copy and
 * quarantine of corrupted files (renamed to `*.corrupt-<timestamp>`), so a bad file
 * never prevents the app from starting.
 */
export class JsonFile<T> {
  constructor(
    private readonly path: string,
    private readonly label: string,
    private readonly parse: (raw: unknown) => T,
    private readonly fallback: () => T
  ) {}

  load(): LoadResult<T> {
    if (!existsSync(this.path)) {
      const backup = this.tryRead(`${this.path}.bak`)
      if (backup.ok) return { value: backup.value, warning: `${this.label} was missing and has been restored from backup.` }
      return { value: this.fallback() }
    }
    const primary = this.tryRead(this.path)
    if (primary.ok) return { value: primary.value }

    const quarantined = this.quarantine()
    const backup = this.tryRead(`${this.path}.bak`)
    if (backup.ok) {
      return {
        value: backup.value,
        warning: `${this.label} was corrupted (${primary.error}). Restored the last good copy; the damaged file was kept as ${quarantined}.`
      }
    }
    return {
      value: this.fallback(),
      warning: `${this.label} was corrupted (${primary.error}) and has been reset to defaults. The damaged file was kept as ${quarantined}.`
    }
  }

  save(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
    if (existsSync(this.path)) {
      try {
        copyFileSync(this.path, `${this.path}.bak`)
      } catch {
        // A missing backup is not fatal.
      }
    }
    renameSync(tmp, this.path)
  }

  private tryRead(path: string): { ok: true; value: T } | { ok: false; error: string } {
    if (!existsSync(path)) return { ok: false, error: 'missing' }
    try {
      const text = readFileSync(path, 'utf8')
      return { ok: true, value: this.parse(JSON.parse(text)) }
    } catch (err) {
      return { ok: false, error: err instanceof SyntaxError ? 'invalid JSON' : 'invalid content' }
    }
  }

  private quarantine(): string {
    const target = `${this.path}.corrupt-${Date.now()}`
    try {
      renameSync(this.path, target)
    } catch {
      try {
        rmSync(this.path, { force: true })
      } catch {
        // ignore
      }
    }
    return target.split(/[\\/]/).pop() ?? target
  }
}
