import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../src/shared/defaults'
import type { Settings } from '../src/shared/types'
import { AutomationEngine } from '../src/main/automation/engine'
import { AcceptHandler, RejectHandler } from '../src/main/automation/handlers'
import { ProcessedStore, StatsStore } from '../src/main/automation/stores'
import { ActivityLog } from '../src/main/logging/activityLog'
import { UserStore } from '../src/main/users/userStore'
import { ApiError } from '../src/main/vrchat/errors'
import type { InviteActions } from '../src/main/vrchat/inviteActions'
import type { MessageSlotSync } from '../src/main/vrchat/messageSlots'
import { PresenceTracker } from '../src/main/vrchat/presence'
import type { VrcNotification } from '../src/main/vrchat/types'

const WL = 'usr_11111111-1111-1111-1111-111111111111'
const BL = 'usr_22222222-2222-2222-2222-222222222222'
const UNKNOWN = 'usr_33333333-3333-3333-3333-333333333333'
const LOCATION = 'wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd:12345~private(usr_x)~region(eu)'

let dir: string
let settings: Settings
let actions: { invite: ReturnType<typeof vi.fn>; declineWithMessage: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> }
let engine: AutomationEngine
let activity: ActivityLog
let stats: StatsStore
let presence: PresenceTracker
let toasts: string[]

function request(id: string, sender: string): VrcNotification {
  return { id, type: 'requestInvite', senderUserId: sender, senderUsername: `Name ${sender.slice(4, 8)}`, created_at: new Date().toISOString() }
}

async function flush(e: AutomationEngine) {
  // The engine processes requests sequentially on an internal promise chain.
  await (e as unknown as { queue: Promise<void> }).queue
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vrcmx-test-'))
  settings = defaultSettings()
  const users = new UserStore(join(dir, 'lists.json'), () => undefined)
  users.load()
  users.add({ id: WL, displayName: 'Friendly' }, 'whitelist')
  users.add({ id: BL, displayName: 'Blocked' }, 'blacklist')
  presence = new PresenceTracker(() => undefined)
  presence.applyCurrentUser({ id: 'usr_me', displayName: 'Me', status: 'ask me', location: LOCATION })
  actions = { invite: vi.fn(async () => undefined), declineWithMessage: vi.fn(async () => undefined), hide: vi.fn(async () => undefined) }
  const slots = {
    slotFor: (key: keyof Settings['reasons']) => (settings.automation.sendReasonMessages ? settings.reasons[key].slot : undefined),
    textFor: (key: keyof Settings['reasons']) => settings.reasons[key].text
  } as unknown as MessageSlotSync
  const deps = { actions: actions as unknown as InviteActions, slots, presence, refreshPresence: async () => undefined }
  activity = new ActivityLog(join(dir, 'activity.jsonl'))
  activity.load()
  stats = new StatsStore(join(dir, 'stats.json'))
  stats.load()
  const processed = new ProcessedStore(join(dir, 'processed.json'))
  processed.load()
  toasts = []
  engine = new AutomationEngine({
    settings: () => settings,
    users,
    presence,
    refreshPresence: async () => undefined,
    accept: new AcceptHandler(deps),
    reject: new RejectHandler(deps),
    activity,
    stats,
    processed,
    onActivity: () => undefined,
    toast: (t) => toasts.push(`${t.title}: ${t.message}`)
  })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('AutomationEngine', () => {
  it('accepts whitelisted users by inviting them to the current instance with the accept slot', async () => {
    engine.enqueue(request('not_a', WL))
    await flush(engine)
    expect(actions.invite).toHaveBeenCalledWith(WL, LOCATION, 11)
    expect(actions.hide).toHaveBeenCalledWith('not_a')
    const [entry] = activity.recent(1)
    expect(entry).toMatchObject({ action: 'ACCEPTED', rule: 'WHITELIST', reason: 'Accepted automatically: User Whitelisted', result: 'success' })
    expect(toasts[0]).toContain('was automatically accepted because they are whitelisted')
  })

  it('rejects blacklisted users with the blacklist slot', async () => {
    engine.enqueue(request('not_b', BL))
    await flush(engine)
    expect(actions.declineWithMessage).toHaveBeenCalledWith('not_b', 10)
    expect(actions.invite).not.toHaveBeenCalled()
    expect(activity.recent(1)[0]).toMatchObject({ action: 'REJECTED', rule: 'BLACKLIST', reason: 'This user is not accepting invites' })
  })

  it('leaves unknown users completely untouched when Trusted Only is off', async () => {
    engine.enqueue(request('not_c', UNKNOWN))
    await flush(engine)
    expect(actions.invite).not.toHaveBeenCalled()
    expect(actions.declineWithMessage).not.toHaveBeenCalled()
    expect(actions.hide).not.toHaveBeenCalled()
    expect(activity.recent(1)[0]).toMatchObject({ action: 'IGNORED', rule: 'UNKNOWN', listStatus: 'unknown' })
  })

  it('rejects unknown users with the Trusted Only slot when Trusted Only is on', async () => {
    settings.automation.trustedOnly = true
    engine.enqueue(request('not_d', UNKNOWN))
    await flush(engine)
    expect(actions.declineWithMessage).toHaveBeenCalledWith('not_d', 11)
    expect(activity.recent(1)[0]).toMatchObject({ action: 'REJECTED', rule: 'TRUSTED_ONLY', reason: 'User is not accepting request at this moment' })
  })

  it('performs no action at all while automation is disabled', async () => {
    settings.automation.enabled = false
    for (const [id, user] of [['n1', WL], ['n2', BL], ['n3', UNKNOWN]] as const) engine.enqueue(request(id, user))
    await flush(engine)
    expect(actions.invite).not.toHaveBeenCalled()
    expect(actions.declineWithMessage).not.toHaveBeenCalled()
    expect(actions.hide).not.toHaveBeenCalled()
    expect(stats.get()).toMatchObject({ received: 3, ignored: 3 })
  })

  it('handles each notification only once', async () => {
    engine.enqueue(request('not_dup', WL))
    engine.enqueue(request('not_dup', WL))
    await flush(engine)
    expect(actions.invite).toHaveBeenCalledTimes(1)
    expect(stats.get().received).toBe(1)
  })

  it('logs an error and leaves the request when not in an instance', async () => {
    presence.applyCurrentUser({ id: 'usr_me', displayName: 'Me', status: 'ask me', location: 'offline' })
    engine.enqueue(request('not_e', WL))
    await flush(engine)
    expect(actions.invite).not.toHaveBeenCalled()
    expect(activity.recent(1)[0]).toMatchObject({ action: 'ERROR', result: 'failed' })
    expect(stats.get().errors).toBe(1)
  })

  it('treats "already responded" as handled elsewhere', async () => {
    actions.declineWithMessage.mockRejectedValueOnce(new ApiError(400, "You've already responded to that request."))
    engine.enqueue(request('not_f', BL))
    await flush(engine)
    expect(activity.recent(1)[0]).toMatchObject({ action: 'IGNORED' })
  })

  it('declines silently when reason messages are off', async () => {
    settings.automation.sendReasonMessages = false
    engine.enqueue(request('not_g', BL))
    await flush(engine)
    expect(actions.declineWithMessage).not.toHaveBeenCalled()
    expect(actions.hide).toHaveBeenCalledWith('not_g')
    expect(activity.recent(1)[0]).toMatchObject({ action: 'REJECTED' })
  })

  it('ignores requests while the status is not Ask Me', async () => {
    presence.applyCurrentUser({ id: 'usr_me', displayName: 'Me', status: 'join me', location: LOCATION })
    engine.enqueue(request('not_h', BL))
    await flush(engine)
    expect(actions.declineWithMessage).not.toHaveBeenCalled()
    expect(activity.recent(1)[0]).toMatchObject({ action: 'IGNORED', rule: 'STATUS_NOT_ASK_ME' })
  })
})
