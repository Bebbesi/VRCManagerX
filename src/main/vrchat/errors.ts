// Typed failures of the VRChat API client. Messages are user-facing and never contain secrets.

export class VrcError extends Error {
  constructor(
    message: string,
    readonly code: 'unauthorized' | 'rate_limited' | 'network' | 'api' | 'invalid_response'
  ) {
    super(message)
    this.name = 'VrcError'
  }
}

/** 401: the session is missing, expired or was revoked. */
export class UnauthorizedError extends VrcError {
  constructor(message = 'Your VRChat session is no longer valid.') {
    super(message, 'unauthorized')
  }
}

/** 429: VRChat asked us to slow down. */
export class RateLimitedError extends VrcError {
  constructor(
    readonly retryAfterMs: number,
    message = 'VRChat is rate limiting requests. Waiting before trying again.',
    /** True for per-resource cooldowns (e.g. invite message slots) that do not block other calls. */
    readonly local = false
  ) {
    super(message, 'rate_limited')
  }
}

/** VRChat could not be reached (DNS, TLS, timeout, offline…). */
export class NetworkError extends VrcError {
  constructor(message = 'Unable to reach VRChat. Check your internet connection.') {
    super(message, 'network')
  }
}

/** Any other non-success response. */
export class ApiError extends VrcError {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message, 'api')
  }
}
