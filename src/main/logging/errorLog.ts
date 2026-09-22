import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { redact } from './redact'

const MAX_BYTES = 2 * 1024 * 1024

/**
 * Plain-text diagnostic log (errors.log). Every line is redacted, so tokens,
 * cookies and passwords can never end up on disk even if they appear in an error.
 */
export class ErrorLog {
  constructor(private readonly path: string) {}

  write(scope: string, message: string, extra?: unknown): void {
    const line = `[${new Date().toISOString()}] [${scope}] ${message}${extra === undefined ? '' : ` ${safeJson(extra)}`}`
    const safe = redact(line).replace(/[\r\n]+/g, ' ')
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      this.rotate()
      appendFileSync(this.path, `${safe}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Logging must never crash the app.
    }
    if (process.env.NODE_ENV === 'development') console.warn(safe)
  }

  private rotate(): void {
    if (!existsSync(this.path)) return
    if (statSync(this.path).size < MAX_BYTES) return
    renameSync(this.path, `${this.path}.1`)
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
