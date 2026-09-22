import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { app, dialog, nativeTheme, shell, type BrowserWindow } from 'electron'
import { defaultSettings } from '@shared/defaults'
import type {
  AccountInfo,
  ActivityEntry,
  ActivityPage,
  ActivityQuery,
  AddUserOutcome,
  AppSnapshot,
  AuthState,
  ConnectionPhase,
  ConnectionState,
  ListKind,
  LoginOutcome,
  ManagedUser,
  Settings,
  SettingsPatch,
  Toast,
  TwoFactorMethod,
  UserLookupResult
} from '@shared/types'
import { LoginError, LoginService } from '../auth/login'
import { logout as performLogout } from '../auth/logout'
import { SessionManager, type StoredSession } from '../auth/session'
import { AutomationEngine } from '../automation/engine'
import { AcceptHandler, RejectHandler } from '../automation/handlers'
import { ProcessedStore, StatsStore } from '../automation/stores'
import { ActivityLog } from '../logging/activityLog'
import { ErrorLog } from '../logging/errorLog'
import { safeErrorMessage } from '../logging/redact'
import { JsonFile } from '../storage/jsonStore'
import type { DataPaths } from '../storage/paths'
import { parseSettings } from '../storage/schemas'
import { SecureStore } from '../storage/secureStore'
import { UserSearch } from '../users/userSearch'
import { UserStore } from '../users/userStore'
import { PipelineConnection, type PipelineState } from '../vrchat/connection'
import { NetworkError, RateLimitedError, UnauthorizedError } from '../vrchat/errors'
import { VrcHttpClient } from '../vrchat/http'
import { InviteActions } from '../vrchat/inviteActions'
import { InviteMonitor } from '../vrchat/inviteMonitor'
import { MessageSlotSync } from '../vrchat/messageSlots'
import { PresenceTracker } from '../vrchat/presence'
import { pickAvatarUrl, isRecord, type VrcCurrentUser } from '../vrchat/types'
import { UserLookup } from '../vrchat/userLookup'

export interface Broadcaster {
  snapshot(snapshot: AppSnapshot): void
  users(users: ManagedUser[]): void
  activity(entry: ActivityEntry): void
  toast(toast: Toast): void
}

const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 5 * 60_000

/**
 * Wires authentication, the VRChat integration, user lists, the automation engine and
 * logging together. The UI only talks to this class through IPC and never sees secrets.
 */
export class AppController {
  private settings: Settings = defaultSettings()
  private readonly settingsFile: JsonFile<Settings>
  private auth: AuthState = { phase: 'initializing', secureStorageAvailable: false }
  private account: AccountInfo | undefined
  private connection: ConnectionState = { phase: 'disconnected', since: new Date().toISOString() }
  private pipelineState: PipelineState = 'idle'
  private pipelineRetryAt: number | undefined
  private pipelineDetail: string | undefined
  private everConnected = false
  private reachable = true
  private sessionExpired = false
  private startupWarnings: string[] = []
  private verifyTimer: NodeJS.Timeout | null = null
  private verifyAttempts = 0
  private rateLimitTimer: NodeJS.Timeout | null = null
  private snapshotTimer: NodeJS.Timeout | null = null
  private lastEventAt: string | undefined
  private loggingOut = false

  readonly errorLog: ErrorLog
  readonly http: VrcHttpClient
  private readonly session: SessionManager
  private readonly loginService: LoginService
  private readonly pipeline: PipelineConnection
  private readonly presence: PresenceTracker
  private readonly lookup: UserLookup
  private readonly actions: InviteActions
  private readonly slots: MessageSlotSync
  private readonly monitor: InviteMonitor
  private readonly engine: AutomationEngine
  private readonly users: UserStore
  private readonly userSearch: UserSearch
  private readonly activity: ActivityLog
  private readonly stats: StatsStore
  private readonly processed: ProcessedStore

  constructor(
    private readonly paths: DataPaths,
    private readonly broadcaster: Broadcaster,
    private readonly version: string,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onStateChanged: () => void
  ) {
    this.errorLog = new ErrorLog(paths.errors)
    this.settingsFile = new JsonFile(paths.settings, 'Settings file', parseSettings, defaultSettings)

    this.http = new VrcHttpClient(() => this.userAgent(), {
      onUnauthorized: () => this.handleSessionExpired('Your VRChat session expired. Please sign in again.'),
      onRateLimited: (until) => this.handleRateLimited(until),
      onReachability: (ok) => this.handleReachability(ok),
      onCookiesChanged: () => {
        if (this.auth.phase === 'logged_in') this.session.persist(this.account)
      }
    })
    this.session = new SessionManager(new SecureStore<StoredSession>(paths.session), this.http, () => this.settings)
    this.loginService = new LoginService(this.http)
    this.pipeline = new PipelineConnection(() => this.userAgent())
    this.presence = new PresenceTracker(() => this.scheduleSnapshot())
    this.lookup = new UserLookup(this.http)
    this.actions = new InviteActions(this.http)
    this.slots = new MessageSlotSync(
      this.http,
      () => this.settings,
      () => this.scheduleSnapshot(),
      (msg) => this.logSystemError('Message slots', msg, true)
    )
    this.users = new UserStore(paths.lists, () => {
      this.broadcaster.users(this.users.all())
      this.scheduleSnapshot()
    })
    this.userSearch = new UserSearch(this.lookup, this.users)
    this.activity = new ActivityLog(paths.activity)
    this.stats = new StatsStore(paths.stats)
    this.processed = new ProcessedStore(paths.processed)

    const handlerDeps = {
      actions: this.actions,
      slots: this.slots,
      presence: this.presence,
      refreshPresence: () => this.refreshCurrentUser()
    }
    this.engine = new AutomationEngine({
      settings: () => this.settings,
      users: this.users,
      presence: this.presence,
      refreshPresence: () => this.refreshCurrentUser(),
      accept: new AcceptHandler(handlerDeps),
      reject: new RejectHandler(handlerDeps),
      activity: this.activity,
      stats: this.stats,
      processed: this.processed,
      onActivity: (entry) => {
        this.broadcaster.activity(entry)
        this.scheduleSnapshot()
      },
      toast: (t) => this.toast(t, true)
    })
    this.monitor = new InviteMonitor(
      this.http,
      () => this.settings,
      (n) => this.engine.enqueue(n),
      (id) => this.processed.has(id)
    )

    this.pipeline.on('state', (state, info) => {
      this.pipelineState = state
      this.pipelineRetryAt = info.retryAt
      this.pipelineDetail = info.detail
      if (state === 'open') void this.onPipelineOpen()
      this.updateConnection()
    })
    this.pipeline.on('event', (event) => {
      this.lastEventAt = new Date().toISOString()
      if (this.account && this.presence.applyPipelineEvent(event.type, event.content, this.account.id)) {
        if (event.type === 'user-update') this.refreshAccountFromEvent(event.content)
        return
      }
      this.monitor.handlePipelineEvent(event.type, event.content)
    })
    this.pipeline.on('auth-failed', () => void this.checkSessionAfterPipelineFailure())
  }

  // -------------------------------------------------------------------------
  // Startup

  /** Startup order: configuration, whitelist, blacklist, settings, session, monitoring. */
  async init(): Promise<void> {
    const loaded = this.settingsFile.load()
    this.settings = loaded.value
    if (loaded.warning) this.startupWarnings.push(loaded.warning)

    this.startupWarnings.push(...this.users.load())
    const counts = this.users.counts()
    this.errorLog.write('startup', `Loaded ${counts.whitelist} whitelisted and ${counts.blacklist} blacklisted users.`)

    this.startupWarnings.push(...this.stats.load(), ...this.processed.load())
    const activityLoad = this.activity.load()
    if (activityLoad.warning) this.startupWarnings.push(activityLoad.warning)

    this.applySettingsSideEffects(undefined)
    this.slots.settingsChanged()
    for (const warning of this.startupWarnings) this.logSystemError('Startup', warning, true)

    this.auth = { phase: 'initializing', secureStorageAvailable: this.session.secureStorageAvailable }
    this.scheduleSnapshot()

    const stored = this.session.restore()
    if (!stored?.auth) {
      this.setAuth({ phase: 'logged_out' })
      return
    }
    this.account = stored.account
    this.setAuth({ phase: 'logged_in', account: this.account })
    await this.verifySessionAndStart()
  }

  // -------------------------------------------------------------------------
  // Snapshot / broadcasting

  snapshot(): AppSnapshot {
    return {
      version: this.version,
      auth: { ...this.auth, account: this.account && this.auth.phase === 'logged_in' ? this.account : this.auth.account },
      connection: { ...this.connection, lastEventAt: this.lastEventAt },
      presence: this.presence.snapshot(),
      settings: structuredClone(this.settings),
      stats: this.stats.get(),
      counts: this.users.counts(),
      slots: this.slots.snapshot(),
      startupWarnings: [...this.startupWarnings]
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      this.broadcaster.snapshot(this.snapshot())
      this.onStateChanged()
    }, 50)
  }

  private toast(t: Omit<Toast, 'id'>, automation = false): void {
    if (automation && !this.settings.app.showNotifications) return
    this.broadcaster.toast({ ...t, id: randomUUID() })
  }

  get automationActive(): boolean {
    return this.settings.automation.enabled && this.auth.phase === 'logged_in' && this.connection.phase === 'connected'
  }

  get automationEnabled(): boolean {
    return this.settings.automation.enabled
  }

  get minimizeToTray(): boolean {
    return this.settings.app.minimizeToTray
  }

  get statusLine(): string {
    if (this.auth.phase !== 'logged_in') return 'Signed out'
    if (!this.settings.automation.enabled) return 'Automation disabled'
    return this.connection.phase === 'connected' ? 'Automation active' : `Automation paused (${this.connection.phase.replace('_', ' ')})`
  }

  // -------------------------------------------------------------------------
  // Authentication

  async login(username: string, password: string, remember: boolean): Promise<LoginOutcome> {
    if (this.auth.phase === 'logged_in') throw new LoginError('Already signed in.')
    if (this.settings.app.rememberSession !== remember) {
      this.settings = { ...this.settings, app: { ...this.settings.app, rememberSession: remember } }
      this.settingsFile.save(this.settings)
    }
    try {
      const step = await this.loginService.login(username, password)
      return this.afterLoginStep(step)
    } catch (err) {
      this.errorLog.write('auth', `Login failed: ${safeErrorMessage(err)}`)
      throw err
    }
  }

  async verifyTwoFactor(method: TwoFactorMethod, code: string): Promise<LoginOutcome> {
    if (this.auth.phase !== 'two_factor') throw new LoginError('No verification is pending. Please sign in again.')
    try {
      const step = await this.loginService.verify(method, code)
      return this.afterLoginStep(step)
    } catch (err) {
      this.errorLog.write('auth', `2FA verification failed: ${safeErrorMessage(err)}`)
      throw err
    }
  }

  cancelTwoFactor(): void {
    this.loginService.cancel()
    this.setAuth({ phase: 'logged_out' })
  }

  private afterLoginStep(step: Awaited<ReturnType<LoginService['login']>>): LoginOutcome {
    if (step.kind === 'two_factor') {
      this.setAuth({ phase: 'two_factor', twoFactorMethods: step.methods })
      return { kind: 'two_factor', methods: step.methods }
    }
    this.onLoggedIn(step.user)
    return { kind: 'logged_in', account: this.account! }
  }

  async logout(): Promise<void> {
    this.loggingOut = true
    try {
      this.stopMonitoring()
      await performLogout(this.http, this.session)
      this.account = undefined
      this.sessionExpired = false
      this.lookup.clear()
      this.setAuth({ phase: 'logged_out', notice: 'You have been signed out.' })
      this.errorLog.write('auth', 'Signed out.')
    } finally {
      this.loggingOut = false
    }
  }

  private onLoggedIn(user: VrcCurrentUser): void {
    this.account = toAccount(user)
    this.presence.applyCurrentUser(user)
    this.sessionExpired = false
    this.verifyAttempts = 0
    this.session.persist(this.account)
    this.setAuth({ phase: 'logged_in', account: this.account })
    this.errorLog.write('auth', 'Signed in.')
    this.startMonitoring()
  }

  private async verifySessionAndStart(): Promise<void> {
    this.clearVerifyTimer()
    try {
      const response = await this.http.get<unknown>('/auth/user', { expectUnauthorized: true, retries: 1 })
      if (!isRecord(response) || typeof response.id !== 'string' || 'requiresTwoFactorAuth' in response) {
        this.handleSessionExpired('Your VRChat session expired. Please sign in again.')
        return
      }
      this.onLoggedIn(response as unknown as VrcCurrentUser)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.handleSessionExpired('Your VRChat session expired. Please sign in again.')
        return
      }
      // Offline / rate limited / VRChat down: keep the session and retry later.
      const wait =
        err instanceof RateLimitedError
          ? err.retryAfterMs + 1_000
          : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.verifyAttempts)
      this.verifyAttempts++
      this.pipelineRetryAt = Date.now() + wait
      this.pipelineDetail = safeErrorMessage(err)
      if (!(err instanceof NetworkError) && !(err instanceof RateLimitedError)) {
        this.logSystemError('Connection', `Could not validate the session: ${safeErrorMessage(err)}`, false)
      }
      this.updateConnection()
      this.verifyTimer = setTimeout(() => void this.verifySessionAndStart(), wait)
    }
  }

  private handleSessionExpired(notice: string): void {
    if (this.loggingOut || this.auth.phase !== 'logged_in') return
    this.stopMonitoring()
    this.session.expire()
    this.sessionExpired = true
    this.setAuth({ phase: 'logged_out', notice })
    this.logSystemError('Session', 'The VRChat session expired or was revoked.', true)
    this.toast({ tone: 'warning', title: 'Session expired', message: 'Sign in again to resume automatic invite management.' })
  }

  private async checkSessionAfterPipelineFailure(): Promise<void> {
    try {
      await this.http.get('/auth', { expectUnauthorized: true, retries: 0 })
    } catch (err) {
      if (err instanceof UnauthorizedError) this.handleSessionExpired('Your VRChat session expired. Please sign in again.')
    }
  }

  private setAuth(partial: Omit<AuthState, 'secureStorageAvailable'>): void {
    this.auth = { ...partial, secureStorageAvailable: this.session.secureStorageAvailable }
    this.updateConnection()
    this.scheduleSnapshot()
  }

  // -------------------------------------------------------------------------
  // Monitoring

  private startMonitoring(): void {
    const token = this.http.getCookies().auth
    if (!token || !this.account) return
    this.everConnected = false
    this.pipeline.start(token)
    this.slots.start(this.account.id)
    this.updateConnection()
  }

  private stopMonitoring(): void {
    this.clearVerifyTimer()
    this.pipeline.stop()
    this.slots.stop()
    this.presence.reset()
  }

  private async onPipelineOpen(): Promise<void> {
    const reconnect = this.everConnected
    this.everConnected = true
    try {
      if (reconnect) await this.refreshCurrentUser()
      const picked = await this.monitor.catchUp()
      if (picked > 0) this.errorLog.write('monitor', `Found ${picked} pending invite request(s) after connecting.`)
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        this.logSystemError('Monitoring', `Could not check pending requests: ${safeErrorMessage(err)}`, true)
      }
    }
  }

  private async refreshCurrentUser(): Promise<void> {
    const response = await this.http.get<unknown>('/auth/user', { retries: 1 })
    if (isRecord(response) && typeof response.id === 'string') {
      const user = response as unknown as VrcCurrentUser
      this.presence.applyCurrentUser(user)
      this.account = toAccount(user)
      this.scheduleSnapshot()
    }
  }

  private refreshAccountFromEvent(content: unknown): void {
    if (!this.account || !isRecord(content) || !isRecord(content.user)) return
    const u = content.user
    this.account = {
      ...this.account,
      displayName: typeof u.displayName === 'string' ? u.displayName : this.account.displayName,
      status: typeof u.status === 'string' ? u.status : this.account.status,
      statusDescription: typeof u.statusDescription === 'string' ? u.statusDescription : this.account.statusDescription
    }
    this.scheduleSnapshot()
  }

  reconnect(): void {
    if (this.auth.phase !== 'logged_in') return
    if (this.pipelineState === 'idle') {
      this.verifyAttempts = 0
      void this.verifySessionAndStart()
    } else {
      this.pipeline.reconnectNow()
    }
  }

  /** Called when the OS reports the network is back or the machine resumed from sleep. */
  networkRestored(): void {
    if (this.auth.phase === 'logged_in' && this.connection.phase !== 'connected') this.reconnect()
  }

  private handleRateLimited(until: number): void {
    this.logSystemError('Rate limit', `VRChat rate limited requests until ${new Date(until).toLocaleTimeString()}.`, false)
    if (this.rateLimitTimer) clearTimeout(this.rateLimitTimer)
    this.rateLimitTimer = setTimeout(() => {
      this.rateLimitTimer = null
      this.updateConnection()
    }, Math.max(0, until - Date.now()) + 250)
    this.updateConnection()
  }

  private handleReachability(ok: boolean): void {
    if (this.reachable === ok) return
    this.reachable = ok
    this.updateConnection()
  }

  private updateConnection(): void {
    let phase: ConnectionPhase
    let detail: string | undefined
    let retryAt: number | undefined
    const rateLimitedUntil = this.http.rateLimitedUntil
    if (this.auth.phase !== 'logged_in') {
      phase = this.sessionExpired ? 'session_expired' : 'disconnected'
    } else if (rateLimitedUntil) {
      phase = 'rate_limited'
      retryAt = rateLimitedUntil
      detail = 'VRChat asked us to slow down.'
    } else if (this.pipelineState === 'open') {
      phase = 'connected'
    } else if (!this.reachable) {
      phase = 'unreachable'
      retryAt = this.pipelineRetryAt
      detail = 'VRChat cannot be reached. Retrying automatically.'
    } else if (this.pipelineState === 'waiting') {
      phase = 'reconnecting'
      retryAt = this.pipelineRetryAt
      detail = this.pipelineDetail
    } else if (this.pipelineState === 'connecting') {
      phase = this.everConnected ? 'reconnecting' : 'connecting'
    } else {
      phase = this.verifyTimer ? 'reconnecting' : 'connecting'
      retryAt = this.verifyTimer ? this.pipelineRetryAt : undefined
      detail = this.verifyTimer ? this.pipelineDetail : undefined
    }
    const changed = phase !== this.connection.phase
    this.connection = {
      phase,
      detail,
      since: changed ? new Date().toISOString() : this.connection.since,
      retryAt: retryAt ? new Date(retryAt).toISOString() : undefined
    }
    if (changed && phase !== 'connecting') this.errorLog.write('connection', `Connection state: ${phase}`)
    this.scheduleSnapshot()
  }

  private clearVerifyTimer(): void {
    if (this.verifyTimer) clearTimeout(this.verifyTimer)
    this.verifyTimer = null
  }

  // -------------------------------------------------------------------------
  // Settings

  updateSettings(patch: SettingsPatch): Settings {
    const previous = this.settings
    const next: Settings = {
      automation: { ...previous.automation, ...patch.automation },
      reasons: {
        whitelistAccept: { ...previous.reasons.whitelistAccept, ...patch.reasons?.whitelistAccept },
        blacklistReject: { ...previous.reasons.blacklistReject, ...patch.reasons?.blacklistReject },
        trustedOnlyReject: { ...previous.reasons.trustedOnlyReject, ...patch.reasons?.trustedOnlyReject }
      },
      app: { ...previous.app, ...patch.app }
    }
    if (next.reasons.blacklistReject.slot === next.reasons.trustedOnlyReject.slot) {
      throw new Error('The Blacklist and Trusted Only reasons must use different message slots.')
    }
    this.settings = next
    this.settingsFile.save(next)
    this.applySettingsSideEffects(previous)
    this.scheduleSnapshot()
    return structuredClone(next)
  }

  resetSettings(section: 'reasons' | 'all'): Settings {
    const defaults = defaultSettings()
    const previous = this.settings
    this.settings = section === 'all' ? defaults : { ...previous, reasons: defaults.reasons }
    this.settingsFile.save(this.settings)
    this.applySettingsSideEffects(previous)
    this.scheduleSnapshot()
    return structuredClone(this.settings)
  }

  private applySettingsSideEffects(previous: Settings | undefined): void {
    const s = this.settings
    nativeTheme.themeSource = s.app.theme
    if (!previous || previous.app.startWithWindows !== s.app.startWithWindows) {
      if (app.isPackaged) {
        try {
          app.setLoginItemSettings({ openAtLogin: s.app.startWithWindows, args: ['--hidden'] })
        } catch (err) {
          this.errorLog.write('settings', `Could not update start-with-Windows: ${safeErrorMessage(err)}`)
        }
      }
    }
    if (previous && previous.app.rememberSession !== s.app.rememberSession && this.auth.phase === 'logged_in') {
      this.session.persist(this.account)
    }
    if (
      previous &&
      (JSON.stringify(previous.reasons) !== JSON.stringify(s.reasons) ||
        previous.automation.sendReasonMessages !== s.automation.sendReasonMessages)
    ) {
      this.slots.settingsChanged()
    }
    if (previous && previous.automation.enabled !== s.automation.enabled) {
      this.errorLog.write('settings', `Automation ${s.automation.enabled ? 'enabled' : 'disabled'}.`)
    }
  }

  async syncSlots(): Promise<void> {
    if (this.auth.phase !== 'logged_in') throw new Error('Sign in first.')
    await this.slots.syncAll(true)
  }

  // -------------------------------------------------------------------------
  // Users

  listUsers(): ManagedUser[] {
    return this.users.all()
  }

  addUser(user: UserLookupResult, list: ListKind, note: string | undefined, move: boolean): AddUserOutcome {
    const outcome = this.users.add(user, list, note, move)
    if (outcome.kind === 'added') this.errorLog.write('lists', `${list}: added/moved ${outcome.user.id}`)
    return outcome
  }

  removeUser(id: string): void {
    if (!this.users.remove(id)) throw new Error('User not found in your lists.')
  }

  moveUser(id: string, to: ListKind): ManagedUser {
    return this.users.move(id, to)
  }

  updateUser(id: string, patch: { note?: string; displayName?: string }): ManagedUser {
    return this.users.update(id, patch)
  }

  async refreshUser(id: string): Promise<ManagedUser> {
    this.requireLogin()
    if (!this.users.get(id)) throw new Error('User not found in your lists.')
    return this.userSearch.refresh(id)
  }

  async lookupUsers(query: string): Promise<UserLookupResult[]> {
    this.requireLogin()
    return this.userSearch.search(query)
  }

  async listFriends(offline: boolean, offset: number): Promise<{ users: UserLookupResult[]; hasMore: boolean }> {
    this.requireLogin()
    return this.userSearch.friends(offline, offset)
  }

  private requireLogin(): void {
    if (this.auth.phase !== 'logged_in') throw new Error('Sign in to VRChat first.')
  }

  // -------------------------------------------------------------------------
  // Activity

  queryActivity(q: ActivityQuery): ActivityPage {
    return this.activity.query(q)
  }

  clearActivity(): void {
    this.activity.clear()
    this.scheduleSnapshot()
  }

  resetStats(): void {
    this.stats.reset()
    this.scheduleSnapshot()
  }

  async exportActivity(format: 'csv' | 'json'): Promise<string | null> {
    const window = this.getWindow()
    const stamp = new Date().toISOString().slice(0, 10)
    const options = {
      title: 'Export activity log',
      defaultPath: `vrcmanagerx-activity-${stamp}.${format}`,
      filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }]
    }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const entries = this.activity.all()
    const content = format === 'json' ? JSON.stringify(entries, null, 2) : toCsv(entries)
    writeFileSync(result.filePath, content, 'utf8')
    return result.filePath
  }

  async openDataFolder(): Promise<void> {
    await shell.openPath(this.paths.root)
  }

  setAutomationEnabled(enabled: boolean): void {
    this.updateSettings({ automation: { enabled } })
  }

  // -------------------------------------------------------------------------

  private logSystemError(scope: string, message: string, showInActivity: boolean): void {
    this.errorLog.write(scope, message)
    if (!showInActivity) return
    const entry = this.activity.add({
      kind: 'error',
      rule: 'SYSTEM',
      action: 'ERROR',
      reason: `${scope}: ${message}`,
      mode: this.settings.automation.enabled ? (this.settings.automation.trustedOnly ? 'Trusted Only' : 'Standard') : 'Automation Off',
      result: 'failed'
    })
    this.broadcaster.activity(entry)
  }

  userAgent(): string {
    const contact = this.settings.app.userAgentContact.trim()
    return `VRCManagerX/${this.version} ${contact || '(contact not configured)'}`
  }

  dispose(): void {
    this.pipeline.stop()
    this.slots.stop()
    this.clearVerifyTimer()
    if (this.rateLimitTimer) clearTimeout(this.rateLimitTimer)
  }
}

function toAccount(user: VrcCurrentUser): AccountInfo {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    avatarUrl: pickAvatarUrl(user),
    status: user.status ?? 'offline',
    statusDescription: user.statusDescription
  }
}

function toCsv(entries: ActivityEntry[]): string {
  const header = ['timestamp', 'kind', 'user_id', 'display_name', 'list', 'rule', 'action', 'reason', 'mode', 'result', 'detail']
  const escape = (v: string | undefined) => {
    const s = (v ?? '').replace(/"/g, '""')
    // Neutralise spreadsheet formulas.
    return `"${/^[=+\-@]/.test(s) ? `'${s}` : s}"`
  }
  const rows = entries.map((e) =>
    [e.timestamp, e.kind, e.user?.id, e.user?.displayName, e.listStatus, e.rule, e.action, e.reason, e.mode, e.result, e.detail]
      .map(escape)
      .join(',')
  )
  return [header.join(','), ...rows].join('\r\n')
}
