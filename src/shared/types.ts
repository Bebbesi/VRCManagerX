// Types shared between the main process (automation, VRChat integration) and the renderer (UI).
// Nothing in here may ever carry credentials, cookies or tokens.

export type ListKind = 'whitelist' | 'blacklist'
export type ListStatus = ListKind | 'unknown'

export interface ManagedUser {
  /** VRChat user id (usr_…). Unique across both lists. */
  id: string
  displayName: string
  /** VRChat only exposes `username` for the logged-in account, so this is usually empty. */
  username?: string
  avatarUrl?: string
  /** Local, private note. Never sent to VRChat. */
  note?: string
  list: ListKind
  addedAt: string
  updatedAt: string
  /** Last time this user sent us an invite request. */
  lastRequestAt?: string
}

/** A VRChat user as returned by a lookup/search, before being added to a list. */
export interface UserLookupResult {
  id: string
  displayName: string
  avatarUrl?: string
  isFriend?: boolean
  status?: string
  statusDescription?: string
  /** Which list the user is already in, if any. */
  list?: ListKind
}

// ---------------------------------------------------------------------------
// Settings

export type ReasonKey = 'whitelistAccept' | 'blacklistReject' | 'trustedOnlyReject'
export type InviteMessageType = 'message' | 'response' | 'request' | 'requestResponse'

export interface ReasonSetting {
  text: string
  /** VRChat invite-message slot (0-11) used to deliver the text. */
  slot: number
}

export interface Settings {
  automation: {
    enabled: boolean
    trustedOnly: boolean
    autoAcceptWhitelist: boolean
    autoRejectBlacklist: boolean
    /** Only act on requests while the account status is "ask me". */
    onlyWhenAskMe: boolean
    /** Attach the custom reason (via invite-message slots) to accept/reject actions. */
    sendReasonMessages: boolean
    /** On connect, also handle requests received while the app was closed. */
    processPendingOnStartup: boolean
    pendingMaxAgeMinutes: number
  }
  reasons: Record<ReasonKey, ReasonSetting>
  app: {
    theme: 'dark' | 'light' | 'system'
    minimizeToTray: boolean
    startWithWindows: boolean
    showNotifications: boolean
    rememberSession: boolean
    /** Contact info appended to the User-Agent, as required by VRChat's API guidelines. */
    userAgentContact: string
  }
}

export type SettingsPatch = {
  automation?: Partial<Settings['automation']>
  reasons?: Partial<Record<ReasonKey, Partial<ReasonSetting>>>
  app?: Partial<Settings['app']>
}

// ---------------------------------------------------------------------------
// Auth / connection state

export type TwoFactorMethod = 'totp' | 'otp' | 'emailOtp'

export interface AccountInfo {
  id: string
  displayName: string
  username?: string
  avatarUrl?: string
  status: string
  statusDescription?: string
}

export type AuthPhase = 'initializing' | 'logged_out' | 'two_factor' | 'logged_in'

export interface AuthState {
  phase: AuthPhase
  account?: AccountInfo
  twoFactorMethods?: TwoFactorMethod[]
  /** Why the user is logged out (session expired, logged out, …). */
  notice?: string
  /** False when OS-level encryption is unavailable, so the session cannot be remembered. */
  secureStorageAvailable: boolean
}

export type ConnectionPhase =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'rate_limited'
  | 'unreachable'
  | 'session_expired'

export interface ConnectionState {
  phase: ConnectionPhase
  detail?: string
  since: string
  /** When a reconnect attempt is scheduled (ISO), if any. */
  retryAt?: string
  lastEventAt?: string
}

export interface PresenceState {
  status: string
  /** True when the account is currently inside an instance that can be invited to. */
  inInstance: boolean
  worldId?: string
}

export type SlotSyncStatus = 'disabled' | 'unknown' | 'synced' | 'syncing' | 'cooldown' | 'error'

export interface SlotSyncState {
  key: ReasonKey
  messageType: InviteMessageType
  slot: number
  desiredText: string
  currentText?: string
  status: SlotSyncStatus
  cooldownMinutes?: number
  retryAt?: string
  error?: string
}

export interface Stats {
  since: string
  received: number
  accepted: number
  rejected: number
  ignored: number
  errors: number
}

export interface AppSnapshot {
  version: string
  auth: AuthState
  connection: ConnectionState
  presence: PresenceState
  settings: Settings
  stats: Stats
  counts: { whitelist: number; blacklist: number }
  slots: SlotSyncState[]
  /** Problems found while loading persisted data (corrupted files, etc.). */
  startupWarnings: string[]
}

// ---------------------------------------------------------------------------
// Activity log

export type ActivityAction = 'ACCEPTED' | 'REJECTED' | 'IGNORED' | 'ERROR'
export type RuleId =
  | 'BLACKLIST'
  | 'WHITELIST'
  | 'TRUSTED_ONLY'
  | 'UNKNOWN'
  | 'AUTOMATION_DISABLED'
  | 'STATUS_NOT_ASK_ME'
  | 'SYSTEM'

export interface ActivityEntry {
  id: string
  timestamp: string
  kind: 'invite' | 'error'
  notificationId?: string
  user?: { id: string; displayName: string; username?: string; avatarUrl?: string }
  listStatus?: ListStatus
  rule: RuleId
  action: ActivityAction
  /** Reason text sent to the requester, or an explanation of why nothing was sent. */
  reason: string
  mode: string
  result: 'success' | 'failed' | 'skipped'
  detail?: string
}

export type ActivityFilter = 'all' | 'accepted' | 'rejected' | 'ignored' | 'whitelist' | 'blacklist' | 'errors'

export interface ActivityQuery {
  filter: ActivityFilter
  search?: string
  limit?: number
  offset?: number
}

export interface ActivityPage {
  entries: ActivityEntry[]
  total: number
}

// ---------------------------------------------------------------------------
// Events pushed from main to renderer

export interface Toast {
  id: string
  tone: 'success' | 'danger' | 'info' | 'warning'
  title: string
  message: string
}

export type ResultOk<T> = { ok: true; value: T }
export type ResultErr = { ok: false; error: string; code?: string }
export type Result<T> = ResultOk<T> | ResultErr

export type LoginOutcome =
  | { kind: 'logged_in'; account: AccountInfo }
  | { kind: 'two_factor'; methods: TwoFactorMethod[] }

export type AddUserOutcome =
  | { kind: 'added'; user: ManagedUser }
  | { kind: 'conflict'; existing: ManagedUser }
