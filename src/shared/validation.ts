// Input validation helpers shared by the UI and the main process.
// The main process always re-validates: the renderer is never trusted.

/** Modern ids are `usr_<uuid>`; a few very old accounts use a 10-character legacy id. */
const USER_ID_RE = /^(usr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9A-Za-z]{10})$/
const PROFILE_URL_RE = /^https?:\/\/(?:www\.)?vrchat\.com\/home\/user\/([^/?#\s]+)/i
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/

export function isUserId(value: string): boolean {
  return USER_ID_RE.test(value)
}

/** Extracts a user id from a raw id or a vrchat.com profile link. */
export function parseUserReference(input: string): string | null {
  const trimmed = input.trim()
  if (isUserId(trimmed)) return trimmed
  const match = PROFILE_URL_RE.exec(trimmed)
  if (match?.[1] && isUserId(match[1])) return match[1]
  return null
}

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS_RE.test(value)
}

/** Opaque VRChat ids used in URL paths (notification ids etc.). */
export function isSafePathId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

/** A full instance location (`wrld_…:instance`) that can be used as an invite target. */
export function isInvitableLocation(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^wrld_[A-Za-z0-9-]+:[^\s]+$/.test(value)
}

export function validateTwoFactorCode(method: 'totp' | 'otp' | 'emailOtp', code: string): string | null {
  const c = code.replace(/\s+/g, '')
  if (method === 'otp') return /^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(c) ? null : 'Recovery codes look like "abcd-1234".'
  return /^\d{6}$/.test(c) ? null : 'Enter the 6-digit code.'
}
