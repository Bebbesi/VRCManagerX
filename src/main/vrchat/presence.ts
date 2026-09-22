import type { PresenceState } from '@shared/types'
import { isInvitableLocation } from '@shared/validation'
import { isRecord, type VrcCurrentUser } from './types'

/**
 * Tracks the logged-in account's status and current instance from the login response
 * and the pipeline's `user-update` / `user-location` events. Accepting a request means
 * inviting the requester to this instance.
 */
export class PresenceTracker {
  private status = ''
  private location: string | undefined
  private travelingTo: string | undefined
  private updatedAt = 0

  constructor(private readonly onChange: () => void) {}

  reset(): void {
    this.status = ''
    this.location = undefined
    this.travelingTo = undefined
    this.updatedAt = 0
    this.onChange()
  }

  applyCurrentUser(user: VrcCurrentUser): void {
    this.status = user.status ?? user.presence?.status ?? this.status
    const presence = user.presence
    const fromPresence =
      presence?.world && presence.instance
        ? presence.instance.startsWith('wrld_')
          ? presence.instance
          : `${presence.world}:${presence.instance}`
        : undefined
    const fromIds = user.worldId && user.instanceId ? `${user.worldId}:${user.instanceId}` : undefined
    this.location = [user.location, fromPresence, fromIds].find((l) => isInvitableLocation(l))
    const travelPresence =
      presence?.travelingToWorld && presence.travelingToInstance
        ? `${presence.travelingToWorld}:${presence.travelingToInstance}`
        : undefined
    this.travelingTo = [user.travelingToLocation, travelPresence].find((l) => isInvitableLocation(l))
    this.updatedAt = Date.now()
    this.onChange()
  }

  /** Handles pipeline events about ourselves. Returns true if the event was relevant. */
  applyPipelineEvent(type: string, content: unknown, ownUserId: string): boolean {
    if (!isRecord(content)) return false
    if (typeof content.userId === 'string' && content.userId !== ownUserId) return false
    if (type === 'user-update') {
      const user = isRecord(content.user) ? content.user : null
      if (user && typeof user.status === 'string') {
        this.status = user.status
        this.updatedAt = Date.now()
        this.onChange()
      }
      return true
    }
    if (type === 'user-location') {
      const location = typeof content.location === 'string' ? content.location : undefined
      const traveling = typeof content.travelingToLocation === 'string' ? content.travelingToLocation : undefined
      this.location = isInvitableLocation(location) ? location : undefined
      this.travelingTo = isInvitableLocation(traveling) ? traveling : undefined
      this.updatedAt = Date.now()
      this.onChange()
      return true
    }
    return false
  }

  get currentStatus(): string {
    return this.status
  }

  get ageMs(): number {
    return this.updatedAt ? Date.now() - this.updatedAt : Number.POSITIVE_INFINITY
  }

  /** The instance to invite requesters to: current instance, or the one we're travelling to. */
  inviteLocation(): string | undefined {
    return this.location ?? this.travelingTo
  }

  snapshot(): PresenceState {
    const loc = this.inviteLocation()
    return {
      status: this.status || 'unknown',
      inInstance: Boolean(loc),
      worldId: loc?.split(':')[0]
    }
  }
}
