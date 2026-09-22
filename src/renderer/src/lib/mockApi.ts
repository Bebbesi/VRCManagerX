// In-browser fake backend used ONLY by `npm run preview:ui` to design the UI without
// Electron or a VRChat account. It is compiled out of the real app (__UI_PREVIEW__ = false).
import { defaultSettings, REASON_MESSAGE_TYPE } from '@shared/defaults'
import type { VrcmxApi } from '@shared/ipc'
import type {
  ActivityEntry,
  AppSnapshot,
  ManagedUser,
  ReasonKey,
  Result,
  Settings,
  SlotSyncState,
  Toast,
  UserLookupResult
} from '@shared/types'

const uid = (n: number) => `usr_${String(n).padStart(8, '0')}-1a2b-4c3d-8e9f-${String(n * 7919).padStart(12, '0')}`
const now = Date.now()
const iso = (msAgo: number) => new Date(now - msAgo).toISOString()

export function createMockApi(): VrcmxApi {
  let settings: Settings = defaultSettings()
  let users: ManagedUser[] = [
    ['Nyx', 'whitelist', 'Best friend, always welcome'],
    ['Kairo_VR', 'whitelist', undefined],
    ['Lumi', 'whitelist', 'From the dance club'],
    ['Pixel Fox', 'whitelist', undefined],
    ['Void Walker', 'blacklist', 'Crashed the instance twice'],
    ['xX_Spammer_Xx', 'blacklist', undefined]
  ].map(([name, list, note], i) => ({
    id: uid(i + 1),
    displayName: name as string,
    list: list as ManagedUser['list'],
    note: note as string | undefined,
    addedAt: iso((i + 3) * 86_400_000),
    updatedAt: iso((i + 1) * 3_600_000),
    lastRequestAt: i % 2 ? iso(i * 1_800_000 + 60_000) : undefined
  }))
  let loggedIn = false
  let stats = { since: iso(9 * 86_400_000), received: 48, accepted: 21, rejected: 9, ignored: 17, errors: 1 }
  const activity: ActivityEntry[] = []
  const listeners = { snapshot: new Set<(s: AppSnapshot) => void>(), users: new Set<(u: ManagedUser[]) => void>(), activity: new Set<(e: ActivityEntry) => void>(), toast: new Set<(t: Toast) => void>() }

  const seed: Array<[string, number, ActivityEntry['listStatus'], ActivityEntry['action'], ActivityEntry['rule']]> = [
    ['Nyx', 1, 'whitelist', 'ACCEPTED', 'WHITELIST'],
    ['Void Walker', 5, 'blacklist', 'REJECTED', 'BLACKLIST'],
    ['Stranger Danger', 40, 'unknown', 'IGNORED', 'UNKNOWN'],
    ['Lumi', 3, 'whitelist', 'ACCEPTED', 'WHITELIST'],
    ['Random Person', 41, 'unknown', 'IGNORED', 'UNKNOWN'],
    ['Kairo_VR', 2, 'whitelist', 'ERROR', 'WHITELIST'],
    ['xX_Spammer_Xx', 6, 'blacklist', 'REJECTED', 'BLACKLIST']
  ]
  seed.forEach(([name, n, list, action, rule], i) => {
    activity.push({
      id: `seed-${i}`,
      timestamp: iso((seed.length - i) * 23 * 60_000),
      kind: 'invite',
      notificationId: `not_${i}`,
      user: { id: uid(n), displayName: name },
      listStatus: list,
      rule,
      action,
      reason:
        action === 'ACCEPTED'
          ? settings.reasons.whitelistAccept.text
          : action === 'REJECTED'
            ? settings.reasons.blacklistReject.text
            : action === 'ERROR'
              ? 'Accept failed; the request was left untouched.'
              : 'User is not on any list; left for manual handling.',
      mode: 'Standard (Ask Me only)',
      result: action === 'ERROR' ? 'failed' : action === 'IGNORED' ? 'skipped' : 'success',
      detail: action === 'ERROR' ? 'You are not in a VRChat instance right now, so there is nowhere to invite them.' : undefined
    })
  })

  const slots = (): SlotSyncState[] =>
    (Object.keys(settings.reasons) as ReasonKey[]).map((key, i) => ({
      key,
      messageType: REASON_MESSAGE_TYPE[key],
      slot: settings.reasons[key].slot,
      desiredText: settings.reasons[key].text,
      currentText: i === 2 ? 'Sorry, busy right now!' : settings.reasons[key].text,
      status: !settings.automation.sendReasonMessages ? 'disabled' : i === 2 ? 'cooldown' : 'synced',
      cooldownMinutes: i === 2 ? 37 : undefined,
      retryAt: i === 2 ? new Date(Date.now() + 37 * 60_000).toISOString() : undefined
    }))

  const snapshot = (): AppSnapshot => ({
    version: '1.0.0',
    auth: loggedIn
      ? {
          phase: 'logged_in',
          secureStorageAvailable: true,
          account: { id: uid(99), displayName: 'DemoOwner', username: 'owner', status: 'ask me', statusDescription: 'Ask before joining' }
        }
      : { phase: authPhase, secureStorageAvailable: true, twoFactorMethods: authPhase === 'two_factor' ? ['totp', 'otp'] : undefined },
    connection: loggedIn
      ? { phase: 'connected', since: iso(42 * 60_000), lastEventAt: iso(15_000) }
      : { phase: 'disconnected', since: iso(0) },
    presence: loggedIn ? { status: 'ask me', inInstance: true, worldId: 'wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd' } : { status: 'unknown', inInstance: false },
    settings: structuredClone(settings),
    stats,
    counts: { whitelist: users.filter((u) => u.list === 'whitelist').length, blacklist: users.filter((u) => u.list === 'blacklist').length },
    slots: slots(),
    startupWarnings: []
  })
  let authPhase: 'logged_out' | 'two_factor' = 'logged_out'

  const emit = () => listeners.snapshot.forEach((l) => l(snapshot()))
  const emitUsers = () => listeners.users.forEach((l) => l([...users]))
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const fakeResults: UserLookupResult[] = [
    { id: uid(20), displayName: 'Aurora', isFriend: true, status: 'active' },
    { id: uid(21), displayName: 'Aurora_Bloom', isFriend: false, status: 'ask me' },
    { id: uid(1), displayName: 'Nyx', isFriend: true, status: 'join me' },
    { id: uid(5), displayName: 'Void Walker', isFriend: true, status: 'busy' }
  ]

  return {
    snapshot: async () => snapshot(),
    login: async () => {
      await wait(700)
      authPhase = 'two_factor'
      emit()
      return ok({ kind: 'two_factor', methods: ['totp', 'otp'] })
    },
    verify2fa: async () => {
      await wait(600)
      loggedIn = true
      emit()
      return ok({ kind: 'logged_in', account: snapshot().auth.account! })
    },
    cancel2fa: async () => {
      authPhase = 'logged_out'
      emit()
    },
    logout: async () => {
      loggedIn = false
      authPhase = 'logged_out'
      emit()
    },
    updateSettings: async (patch) => {
      settings = {
        automation: { ...settings.automation, ...patch.automation },
        reasons: {
          whitelistAccept: { ...settings.reasons.whitelistAccept, ...patch.reasons?.whitelistAccept },
          blacklistReject: { ...settings.reasons.blacklistReject, ...patch.reasons?.blacklistReject },
          trustedOnlyReject: { ...settings.reasons.trustedOnlyReject, ...patch.reasons?.trustedOnlyReject }
        },
        app: { ...settings.app, ...patch.app }
      }
      emit()
      return ok(structuredClone(settings))
    },
    resetSettings: async (section) => {
      settings = section === 'all' ? defaultSettings() : { ...settings, reasons: defaultSettings().reasons }
      emit()
      return ok(structuredClone(settings))
    },
    listUsers: async () => [...users],
    addUser: async ({ user, list, note, move }) => {
      const existing = users.find((u) => u.id === user.id)
      if (existing && (existing.list === list || !move)) return ok({ kind: 'conflict' as const, existing })
      const entry: ManagedUser = {
        id: user.id,
        displayName: user.displayName,
        list,
        note,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      users = [...users.filter((u) => u.id !== user.id), entry]
      emitUsers()
      emit()
      return ok({ kind: 'added' as const, user: entry })
    },
    removeUser: async (id) => {
      users = users.filter((u) => u.id !== id)
      emitUsers()
      emit()
      return ok(true as const)
    },
    moveUser: async (id, to) => {
      users = users.map((u) => (u.id === id ? { ...u, list: to } : u))
      emitUsers()
      emit()
      return ok(users.find((u) => u.id === id)!)
    },
    updateUser: async (id, patch) => {
      users = users.map((u) => (u.id === id ? { ...u, ...patch } : u))
      emitUsers()
      return ok(users.find((u) => u.id === id)!)
    },
    refreshUser: async (id) => {
      await wait(500)
      return ok(users.find((u) => u.id === id)!)
    },
    lookupUsers: async (query) => {
      await wait(400)
      const q = query.toLowerCase()
      return ok(
        fakeResults
          .filter((r) => r.displayName.toLowerCase().includes(q) || r.id === query)
          .map((r) => ({ ...r, list: users.find((u) => u.id === r.id)?.list }))
      )
    },
    listFriends: async ({ offline }) => {
      await wait(400)
      const list = offline ? fakeResults.slice(2) : fakeResults.filter((r) => r.isFriend)
      return ok({ users: list.map((r) => ({ ...r, isFriend: true, list: users.find((u) => u.id === r.id)?.list })), hasMore: false })
    },
    queryActivity: async (q) => {
      const filtered = activity
        .filter((e) => {
          switch (q.filter) {
            case 'accepted':
              return e.action === 'ACCEPTED'
            case 'rejected':
              return e.action === 'REJECTED'
            case 'ignored':
              return e.action === 'IGNORED'
            case 'whitelist':
              return e.listStatus === 'whitelist'
            case 'blacklist':
              return e.listStatus === 'blacklist'
            case 'errors':
              return e.action === 'ERROR'
            default:
              return true
          }
        })
        .filter((e) => !q.search || e.user?.displayName.toLowerCase().includes(q.search.toLowerCase()))
        .reverse()
      return { entries: filtered.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100)), total: filtered.length }
    },
    clearActivity: async () => {
      activity.length = 0
      listeners.activity.forEach((l) => l(activity[0]!))
    },
    exportActivity: async () => ok('C:\\Users\\you\\Documents\\vrcmanagerx-activity.csv'),
    resetStats: async () => {
      stats = { since: new Date().toISOString(), received: 0, accepted: 0, rejected: 0, ignored: 0, errors: 0 }
      emit()
    },
    syncSlots: async () => ok(true as const),
    reconnect: async () => undefined,
    openDataFolder: async () => undefined,
    openExternal: async () => undefined,
    networkOnline: () => undefined,
    reportError: (message) => console.error('[reportError]', message),
    onSnapshot: (cb) => (listeners.snapshot.add(cb), () => listeners.snapshot.delete(cb)),
    onUsers: (cb) => (listeners.users.add(cb), () => listeners.users.delete(cb)),
    onActivity: (cb) => (listeners.activity.add(cb), () => listeners.activity.delete(cb)),
    onToast: (cb) => (listeners.toast.add(cb), () => listeners.toast.delete(cb))
  }
}
