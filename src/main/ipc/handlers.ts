import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { Result } from '@shared/types'
import type { AppController } from '../app/controller'
import { LoginError } from '../auth/login'
import { safeErrorMessage } from '../logging/redact'
import { displayNameSchema, noteSchema, settingsPatchSchema, userIdSchema } from '../storage/schemas'
import { RateLimitedError, NetworkError, UnauthorizedError } from '../vrchat/errors'

const listKind = z.enum(['whitelist', 'blacklist'])

const lookupResultSchema = z.object({
  id: userIdSchema,
  displayName: z.string().max(128),
  avatarUrl: z
    .string()
    .max(2048)
    .refine((v) => v.startsWith('https://'))
    .optional(),
  isFriend: z.boolean().optional(),
  status: z.string().max(32).optional(),
  statusDescription: z.string().max(256).optional(),
  list: listKind.optional()
})

const schemas = {
  login: z.object({
    username: z.string().trim().min(1, 'Enter your username or email.').max(256),
    password: z.string().min(1, 'Enter your password.').max(1024),
    remember: z.boolean()
  }),
  verify2fa: z.object({ method: z.enum(['totp', 'otp', 'emailOtp']), code: z.string().max(32) }),
  addUser: z.object({ user: lookupResultSchema, list: listKind, note: noteSchema.optional(), move: z.boolean().optional() }),
  updateUser: z.object({ note: noteSchema.optional(), displayName: displayNameSchema.optional() }).strict(),
  activityQuery: z.object({
    filter: z.enum(['all', 'accepted', 'rejected', 'ignored', 'whitelist', 'blacklist', 'errors']),
    search: z.string().max(128).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional()
  }),
  friends: z.object({ offline: z.boolean(), offset: z.number().int().min(0).max(100_000) })
}

/** Only the app's own window may call into the main process. */
type Guard = (event: IpcMainInvokeEvent) => boolean

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

function fail(err: unknown): Result<never> {
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? 'Invalid input.', code: 'invalid' }
  if (err instanceof LoginError) return { ok: false, error: err.message, code: 'login' }
  if (err instanceof UnauthorizedError) return { ok: false, error: 'Your VRChat session expired. Please sign in again.', code: 'unauthorized' }
  if (err instanceof RateLimitedError) {
    return { ok: false, error: `VRChat is rate limiting requests. Try again in ${Math.ceil(err.retryAfterMs / 1000)}s.`, code: 'rate_limited' }
  }
  if (err instanceof NetworkError) return { ok: false, error: err.message, code: 'network' }
  return { ok: false, error: safeErrorMessage(err), code: 'error' }
}

export function registerIpc(controller: AppController, isTrustedSender: Guard): void {
  const handle = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      return fn(...args)
    })
  }
  const safe = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>) =>
    handle(channel, async (...args) => {
      try {
        return ok(await fn(...args))
      } catch (err) {
        return fail(err)
      }
    })

  handle(IPC.snapshot, () => controller.snapshot())

  safe(IPC.login, (input) => {
    const { username, password, remember } = schemas.login.parse(input)
    return controller.login(username, password, remember)
  })
  safe(IPC.verify2fa, (input) => {
    const { method, code } = schemas.verify2fa.parse(input)
    return controller.verifyTwoFactor(method, code)
  })
  handle(IPC.cancel2fa, () => controller.cancelTwoFactor())
  handle(IPC.logout, () => controller.logout())

  safe(IPC.updateSettings, (patch) => controller.updateSettings(settingsPatchSchema.parse(patch)))
  safe(IPC.resetSettings, (section) => controller.resetSettings(z.enum(['reasons', 'all']).parse(section)))

  handle(IPC.listUsers, () => controller.listUsers())
  safe(IPC.addUser, (input) => {
    const { user, list, note, move } = schemas.addUser.parse(input)
    return controller.addUser(user, list, note, move ?? false)
  })
  safe(IPC.removeUser, (id) => {
    controller.removeUser(userIdSchema.parse(id))
    return true as const
  })
  safe(IPC.moveUser, (id, to) => controller.moveUser(userIdSchema.parse(id), listKind.parse(to)))
  safe(IPC.updateUser, (id, patch) => controller.updateUser(userIdSchema.parse(id), schemas.updateUser.parse(patch)))
  safe(IPC.refreshUser, (id) => controller.refreshUser(userIdSchema.parse(id)))
  safe(IPC.lookupUsers, (query) => controller.lookupUsers(z.string().max(256).parse(query)))
  safe(IPC.listFriends, (input) => {
    const { offline, offset } = schemas.friends.parse(input)
    return controller.listFriends(offline, offset)
  })

  handle(IPC.queryActivity, (q) => controller.queryActivity(schemas.activityQuery.parse(q)))
  handle(IPC.clearActivity, () => controller.clearActivity())
  safe(IPC.exportActivity, (format) => controller.exportActivity(z.enum(['csv', 'json']).parse(format)))
  handle(IPC.resetStats, () => controller.resetStats())

  safe(IPC.syncSlots, async () => {
    await controller.syncSlots()
    return true as const
  })
  handle(IPC.reconnect, () => controller.reconnect())
  handle(IPC.openDataFolder, () => controller.openDataFolder())
  handle(IPC.openExternal, (url) => {
    const parsed = new URL(z.string().max(2048).parse(url))
    // Only VRChat pages may be opened from the UI.
    if (parsed.protocol === 'https:' && (parsed.hostname === 'vrchat.com' || parsed.hostname.endsWith('.vrchat.com'))) {
      return shell.openExternal(parsed.href)
    }
    return undefined
  })
  ipcMain.on(IPC.reportError, (event, message) => {
    if (!isTrustedSender(event as unknown as IpcMainInvokeEvent) || typeof message !== 'string') return
    controller.errorLog.write('renderer', safeErrorMessage(message.slice(0, 4000)))
  })
  ipcMain.on(IPC.networkOnline, (event) => {
    if (isTrustedSender(event as unknown as IpcMainInvokeEvent)) controller.networkRestored()
  })
}
