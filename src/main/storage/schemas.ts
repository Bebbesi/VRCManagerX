import { z } from 'zod'
import { defaultSettings, REASON_MAX_LENGTH, SLOT_MAX, SLOT_MIN } from '@shared/defaults'
import type { ManagedUser, Settings, Stats } from '@shared/types'
import { hasControlChars, isUserId } from '@shared/validation'

// Every persisted field falls back to its default on its own, so a single bad value
// never wipes the rest of the user's configuration.

const d = defaultSettings()

export const reasonTextSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(REASON_MAX_LENGTH, `Message must be at most ${REASON_MAX_LENGTH} characters`)
  .refine((v) => !hasControlChars(v), 'Message contains invalid characters')

export const slotSchema = z.number().int().min(SLOT_MIN).max(SLOT_MAX)

const reason = (fallback: { text: string; slot: number }) =>
  z.object({ text: reasonTextSchema.catch(fallback.text), slot: slotSchema.catch(fallback.slot) }).catch(fallback)

const contactSchema = z
  .string()
  .trim()
  .max(80)
  .refine((v) => !hasControlChars(v))

export const settingsSchema = z
  .object({
    automation: z
      .object({
        enabled: z.boolean().catch(d.automation.enabled),
        trustedOnly: z.boolean().catch(d.automation.trustedOnly),
        autoAcceptWhitelist: z.boolean().catch(d.automation.autoAcceptWhitelist),
        autoRejectBlacklist: z.boolean().catch(d.automation.autoRejectBlacklist),
        onlyWhenAskMe: z.boolean().catch(d.automation.onlyWhenAskMe),
        sendReasonMessages: z.boolean().catch(d.automation.sendReasonMessages),
        processPendingOnStartup: z.boolean().catch(d.automation.processPendingOnStartup),
        pendingMaxAgeMinutes: z.number().int().min(1).max(1440).catch(d.automation.pendingMaxAgeMinutes)
      })
      .catch(d.automation),
    reasons: z
      .object({
        whitelistAccept: reason(d.reasons.whitelistAccept),
        blacklistReject: reason(d.reasons.blacklistReject),
        trustedOnlyReject: reason(d.reasons.trustedOnlyReject)
      })
      .catch(d.reasons),
    app: z
      .object({
        theme: z.enum(['dark', 'light', 'system']).catch(d.app.theme),
        minimizeToTray: z.boolean().catch(d.app.minimizeToTray),
        startWithWindows: z.boolean().catch(d.app.startWithWindows),
        showNotifications: z.boolean().catch(d.app.showNotifications),
        rememberSession: z.boolean().catch(d.app.rememberSession),
        userAgentContact: contactSchema.catch(d.app.userAgentContact)
      })
      .catch(d.app)
  })
  .catch(d)

/** Parses persisted settings, repairing invalid values. */
export function parseSettings(raw: unknown): Settings {
  const settings = settingsSchema.parse(raw) as Settings
  // Both decline reasons live in the same `requestResponse` collection and must not share a slot.
  if (settings.reasons.blacklistReject.slot === settings.reasons.trustedOnlyReject.slot) {
    settings.reasons.blacklistReject.slot = d.reasons.blacklistReject.slot
    settings.reasons.trustedOnlyReject.slot = d.reasons.trustedOnlyReject.slot
  }
  return settings
}

/** Strict schema for settings changes coming from the UI. */
export const settingsPatchSchema = z
  .object({
    automation: z
      .object({
        enabled: z.boolean(),
        trustedOnly: z.boolean(),
        autoAcceptWhitelist: z.boolean(),
        autoRejectBlacklist: z.boolean(),
        onlyWhenAskMe: z.boolean(),
        sendReasonMessages: z.boolean(),
        processPendingOnStartup: z.boolean(),
        pendingMaxAgeMinutes: z.number().int().min(1).max(1440)
      })
      .partial()
      .strict(),
    reasons: z
      .object({
        whitelistAccept: z.object({ text: reasonTextSchema, slot: slotSchema }).partial().strict(),
        blacklistReject: z.object({ text: reasonTextSchema, slot: slotSchema }).partial().strict(),
        trustedOnlyReject: z.object({ text: reasonTextSchema, slot: slotSchema }).partial().strict()
      })
      .partial()
      .strict(),
    app: z
      .object({
        theme: z.enum(['dark', 'light', 'system']),
        minimizeToTray: z.boolean(),
        startWithWindows: z.boolean(),
        showNotifications: z.boolean(),
        rememberSession: z.boolean(),
        userAgentContact: contactSchema
      })
      .partial()
      .strict()
  })
  .partial()
  .strict()

// ---------------------------------------------------------------------------

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => v.startsWith('https://'), 'Must be an https URL')

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((v) => !hasControlChars(v))

export const noteSchema = z
  .string()
  .max(500)
  .refine((v) => !hasControlChars(v.replace(/[\n\t]/g, ' ')))

export const userIdSchema = z.string().refine(isUserId, 'Invalid VRChat user id')

export const managedUserSchema = z.object({
  id: userIdSchema,
  displayName: displayNameSchema,
  username: z.string().max(64).optional(),
  avatarUrl: httpsUrl.optional(),
  note: noteSchema.optional(),
  list: z.enum(['whitelist', 'blacklist']),
  addedAt: isoDate,
  updatedAt: isoDate,
  lastRequestAt: isoDate.optional()
})

export const listsFileSchema = z.object({
  version: z.literal(1),
  users: z.array(z.unknown())
})

/** Parses the lists file, dropping invalid entries and duplicates. */
export function parseLists(raw: unknown): { users: ManagedUser[]; dropped: number } {
  const file = listsFileSchema.parse(raw)
  const byId = new Map<string, ManagedUser>()
  let dropped = 0
  for (const item of file.users) {
    const parsed = managedUserSchema.safeParse(item)
    if (!parsed.success) {
      dropped++
      continue
    }
    const user = parsed.data as ManagedUser
    const existing = byId.get(user.id)
    if (existing) {
      dropped++
      // Keep the most recently edited copy of a duplicated user.
      if (Date.parse(user.updatedAt) > Date.parse(existing.updatedAt)) byId.set(user.id, user)
      continue
    }
    byId.set(user.id, user)
  }
  return { users: [...byId.values()], dropped }
}

export const statsSchema = z.object({
  since: isoDate,
  received: z.number().int().min(0).catch(0),
  accepted: z.number().int().min(0).catch(0),
  rejected: z.number().int().min(0).catch(0),
  ignored: z.number().int().min(0).catch(0),
  errors: z.number().int().min(0).catch(0)
})

export function parseStats(raw: unknown): Stats {
  return statsSchema.parse(raw)
}

export const processedFileSchema = z.object({
  entries: z.array(z.tuple([z.string().max(128), z.number()]))
})
