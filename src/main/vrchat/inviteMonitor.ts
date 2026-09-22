import type { Settings } from '@shared/types'
import type { VrcHttpClient } from './http'
import { asNotification, type VrcNotification } from './types'

/**
 * Detects incoming invite requests. Live requests arrive through the pipeline
 * websocket; on (re)connect, requests received while offline are fetched once.
 */
export class InviteMonitor {
  constructor(
    private readonly http: VrcHttpClient,
    private readonly settings: () => Settings,
    private readonly onRequest: (n: VrcNotification) => void,
    private readonly isProcessed: (id: string) => boolean
  ) {}

  /** Handles a pipeline event. Returns true when it was an invite request. */
  handlePipelineEvent(type: string, content: unknown): boolean {
    if (type !== 'notification') return false
    const notification = asNotification(content)
    if (!notification || notification.type !== 'requestInvite') return false
    this.onRequest(notification)
    return true
  }

  /** Picks up recent, still-pending requests (one REST call per connection). */
  async catchUp(): Promise<number> {
    const s = this.settings().automation
    if (!s.processPendingOnStartup) return 0
    const list = await this.http.get<unknown[]>('/auth/user/notifications', { query: { n: 100, hidden: false } })
    const cutoff = Date.now() - s.pendingMaxAgeMinutes * 60_000
    const pending = (Array.isArray(list) ? list : [])
      .map(asNotification)
      .filter((n): n is VrcNotification => n !== null && n.type === 'requestInvite')
      .filter((n) => Date.parse(n.created_at) >= cutoff && !this.isProcessed(n.id))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    for (const n of pending) this.onRequest(n)
    return pending.length
  }
}
