import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'

/**
 * Stores a small secret blob encrypted with the OS keystore (DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux) through Electron's safeStorage.
 * If encryption is unavailable nothing is ever written in clear text.
 */
export class SecureStore<T> {
  constructor(private readonly path: string) {}

  get available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  read(validate: (raw: unknown) => T | null): T | null {
    if (!existsSync(this.path) || !this.available) return null
    try {
      const plain = safeStorage.decryptString(readFileSync(this.path))
      const value = validate(JSON.parse(plain))
      if (value === null) this.clear()
      return value
    } catch {
      // Unreadable (different Windows user, corrupted, …): discard it.
      this.clear()
      return null
    }
  }

  write(value: T): boolean {
    if (!this.available) return false
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
    renameSync(tmp, this.path)
    return true
  }

  clear(): void {
    try {
      rmSync(this.path, { force: true })
    } catch {
      // ignore
    }
  }
}
