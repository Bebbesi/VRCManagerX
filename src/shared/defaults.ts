import type { InviteMessageType, ReasonKey, Settings } from './types'

export const APP_NAME = 'VRCManagerX'

export const DEFAULT_REASONS: Record<ReasonKey, string> = {
  whitelistAccept: 'Accepted automatically: User Whitelisted',
  blacklistReject: 'This user is not accepting invites',
  trustedOnlyReject: 'User is not accepting request at this moment'
}

/**
 * VRChat delivers invite/response texts through per-account message slots (0-11).
 * Accepting a request = sending an invite, which uses the `message` collection.
 * Declining a request uses the `requestResponse` collection.
 */
export const REASON_MESSAGE_TYPE: Record<ReasonKey, InviteMessageType> = {
  whitelistAccept: 'message',
  blacklistReject: 'requestResponse',
  trustedOnlyReject: 'requestResponse'
}

export const REASON_LABELS: Record<ReasonKey, string> = {
  whitelistAccept: 'Whitelist Accept Reason',
  blacklistReject: 'Blacklist Reject Reason',
  trustedOnlyReject: 'Trusted Only Reject Reason'
}

/** Conservative limit matching the in-game invite message editor. */
export const REASON_MAX_LENGTH = 64
export const SLOT_MIN = 0
export const SLOT_MAX = 11

export function defaultSettings(): Settings {
  return {
    automation: {
      enabled: true,
      trustedOnly: false,
      autoAcceptWhitelist: true,
      autoRejectBlacklist: true,
      onlyWhenAskMe: true,
      sendReasonMessages: true,
      processPendingOnStartup: true,
      pendingMaxAgeMinutes: 10
    },
    reasons: {
      whitelistAccept: { text: DEFAULT_REASONS.whitelistAccept, slot: 11 },
      blacklistReject: { text: DEFAULT_REASONS.blacklistReject, slot: 10 },
      trustedOnlyReject: { text: DEFAULT_REASONS.trustedOnlyReject, slot: 11 }
    },
    app: {
      theme: 'dark',
      minimizeToTray: true,
      startWithWindows: false,
      showNotifications: true,
      rememberSession: true,
      userAgentContact: ''
    }
  }
}
