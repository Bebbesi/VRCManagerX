import type { ReasonKey } from '@shared/types'
import { ApiError } from '../vrchat/errors'
import type { InviteActions } from '../vrchat/inviteActions'
import type { MessageSlotSync } from '../vrchat/messageSlots'
import type { PresenceTracker } from '../vrchat/presence'

/** A failure the user can understand and act on; the request is left untouched. */
export class AutomationError extends Error {}

/** The request was already answered elsewhere (in-game, website, another tool). */
export class AlreadyHandledError extends Error {}

export interface HandlerResult {
  /** The message VRChat delivered to the requester (or a note when none was sent). */
  reasonText: string
  warning?: string
}

interface Deps {
  actions: InviteActions
  slots: MessageSlotSync
  presence: PresenceTracker
  refreshPresence: () => Promise<void>
}

/** Accept = invite the requester to the instance we are in, with the whitelist reason. */
export class AcceptHandler {
  constructor(private readonly deps: Deps) {}

  async run(notificationId: string, userId: string): Promise<HandlerResult> {
    const { actions, slots, presence, refreshPresence } = this.deps
    let location = presence.inviteLocation()
    if (!location) {
      await refreshPresence()
      location = presence.inviteLocation()
    }
    if (!location) {
      throw new AutomationError('You are not in a VRChat instance right now, so there is nowhere to invite them.')
    }
    const slot = slots.slotFor('whitelistAccept')
    try {
      await actions.invite(userId, location, slot)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        throw new AutomationError('VRChat refused the invite (you must be friends with this user).')
      }
      throw err
    }
    const warning = await hideQuietly(actions, notificationId)
    return {
      reasonText: slot === undefined ? 'Invite sent without a message (reason messages are off).' : slots.textFor('whitelistAccept'),
      warning
    }
  }
}

/** Reject = decline the request with the matching reason, then clear the notification. */
export class RejectHandler {
  constructor(private readonly deps: Deps) {}

  async run(notificationId: string, reason: ReasonKey): Promise<HandlerResult> {
    const { actions, slots } = this.deps
    const slot = slots.slotFor(reason)
    if (slot !== undefined) {
      try {
        await actions.declineWithMessage(notificationId, slot)
      } catch (err) {
        if (err instanceof ApiError && err.status === 400 && /already responded/i.test(err.message)) {
          throw new AlreadyHandledError('The request was already answered in VRChat.')
        }
        throw err
      }
    }
    const warning = await hideQuietly(actions, notificationId)
    return {
      reasonText: slot === undefined ? 'Declined silently (reason messages are off).' : slots.textFor(reason),
      warning
    }
  }
}

async function hideQuietly(actions: InviteActions, notificationId: string): Promise<string | undefined> {
  try {
    await actions.hide(notificationId)
    return undefined
  } catch {
    return 'The action succeeded but the notification could not be cleared from your list.'
  }
}
