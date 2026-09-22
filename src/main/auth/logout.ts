import type { VrcHttpClient } from '../vrchat/http'
import type { SessionManager } from './session'

/** Invalidates the VRChat session server-side (best effort) and wipes it locally. */
export async function logout(http: VrcHttpClient, session: SessionManager): Promise<void> {
  if (http.getCookies().auth) {
    try {
      await http.put('/logout', undefined, { expectUnauthorized: true })
    } catch {
      // Offline or already expired: the local wipe below still signs the user out.
    }
  }
  session.clear()
}
