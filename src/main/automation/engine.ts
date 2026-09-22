import type { ActivityEntry, ListStatus, Settings, Toast } from '@shared/types'
import type { ActivityLog } from '../logging/activityLog'
import { safeErrorMessage } from '../logging/redact'
import type { UserStore } from '../users/userStore'
import { RateLimitedError, UnauthorizedError, NetworkError } from '../vrchat/errors'
import type { PresenceTracker } from '../vrchat/presence'
import type { VrcNotification } from '../vrchat/types'
import { AlreadyHandledError, AutomationError, type AcceptHandler, type RejectHandler } from './handlers'
import { evaluateInvite, modeLabel, type Decision } from './rules'
import type { ProcessedStore, StatsStore } from './stores'

export interface EngineDeps {
  settings: () => Settings
  users: UserStore
  presence: PresenceTracker
  refreshPresence: () => Promise<void>
  accept: AcceptHandler
  reject: RejectHandler
  activity: ActivityLog
  stats: StatsStore
  processed: ProcessedStore
  onActivity: (entry: ActivityEntry) => void
  toast: (toast: Omit<Toast, 'id'>) => void
}

/**
 * Receives invite requests (from the monitor), evaluates the rules and runs the
 * accept/reject handlers. Requests are processed one at a time, in arrival order,
 * and each notification id is handled at most once.
 */
export class AutomationEngine {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: EngineDeps) {}

  enqueue(notification: VrcNotification): void {
    if (notification.type !== 'requestInvite') return
    this.queue = this.queue.then(() => this.handle(notification)).catch(() => undefined)
  }

  private async handle(n: VrcNotification): Promise<void> {
    const { users, presence, processed, stats, settings } = this.deps
    if (processed.has(n.id)) return
    processed.add(n.id)
    stats.bump('received')

    const listed = users.get(n.senderUserId)
    const displayName = n.senderUsername?.trim() || listed?.displayName || n.senderUserId
    users.touch(n.senderUserId, n.senderUsername ?? undefined)
    const user = { id: n.senderUserId, displayName, avatarUrl: listed?.avatarUrl }
    const listStatus: ListStatus = users.statusOf(n.senderUserId)

    const s = settings().automation
    if (s.enabled && s.onlyWhenAskMe && !presence.currentStatus) {
      await this.deps.refreshPresence().catch(() => undefined)
    }
    const decision = evaluateInvite(listStatus, {
      automationEnabled: s.enabled,
      trustedOnly: s.trustedOnly,
      autoAcceptWhitelist: s.autoAcceptWhitelist,
      autoRejectBlacklist: s.autoRejectBlacklist,
      requireAskMe: s.onlyWhenAskMe,
      status: presence.currentStatus
    })
    const mode = `${modeLabel({ automationEnabled: s.enabled, trustedOnly: s.trustedOnly })}${s.enabled && s.onlyWhenAskMe ? ' (Ask Me only)' : ''}`
    const base = { kind: 'invite' as const, notificationId: n.id, user, listStatus, rule: decision.rule, mode }

    if (decision.action === 'ignore') {
      stats.bump('ignored')
      this.record({ ...base, action: 'IGNORED', reason: decision.explanation, result: 'skipped' })
      this.deps.toast({ tone: 'info', title: 'Invite left untouched', message: ignoredMessage(displayName, decision) })
      return
    }

    try {
      if (decision.action === 'accept') {
        const result = await this.deps.accept.run(n.id, n.senderUserId)
        stats.bump('accepted')
        this.record({ ...base, action: 'ACCEPTED', reason: result.reasonText, result: 'success', detail: result.warning })
        this.deps.toast({
          tone: 'success',
          title: 'Invite Accepted',
          message: `${displayName} was automatically accepted because they are whitelisted.`
        })
      } else {
        const result = await this.deps.reject.run(n.id, decision.reason)
        stats.bump('rejected')
        this.record({ ...base, action: 'REJECTED', reason: result.reasonText, result: 'success', detail: result.warning })
        this.deps.toast({
          tone: 'danger',
          title: 'Invite Rejected',
          message:
            decision.rule === 'BLACKLIST'
              ? `${displayName} was rejected because they are blacklisted.`
              : `${displayName} was rejected because Trusted Only mode is active.`
        })
      }
    } catch (err) {
      if (err instanceof AlreadyHandledError) {
        stats.bump('ignored')
        this.record({ ...base, action: 'IGNORED', reason: err.message, result: 'skipped' })
        return
      }
      stats.bump('errors')
      const message = describeFailure(err)
      this.record({
        ...base,
        action: 'ERROR',
        reason: `${decision.action === 'accept' ? 'Accept' : 'Reject'} failed; the request was left untouched.`,
        result: 'failed',
        detail: message
      })
      this.deps.toast({
        tone: 'warning',
        title: 'Action failed',
        message: `Couldn't handle the request from ${displayName}: ${message} It is still waiting for you in VRChat.`
      })
    }
  }

  private record(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
    const saved = this.deps.activity.add(entry)
    this.deps.onActivity(saved)
  }
}

function ignoredMessage(name: string, decision: Decision): string {
  switch (decision.rule) {
    case 'AUTOMATION_DISABLED':
      return `Automation is disabled. The request from ${name} is waiting for you.`
    case 'STATUS_NOT_ASK_ME':
      return `Your status is not Ask Me. The request from ${name} is waiting for you.`
    case 'WHITELIST':
      return `${name} is whitelisted, but automatic acceptance is off.`
    case 'BLACKLIST':
      return `${name} is blacklisted, but automatic rejection is off.`
    default:
      return `${name} is not on any list. The request was left for you to decide.`
  }
}

function describeFailure(err: unknown): string {
  if (err instanceof AutomationError) return err.message
  if (err instanceof UnauthorizedError) return 'Your VRChat session expired.'
  if (err instanceof RateLimitedError) return 'VRChat is rate limiting requests right now.'
  if (err instanceof NetworkError) return 'VRChat could not be reached.'
  const msg = safeErrorMessage(err)
  return msg.endsWith('.') ? msg : `${msg}.`
}
