// Subsets of the VRChat API objects this app uses, based on the community OpenAPI
// specification (github.com/vrchatapi/specification). Every field is treated as optional
// at runtime and read defensively, since the API is undocumented and may change.

export interface VrcImageFields {
  iconUrl?: string
  userIcon?: string
  profilePicOverride?: string
  profilePicOverrideThumbnail?: string
  currentAvatarThumbnailImageUrl?: string
  currentAvatarImageUrl?: string
}

export interface VrcCurrentUserPresence {
  status?: string | null
  world?: string | null
  instance?: string | null
  travelingToWorld?: string | null
  travelingToInstance?: string | null
}

export interface VrcCurrentUser extends VrcImageFields {
  id: string
  displayName: string
  username?: string
  status?: string
  statusDescription?: string
  location?: string
  worldId?: string
  instanceId?: string
  travelingToLocation?: string
  presence?: VrcCurrentUserPresence
}

export interface VrcRequiresTwoFactorAuth {
  requiresTwoFactorAuth: string[]
}

export interface VrcUser extends VrcImageFields {
  id: string
  displayName: string
  status?: string
  statusDescription?: string
  isFriend?: boolean
}

export interface VrcNotification {
  id: string
  type: string
  senderUserId: string
  senderUsername?: string | null
  created_at: string
  message?: string
  /** JSON-encoded string from the REST API, an object from the websocket. */
  details?: unknown
  seen?: boolean
}

export interface VrcInviteMessage {
  id: string
  slot: number
  message: string
  messageType: string
  canBeUpdated: boolean
  remainingCooldownMinutes: number
  updatedAt?: string
}

export interface VrcVerify2FAResult {
  verified: boolean
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Picks the best available profile image; only https URLs are accepted. */
export function pickAvatarUrl(user: VrcImageFields): string | undefined {
  const candidates = [
    user.iconUrl,
    user.userIcon,
    user.profilePicOverrideThumbnail,
    user.profilePicOverride,
    user.currentAvatarThumbnailImageUrl,
    user.currentAvatarImageUrl
  ]
  for (const url of candidates) {
    if (typeof url === 'string' && url.startsWith('https://') && url.length <= 2048) return url
  }
  return undefined
}

export function asNotification(value: unknown): VrcNotification | null {
  if (!isRecord(value)) return null
  const { id, type, senderUserId, created_at } = value
  if (typeof id !== 'string' || typeof type !== 'string' || typeof senderUserId !== 'string') return null
  return {
    id,
    type,
    senderUserId,
    senderUsername: typeof value.senderUsername === 'string' ? value.senderUsername : null,
    created_at: typeof created_at === 'string' ? created_at : new Date().toISOString(),
    message: typeof value.message === 'string' ? value.message : undefined,
    details: value.details,
    seen: typeof value.seen === 'boolean' ? value.seen : undefined
  }
}
