import { REASON_MESSAGE_TYPE } from '@shared/defaults'
import type { InviteMessageType, ReasonKey, Settings, SlotSyncState } from '@shared/types'
import { isUserId } from '@shared/validation'
import { RateLimitedError, UnauthorizedError } from './errors'
import type { VrcHttpClient } from './http'
import type { VrcInviteMessage } from './types'
import { safeErrorMessage } from '../logging/redact'

const KEYS: ReasonKey[] = ['whitelistAccept', 'blacklistReject', 'trustedOnlyReject']

/**
 * VRChat does not accept free text on invites or declines: messages are chosen from
 * 12 per-account slots per message type, and each slot can be edited once every 60 minutes.
 * This keeps the configured reason texts written into their slots, retrying once the
 * cooldown has passed (a single scheduled retry, not periodic polling).
 */
export class MessageSlotSync {
  private readonly states = new Map<ReasonKey, SlotSyncState>()
  /** Texts VRChat stored differently (filtered); not retried until the text changes. */
  private readonly altered = new Map<ReasonKey, string>()
  private retryTimer: NodeJS.Timeout | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private running = false
  private userId: string | null = null

  constructor(
    private readonly http: VrcHttpClient,
    private readonly settings: () => Settings,
    private readonly onChange: () => void,
    private readonly logError: (message: string) => void
  ) {
    this.rebuildDesired()
  }

  start(userId: string): void {
    this.userId = userId
    this.rebuildDesired()
    void this.syncAll(true)
  }

  stop(): void {
    this.userId = null
    this.clearTimers()
    for (const state of this.states.values()) {
      state.currentText = undefined
      state.status = this.settings().automation.sendReasonMessages ? 'unknown' : 'disabled'
      state.retryAt = undefined
      state.cooldownMinutes = undefined
      state.error = undefined
    }
    this.onChange()
  }

  /** Call after settings change; coalesces rapid edits. */
  settingsChanged(): void {
    this.rebuildDesired()
    this.onChange()
    if (!this.userId) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.syncAll(false)
    }, 1500)
  }

  snapshot(): SlotSyncState[] {
    return KEYS.map((k) => ({ ...this.states.get(k)! }))
  }

  /** Slot to use for a reason, or undefined when reason messages are disabled. */
  slotFor(key: ReasonKey): number | undefined {
    if (!this.settings().automation.sendReasonMessages) return undefined
    return this.settings().reasons[key].slot
  }

  /** The text VRChat will actually show for a reason (the slot's current content). */
  textFor(key: ReasonKey): string {
    const state = this.states.get(key)!
    return state.currentText ?? state.desiredText
  }

  isSynced(key: ReasonKey): boolean {
    return this.states.get(key)?.status === 'synced'
  }

  async syncAll(refresh: boolean): Promise<void> {
    if (!this.userId || this.running) return
    if (!this.settings().automation.sendReasonMessages) {
      this.rebuildDesired()
      this.onChange()
      return
    }
    this.running = true
    try {
      if (refresh || [...this.states.values()].some((s) => s.currentText === undefined)) {
        await this.refresh()
      }
      for (const key of KEYS) await this.syncOne(key)
    } catch {
      // Unauthorized: the HTTP client already reported the expired session.
    } finally {
      this.running = false
      this.scheduleRetry()
      this.onChange()
    }
  }

  private async refresh(): Promise<void> {
    const types = [...new Set(KEYS.map((k) => REASON_MESSAGE_TYPE[k]))]
    for (const type of types) {
      try {
        const messages = await this.http.get<VrcInviteMessage[]>(this.path(type))
        for (const key of KEYS) {
          if (REASON_MESSAGE_TYPE[key] !== type) continue
          const state = this.states.get(key)!
          const slot = Array.isArray(messages) ? messages.find((m) => m?.slot === state.slot) : undefined
          this.applyServerSlot(state, slot)
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err
        for (const key of KEYS) {
          if (REASON_MESSAGE_TYPE[key] !== type) continue
          const state = this.states.get(key)!
          state.status = 'error'
          state.error = safeErrorMessage(err)
        }
        this.logError(`Could not read invite message slots (${type}): ${safeErrorMessage(err)}`)
      }
    }
  }

  private async syncOne(key: ReasonKey): Promise<void> {
    const state = this.states.get(key)!
    if (state.currentText === undefined) return
    if (state.currentText === state.desiredText) {
      state.status = 'synced'
      state.error = undefined
      state.retryAt = undefined
      state.cooldownMinutes = undefined
      return
    }
    if (state.retryAt && Date.parse(state.retryAt) > Date.now()) {
      state.status = 'cooldown'
      return
    }
    if (this.altered.get(key) === state.desiredText) {
      state.status = 'error'
      state.error = 'VRChat saved a different text (it may have been filtered).'
      return
    }
    state.status = 'syncing'
    this.onChange()
    try {
      const messages = await this.http.put<VrcInviteMessage[]>(
        `${this.path(state.messageType)}/${state.slot}`,
        { message: state.desiredText },
        { local429: true }
      )
      const updated = Array.isArray(messages) ? messages.find((m) => m?.slot === state.slot) : undefined
      state.currentText = typeof updated?.message === 'string' ? updated.message : state.desiredText
      state.retryAt = undefined
      state.cooldownMinutes = undefined
      if (state.currentText === state.desiredText) {
        state.status = 'synced'
        state.error = undefined
        this.altered.delete(key)
      } else {
        this.altered.set(key, state.desiredText)
        // Stored, but VRChat changed the text (e.g. filtered words). Don't loop on it.
        state.status = 'error'
        state.error = 'VRChat saved a different text (it may have been filtered).'
      }
    } catch (err) {
      if (err instanceof RateLimitedError && err.local) {
        state.status = 'cooldown'
        state.cooldownMinutes = Math.ceil(err.retryAfterMs / 60_000)
        state.retryAt = new Date(Date.now() + err.retryAfterMs + 30_000).toISOString()
        return
      }
      if (err instanceof UnauthorizedError) throw err
      state.status = 'error'
      state.error = safeErrorMessage(err)
      this.logError(`Could not update invite message slot ${state.messageType}#${state.slot}: ${state.error}`)
    }
  }

  private applyServerSlot(state: SlotSyncState, slot: VrcInviteMessage | undefined): void {
    if (!slot || typeof slot.message !== 'string') {
      state.status = 'error'
      state.error = 'Slot not found on VRChat.'
      return
    }
    state.currentText = slot.message
    state.error = undefined
    if (slot.message === state.desiredText) {
      state.status = 'synced'
      state.retryAt = undefined
      state.cooldownMinutes = undefined
    } else if (slot.canBeUpdated === false || (slot.remainingCooldownMinutes ?? 0) > 0) {
      const minutes = Math.max(1, slot.remainingCooldownMinutes ?? 60)
      state.status = 'cooldown'
      state.cooldownMinutes = minutes
      state.retryAt = new Date(Date.now() + minutes * 60_000 + 30_000).toISOString()
    } else {
      state.status = 'unknown'
      state.retryAt = undefined
      state.cooldownMinutes = undefined
    }
  }

  private rebuildDesired(): void {
    const s = this.settings()
    for (const key of KEYS) {
      const prev = this.states.get(key)
      const reason = s.reasons[key]
      const slotChanged = prev && prev.slot !== reason.slot
      this.states.set(key, {
        key,
        messageType: REASON_MESSAGE_TYPE[key],
        slot: reason.slot,
        desiredText: reason.text,
        currentText: slotChanged ? undefined : prev?.currentText,
        status: !s.automation.sendReasonMessages
          ? 'disabled'
          : prev && !slotChanged && prev.currentText !== undefined
            ? prev.currentText === reason.text
              ? 'synced'
              : prev.retryAt && Date.parse(prev.retryAt) > Date.now()
                ? 'cooldown'
                : 'unknown'
            : 'unknown',
        retryAt: slotChanged ? undefined : prev?.retryAt,
        cooldownMinutes: slotChanged ? undefined : prev?.cooldownMinutes,
        error: undefined
      })
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    const times = [...this.states.values()]
      .filter((s) => s.status === 'cooldown' && s.retryAt)
      .map((s) => Date.parse(s.retryAt!))
    if (!times.length || !this.userId) return
    const wait = Math.max(5_000, Math.min(...times) - Date.now())
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.syncAll(true)
    }, wait)
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.retryTimer = null
    this.debounceTimer = null
  }

  private path(type: InviteMessageType): string {
    if (!this.userId || !isUserId(this.userId)) throw new Error('Not logged in.')
    return `/message/${encodeURIComponent(this.userId)}/${type}`
  }
}
