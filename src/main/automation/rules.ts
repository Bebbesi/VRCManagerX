import type { ListStatus, ReasonKey, RuleId } from '@shared/types'

export interface RuleContext {
  automationEnabled: boolean
  trustedOnly: boolean
  autoAcceptWhitelist: boolean
  autoRejectBlacklist: boolean
  /** "Only act while my status is Ask Me" is enabled. */
  requireAskMe: boolean
  /** The account's current VRChat status. */
  status: string
}

export type Decision =
  | { action: 'accept'; rule: RuleId; reason: ReasonKey; explanation: string }
  | { action: 'reject'; rule: RuleId; reason: ReasonKey; explanation: string }
  | { action: 'ignore'; rule: RuleId; explanation: string }

export const ASK_ME_STATUS = 'ask me'

/**
 * Decides what to do with an incoming invite request. Pure function: no I/O.
 *
 * Priority: 1. Blacklist  2. Whitelist  3. Trusted Only  4. Manual (leave untouched)
 *
 *   Blacklisted                      -> REJECT
 *   Whitelisted                      -> ACCEPT
 *   Unknown + Trusted Only on        -> REJECT
 *   Unknown + Trusted Only off       -> IGNORE (the user decides manually)
 */
export function evaluateInvite(list: ListStatus, ctx: RuleContext): Decision {
  if (!ctx.automationEnabled) {
    return { action: 'ignore', rule: 'AUTOMATION_DISABLED', explanation: 'Automation is disabled; left for manual handling.' }
  }
  if (ctx.requireAskMe && ctx.status !== ASK_ME_STATUS) {
    return {
      action: 'ignore',
      rule: 'STATUS_NOT_ASK_ME',
      explanation: `Status is "${ctx.status || 'unknown'}", not "Ask Me"; left for manual handling.`
    }
  }

  if (list === 'blacklist') {
    if (ctx.autoRejectBlacklist) {
      return { action: 'reject', rule: 'BLACKLIST', reason: 'blacklistReject', explanation: 'User is blacklisted.' }
    }
    // A blacklisted user is never accepted. With blacklist rejection off, Trusted Only still
    // rejects everyone who is not whitelisted; otherwise the request is left alone.
    if (ctx.trustedOnly) {
      return {
        action: 'reject',
        rule: 'TRUSTED_ONLY',
        reason: 'trustedOnlyReject',
        explanation: 'User is not whitelisted and Trusted Only is active (blacklist rejection is off).'
      }
    }
    return { action: 'ignore', rule: 'BLACKLIST', explanation: 'User is blacklisted, but automatic blacklist rejection is off.' }
  }

  if (list === 'whitelist') {
    if (ctx.autoAcceptWhitelist) {
      return { action: 'accept', rule: 'WHITELIST', reason: 'whitelistAccept', explanation: 'User is whitelisted.' }
    }
    return { action: 'ignore', rule: 'WHITELIST', explanation: 'User is whitelisted, but automatic acceptance is off.' }
  }

  if (ctx.trustedOnly) {
    return { action: 'reject', rule: 'TRUSTED_ONLY', reason: 'trustedOnlyReject', explanation: 'User is not whitelisted and Trusted Only is active.' }
  }
  return { action: 'ignore', rule: 'UNKNOWN', explanation: 'User is not on any list; left for manual handling.' }
}

export function modeLabel(ctx: Pick<RuleContext, 'automationEnabled' | 'trustedOnly'>): string {
  if (!ctx.automationEnabled) return 'Automation Off'
  return ctx.trustedOnly ? 'Trusted Only' : 'Standard'
}
