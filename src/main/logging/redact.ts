// Removes anything that could be a credential from text before it is logged or shown.

const PATTERNS: Array<[RegExp, string]> = [
  [/authcookie_[A-Za-z0-9-]+/g, 'authcookie_[REDACTED]'],
  [/(authToken=)[^&\s"']+/gi, '$1[REDACTED]'],
  [/(\bauth=)[^;\s"']+/gi, '$1[REDACTED]'],
  [/(twoFactorAuth=)[^;\s"']+/gi, '$1[REDACTED]'],
  [/(Basic\s+)[A-Za-z0-9+/=]{8,}/g, '$1[REDACTED]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1[REDACTED]'],
  [/("?(?:password|passwd|pwd|code|token|cookie)"?\s*[:=]\s*)("[^"]*"|[^\s,;}]+)/gi, '$1[REDACTED]']
]

export function redact(text: string): string {
  let out = text
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out
}

/** Turns an unknown error into a short, safe, single-line message. */
export function safeErrorMessage(err: unknown, fallback = 'Unexpected error'): string {
  let message: string
  if (err instanceof Error) message = err.message
  else if (typeof err === 'string') message = err
  else message = fallback
  message = redact(message).replace(/\s+/g, ' ').trim()
  if (!message) message = fallback
  return message.length > 300 ? `${message.slice(0, 297)}...` : message
}
