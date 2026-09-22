import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/shared/defaults'
import { isInvitableLocation, parseUserReference, validateTwoFactorCode } from '../src/shared/validation'
import { parseLists, parseSettings } from '../src/main/storage/schemas'
import { migrateLegacyData } from '../src/main/storage/migrate'
import { redact, safeErrorMessage } from '../src/main/logging/redact'
import { parseMessage } from '../src/main/vrchat/connection'
import { parseCooldownMinutes } from '../src/main/vrchat/http'
import { asNotification, pickAvatarUrl } from '../src/main/vrchat/types'

const ID_A = 'usr_c1644b5b-3ca4-45b4-97c6-a2a0de70d469'
const ID_B = 'usr_00000000-1111-2222-3333-444444444444'

describe('settings persistence', () => {
  it('returns defaults for garbage', () => {
    expect(parseSettings(null)).toEqual(defaultSettings())
    expect(parseSettings('nope')).toEqual(defaultSettings())
  })

  it('repairs individual invalid fields without losing the rest', () => {
    const s = parseSettings({
      automation: { enabled: false, trustedOnly: 'yes', pendingMaxAgeMinutes: -3 },
      reasons: { whitelistAccept: { text: 'Welcome!', slot: 99 } },
      app: { theme: 'neon' }
    })
    expect(s.automation.enabled).toBe(false)
    expect(s.automation.trustedOnly).toBe(false)
    expect(s.automation.pendingMaxAgeMinutes).toBe(10)
    expect(s.reasons.whitelistAccept).toEqual({ text: 'Welcome!', slot: 11 })
    expect(s.reasons.blacklistReject.text).toBe('This user is not accepting invites')
    expect(s.app.theme).toBe('dark')
  })

  it('rejects reason texts that are too long', () => {
    const s = parseSettings({ reasons: { blacklistReject: { text: 'x'.repeat(200), slot: 3 } } })
    expect(s.reasons.blacklistReject.text).toBe('This user is not accepting invites')
    expect(s.reasons.blacklistReject.slot).toBe(3)
  })

  it('separates decline slots that collide', () => {
    const s = parseSettings({ reasons: { blacklistReject: { text: 'a', slot: 5 }, trustedOnlyReject: { text: 'b', slot: 5 } } })
    expect(s.reasons.blacklistReject.slot).not.toBe(s.reasons.trustedOnlyReject.slot)
  })
})

describe('list persistence', () => {
  const user = (id: string, list: string, updatedAt = '2026-01-01T00:00:00.000Z') => ({
    id,
    displayName: 'Someone',
    list,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt
  })

  it('drops invalid entries and duplicates, keeping the latest copy', () => {
    const { users, dropped } = parseLists({
      version: 1,
      users: [user(ID_A, 'whitelist'), user(ID_A, 'blacklist', '2026-02-01T00:00:00.000Z'), user('bad', 'whitelist'), { junk: true }, user(ID_B, 'blacklist')]
    })
    expect(users).toHaveLength(2)
    expect(users.find((u) => u.id === ID_A)?.list).toBe('blacklist')
    expect(dropped).toBe(3)
  })

  it('throws on a structurally invalid file so it can be quarantined', () => {
    expect(() => parseLists({ users: 'x' })).toThrow()
  })
})

describe('validation', () => {
  it('parses ids and profile links', () => {
    expect(parseUserReference(ID_A)).toBe(ID_A)
    expect(parseUserReference(`https://vrchat.com/home/user/${ID_A}`)).toBe(ID_A)
    expect(parseUserReference('https://vrchat.com/home/user/usr_../../evil')).toBeNull()
    expect(parseUserReference('Some Name')).toBeNull()
  })

  it('recognises invitable locations', () => {
    expect(isInvitableLocation('wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd:12345~hidden(usr_x)~region(eu)')).toBe(true)
    for (const bad of ['offline', 'private', 'traveling', '', undefined, 'wrld_x']) expect(isInvitableLocation(bad)).toBe(false)
  })

  it('validates 2FA codes', () => {
    expect(validateTwoFactorCode('totp', '123 456')).toBeNull()
    expect(validateTwoFactorCode('totp', '12345')).not.toBeNull()
    expect(validateTwoFactorCode('otp', 'abcd-1234')).toBeNull()
  })
})

describe('secret redaction', () => {
  it('removes cookies, tokens and passwords', () => {
    const text = redact(
      'wss://pipeline.vrchat.cloud/?authToken=authcookie_1234-abcd Cookie: auth=authcookie_zzz; twoFactorAuth=eyJhbGciOi.abc Authorization: Basic dXNlcjpwYXNzd29yZA== {"password":"hunter2"}'
    )
    expect(text).not.toMatch(/1234-abcd|authcookie_zzz|eyJhbGciOi|dXNlcjpwYXNzd29yZA|hunter2/)
  })

  it('produces short single-line messages', () => {
    expect(safeErrorMessage(new Error('line1\nline2'))).toBe('line1 line2')
    expect(safeErrorMessage(undefined)).toBe('Unexpected error')
  })
})

describe('VRChat payload parsing', () => {
  it('unpacks double-encoded pipeline messages', () => {
    const inner = { id: 'not_1', type: 'requestInvite', senderUserId: ID_A, senderUsername: 'Alice', created_at: '2026-09-22T10:00:00Z', details: {} }
    const event = parseMessage(JSON.stringify({ type: 'notification', content: JSON.stringify(inner) }))
    expect(event?.type).toBe('notification')
    expect(asNotification(event?.content)).toMatchObject({ id: 'not_1', type: 'requestInvite', senderUserId: ID_A })
  })

  it('keeps bare-id contents and pipeline errors', () => {
    expect(parseMessage(JSON.stringify({ type: 'hide-notification', content: 'not_1' }))).toEqual({ type: 'hide-notification', content: 'not_1' })
    expect(parseMessage(JSON.stringify({ err: "authToken doesn't correspond with an active session" }))?.type).toBe('__error')
    expect(parseMessage('not json')).toBeNull()
  })

  it('reads invite-message cooldowns', () => {
    expect(parseCooldownMinutes('Please wait 42 more minutes until you try again.')).toBe(42)
    expect(parseCooldownMinutes('Something else')).toBeNull()
  })

  it('only accepts https avatar URLs', () => {
    expect(pickAvatarUrl({ iconUrl: 'javascript:alert(1)', userIcon: 'https://api.vrchat.cloud/x' })).toBe('https://api.vrchat.cloud/x')
    expect(pickAvatarUrl({})).toBeUndefined()
  })
})

describe('data migration after the rename', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'vrcmx-migrate-'))
    const legacy = join(root, 'legacy')
    const target = join(root, 'target')
    mkdirSync(join(legacy, 'logs'), { recursive: true })
    writeFileSync(join(legacy, 'lists.json'), '{"version":1,"users":[]}')
    writeFileSync(join(legacy, 'session.bin'), 'enc')
    writeFileSync(join(legacy, 'Local State'), '{}')
    writeFileSync(join(legacy, 'logs', 'activity.jsonl'), '')
    return { root, legacy, target }
  }

  it('copies data, the session and its key into a fresh profile, leaving the old folder intact', () => {
    const { root, legacy, target } = setup()
    const copied = migrateLegacyData(target, legacy)
    expect(copied).toEqual(expect.arrayContaining(['lists.json', 'session.bin', 'Local State', join('logs', 'activity.jsonl')]))
    expect(existsSync(join(target, 'lists.json'))).toBe(true)
    expect(existsSync(join(legacy, 'lists.json'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it('never overwrites a profile that already has data, and skips a missing legacy folder', () => {
    const { root, legacy, target } = setup()
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'settings.json'), '{}')
    expect(migrateLegacyData(target, legacy)).toEqual([])
    expect(migrateLegacyData(target, join(root, 'missing'))).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })
})
