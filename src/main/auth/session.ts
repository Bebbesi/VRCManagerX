import type { AccountInfo, Settings } from '@shared/types'
import type { SecureStore } from '../storage/secureStore'
import type { SessionCookies, VrcHttpClient } from '../vrchat/http'
import { isRecord } from '../vrchat/types'

export interface StoredSession {
  v: 1
  auth?: string
  twoFactorAuth?: string
  /** Non-sensitive profile info, shown while the session is being re-validated. */
  account?: AccountInfo
}

/**
 * Persists the VRChat session cookies (never the password), encrypted with the OS
 * keystore. Reusing the `auth` cookie avoids creating a new VRChat session on each start;
 * the `twoFactorAuth` cookie lets VRChat skip 2FA on this device.
 */
export class SessionManager {
  constructor(
    private readonly store: SecureStore<StoredSession>,
    private readonly http: VrcHttpClient,
    private readonly settings: () => Settings
  ) {}

  get secureStorageAvailable(): boolean {
    return this.store.available
  }

  /** Loads the stored session into the HTTP client. */
  restore(): StoredSession | null {
    const stored = this.store.read(validateStored)
    if (!stored) return null
    this.http.setCookies({ auth: stored.auth, twoFactorAuth: stored.twoFactorAuth })
    return stored
  }

  /** Saves the current cookies if the user asked to be remembered. */
  persist(account?: AccountInfo): void {
    if (!this.settings().app.rememberSession) {
      this.store.clear()
      return
    }
    const cookies: SessionCookies = this.http.getCookies()
    if (!cookies.auth && !cookies.twoFactorAuth) {
      this.store.clear()
      return
    }
    this.store.write({ v: 1, auth: cookies.auth, twoFactorAuth: cookies.twoFactorAuth, account })
  }

  /** Session expired: forget the auth cookie, keep the 2FA device cookie if remembering. */
  expire(): void {
    this.http.clearAuthCookie()
    this.persist()
  }

  /** Explicit sign-out: forget everything. */
  clear(): void {
    this.http.clearAll()
    this.store.clear()
  }
}

function validateStored(raw: unknown): StoredSession | null {
  if (!isRecord(raw) || raw.v !== 1) return null
  const auth = typeof raw.auth === 'string' && /^[A-Za-z0-9_.-]{8,1024}$/.test(raw.auth) ? raw.auth : undefined
  const twoFactorAuth = typeof raw.twoFactorAuth === 'string' && raw.twoFactorAuth.length < 4096 ? raw.twoFactorAuth : undefined
  let account: AccountInfo | undefined
  if (isRecord(raw.account) && typeof raw.account.id === 'string' && typeof raw.account.displayName === 'string') {
    account = {
      id: raw.account.id,
      displayName: raw.account.displayName,
      username: typeof raw.account.username === 'string' ? raw.account.username : undefined,
      avatarUrl: typeof raw.account.avatarUrl === 'string' && raw.account.avatarUrl.startsWith('https://') ? raw.account.avatarUrl : undefined,
      status: typeof raw.account.status === 'string' ? raw.account.status : 'offline'
    }
  }
  if (!auth && !twoFactorAuth) return null
  return { v: 1, auth, twoFactorAuth, account }
}
