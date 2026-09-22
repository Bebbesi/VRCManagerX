import type { TwoFactorMethod } from '@shared/types'
import { validateTwoFactorCode } from '@shared/validation'
import { ApiError, RateLimitedError, UnauthorizedError } from '../vrchat/errors'
import type { VrcHttpClient } from '../vrchat/http'
import { isRecord, type VrcCurrentUser, type VrcVerify2FAResult } from '../vrchat/types'

export type LoginStep = { kind: 'logged_in'; user: VrcCurrentUser } | { kind: 'two_factor'; methods: TwoFactorMethod[] }

export class LoginError extends Error {}

const TWO_FACTOR_PATHS: Record<TwoFactorMethod, string> = {
  totp: '/auth/twofactorauth/totp/verify',
  emailOtp: '/auth/twofactorauth/emailotp/verify',
  otp: '/auth/twofactorauth/otp/verify'
}

/**
 * VRChat login: `GET /auth/user` with HTTP Basic credentials, optionally followed by a
 * 2FA verification. The password only lives in memory for the duration of this call
 * and is sent exclusively to api.vrchat.cloud over HTTPS.
 */
export class LoginService {
  private pendingMethods: TwoFactorMethod[] = []

  constructor(private readonly http: VrcHttpClient) {}

  async login(username: string, password: string): Promise<LoginStep> {
    // Start from a clean session but keep the "remember this device" 2FA cookie.
    this.http.clearAuthCookie()
    const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`, 'utf8').toString('base64')
    let response: unknown
    try {
      response = await this.http.get('/auth/user', { basicAuth: basic, expectUnauthorized: true, retries: 0 })
    } catch (err) {
      throw mapLoginError(err)
    }
    return this.interpret(response)
  }

  async verify(method: TwoFactorMethod, code: string): Promise<LoginStep> {
    if (!this.pendingMethods.includes(method) && !(method === 'otp' && this.pendingMethods.includes('totp'))) {
      throw new LoginError('This verification method is not available for this login.')
    }
    const problem = validateTwoFactorCode(method, code)
    if (problem) throw new LoginError(problem)
    const clean = code.replace(/\s+/g, '')
    let result: VrcVerify2FAResult | undefined
    try {
      result = await this.http.post<VrcVerify2FAResult>(TWO_FACTOR_PATHS[method], { code: clean }, { expectUnauthorized: true })
    } catch (err) {
      if (err instanceof UnauthorizedError) throw new LoginError('The login attempt expired. Please sign in again.')
      if (err instanceof ApiError && err.status === 400) throw new LoginError('That code is not valid.')
      throw mapLoginError(err)
    }
    if (!result?.verified) throw new LoginError('That code is not valid. Try again.')
    let response: unknown
    try {
      response = await this.http.get('/auth/user', { expectUnauthorized: true, retries: 1 })
    } catch (err) {
      throw mapLoginError(err)
    }
    return this.interpret(response)
  }

  cancel(): void {
    this.pendingMethods = []
    this.http.clearAuthCookie()
  }

  private interpret(response: unknown): LoginStep {
    if (isRecord(response) && Array.isArray(response.requiresTwoFactorAuth)) {
      const methods = response.requiresTwoFactorAuth.filter(
        (m): m is TwoFactorMethod => m === 'totp' || m === 'otp' || m === 'emailOtp'
      )
      if (!methods.length) throw new LoginError('VRChat requires a verification method this app does not support.')
      this.pendingMethods = methods
      return { kind: 'two_factor', methods }
    }
    if (isRecord(response) && typeof response.id === 'string' && typeof response.displayName === 'string') {
      this.pendingMethods = []
      return { kind: 'logged_in', user: response as unknown as VrcCurrentUser }
    }
    throw new LoginError('VRChat returned an unexpected login response.')
  }
}

function mapLoginError(err: unknown): Error {
  if (err instanceof UnauthorizedError) {
    const msg = err.message && !/missing credentials/i.test(err.message) ? err.message : 'Invalid username/email or password.'
    return new LoginError(msg)
  }
  if (err instanceof RateLimitedError) {
    return new LoginError(`Too many attempts. VRChat asks to wait about ${Math.ceil(err.retryAfterMs / 1000)} seconds.`)
  }
  if (err instanceof Error) return new LoginError(err.message)
  return new LoginError('Login failed.')
}
