import { isInvitableLocation, isSafePathId, isUserId } from '@shared/validation'
import type { VrcHttpClient } from './http'

/**
 * The only three write operations the automation performs, all documented in the
 * community VRChat API specification:
 *
 *  accept  -> POST /invite/{userId}                      { instanceId, messageSlot? }
 *  decline -> POST /invite/{notificationId}/response     { responseSlot }  (requestResponse slot)
 *  clear   -> PUT  /auth/user/notifications/{id}/hide
 */
export class InviteActions {
  constructor(private readonly http: VrcHttpClient) {}

  /** Accepting a request = sending the requester an invite to our current instance. */
  async invite(userId: string, location: string, messageSlot?: number): Promise<void> {
    if (!isUserId(userId)) throw new Error('Invalid user id.')
    if (!isInvitableLocation(location)) throw new Error('Invalid instance location.')
    const body: { instanceId: string; messageSlot?: number } = { instanceId: location }
    if (messageSlot !== undefined) body.messageSlot = messageSlot
    await this.http.post(`/invite/${encodeURIComponent(userId)}`, body)
  }

  /** Declines an invite request, sending the text stored in `requestResponse` slot `responseSlot`. */
  async declineWithMessage(notificationId: string, responseSlot: number): Promise<void> {
    if (!isSafePathId(notificationId)) throw new Error('Invalid notification id.')
    await this.http.post(`/invite/${encodeURIComponent(notificationId)}/response`, { responseSlot })
  }

  /** Removes the request from the notification list (in-game too). */
  async hide(notificationId: string): Promise<void> {
    if (!isSafePathId(notificationId)) throw new Error('Invalid notification id.')
    await this.http.put(`/auth/user/notifications/${encodeURIComponent(notificationId)}/hide`)
  }
}
