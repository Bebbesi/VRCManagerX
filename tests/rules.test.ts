import { describe, expect, it } from 'vitest'
import { evaluateInvite, type RuleContext } from '../src/main/automation/rules'

const base: RuleContext = {
  automationEnabled: true,
  trustedOnly: false,
  autoAcceptWhitelist: true,
  autoRejectBlacklist: true,
  requireAskMe: true,
  status: 'ask me'
}

describe('evaluateInvite - the four cases from the specification', () => {
  it('blacklisted user -> reject with the blacklist reason', () => {
    const d = evaluateInvite('blacklist', base)
    expect(d).toMatchObject({ action: 'reject', rule: 'BLACKLIST', reason: 'blacklistReject' })
  })

  it('whitelisted user with Trusted Only on -> accept', () => {
    const d = evaluateInvite('whitelist', { ...base, trustedOnly: true })
    expect(d).toMatchObject({ action: 'accept', rule: 'WHITELIST', reason: 'whitelistAccept' })
  })

  it('unknown user with Trusted Only off -> left untouched', () => {
    const d = evaluateInvite('unknown', base)
    expect(d).toMatchObject({ action: 'ignore', rule: 'UNKNOWN' })
  })

  it('unknown user with Trusted Only on -> reject with the Trusted Only reason', () => {
    const d = evaluateInvite('unknown', { ...base, trustedOnly: true })
    expect(d).toMatchObject({ action: 'reject', rule: 'TRUSTED_ONLY', reason: 'trustedOnlyReject' })
  })
})

describe('evaluateInvite - priorities and switches', () => {
  it('whitelisted user with Trusted Only off -> accept', () => {
    expect(evaluateInvite('whitelist', base).action).toBe('accept')
  })

  it('blacklist has priority even in Trusted Only mode', () => {
    const d = evaluateInvite('blacklist', { ...base, trustedOnly: true })
    expect(d).toMatchObject({ action: 'reject', rule: 'BLACKLIST', reason: 'blacklistReject' })
  })

  it('does nothing at all when automation is disabled', () => {
    for (const list of ['whitelist', 'blacklist', 'unknown'] as const) {
      for (const trustedOnly of [true, false]) {
        const d = evaluateInvite(list, { ...base, automationEnabled: false, trustedOnly })
        expect(d).toMatchObject({ action: 'ignore', rule: 'AUTOMATION_DISABLED' })
      }
    }
  })

  it('respects Ask Me: other statuses are left for manual handling', () => {
    for (const status of ['active', 'join me', 'busy', 'offline', '']) {
      const d = evaluateInvite('whitelist', { ...base, status })
      expect(d).toMatchObject({ action: 'ignore', rule: 'STATUS_NOT_ASK_ME' })
    }
  })

  it('acts in any status when "only when Ask Me" is off', () => {
    expect(evaluateInvite('whitelist', { ...base, requireAskMe: false, status: 'active' }).action).toBe('accept')
  })

  it('whitelist auto-accept off -> whitelisted users are left untouched, never rejected', () => {
    expect(evaluateInvite('whitelist', { ...base, autoAcceptWhitelist: false })).toMatchObject({ action: 'ignore', rule: 'WHITELIST' })
    expect(evaluateInvite('whitelist', { ...base, autoAcceptWhitelist: false, trustedOnly: true }).action).toBe('ignore')
  })

  it('blacklist auto-reject off -> left untouched, but Trusted Only still rejects', () => {
    expect(evaluateInvite('blacklist', { ...base, autoRejectBlacklist: false })).toMatchObject({ action: 'ignore', rule: 'BLACKLIST' })
    expect(evaluateInvite('blacklist', { ...base, autoRejectBlacklist: false, trustedOnly: true })).toMatchObject({
      action: 'reject',
      rule: 'TRUSTED_ONLY'
    })
  })

  it('a blacklisted user is never accepted under any combination', () => {
    for (const trustedOnly of [true, false])
      for (const autoAcceptWhitelist of [true, false])
        for (const autoRejectBlacklist of [true, false]) {
          const d = evaluateInvite('blacklist', { ...base, trustedOnly, autoAcceptWhitelist, autoRejectBlacklist })
          expect(d.action).not.toBe('accept')
        }
  })

  it('Trusted Only leaves no unknown request pending', () => {
    expect(evaluateInvite('unknown', { ...base, trustedOnly: true }).action).toBe('reject')
  })
})
