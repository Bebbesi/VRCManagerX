import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { isRecord } from './types'

const PIPELINE_URL = 'wss://pipeline.vrchat.cloud/'
const BASE_RECONNECT_MS = 2_000
const MAX_RECONNECT_MS = 5 * 60_000

export interface PipelineEvent {
  type: string
  content: unknown
}

export type PipelineState = 'idle' | 'connecting' | 'open' | 'waiting'

interface PipelineEvents {
  state: [PipelineState, { retryAt?: number; detail?: string }]
  event: [PipelineEvent]
  /** The server rejected our token (expired / revoked session). */
  'auth-failed': [string]
}

/**
 * Real-time connection to VRChat's websocket ("pipeline"). Notifications arrive here,
 * so the app never has to poll the REST API. Reconnects with jittered exponential backoff.
 */
export class PipelineConnection extends EventEmitter<PipelineEvents> {
  private socket: WebSocket | null = null
  private token: string | null = null
  private attempts = 0
  private timer: NodeJS.Timeout | null = null
  private stopped = true
  private lastServerError: string | null = null

  constructor(private readonly userAgent: () => string) {
    super()
  }

  start(authToken: string): void {
    this.token = authToken
    this.stopped = false
    this.attempts = 0
    this.open()
  }

  stop(): void {
    this.stopped = true
    this.token = null
    this.clearTimer()
    this.teardown()
    this.emit('state', 'idle', {})
  }

  /** Reconnect immediately (network came back, system resumed from sleep, user request). */
  reconnectNow(): void {
    if (this.stopped || !this.token) return
    this.clearTimer()
    this.attempts = 0
    this.teardown()
    this.open()
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  private open(): void {
    if (!this.token) return
    this.lastServerError = null
    this.emit('state', 'connecting', {})
    const url = `${PIPELINE_URL}?authToken=${encodeURIComponent(this.token)}`
    const socket = new WebSocket(url, {
      headers: { 'User-Agent': this.userAgent() },
      handshakeTimeout: 15_000,
      perMessageDeflate: false
    })
    this.socket = socket

    socket.on('open', () => {
      if (socket !== this.socket) return
      this.attempts = 0
      this.emit('state', 'open', {})
    })

    socket.on('message', (data) => {
      if (socket !== this.socket) return
      const event = parseMessage(data.toString())
      if (!event) return
      if (event.type === '__error') {
        this.lastServerError = typeof event.content === 'string' ? event.content : 'Pipeline error'
        return
      }
      this.emit('event', event)
    })

    socket.on('unexpected-response', (_req, res) => {
      if (socket !== this.socket) return
      const status = res.statusCode ?? 0
      socket.terminate()
      if (status === 401 || status === 403) {
        this.emit('auth-failed', `Pipeline refused the session (HTTP ${status}).`)
      }
      this.scheduleReconnect(`HTTP ${status}`)
    })

    socket.on('error', () => {
      // 'close' always follows; handled there. Never log the URL: it contains the token.
    })

    socket.on('close', () => {
      if (socket !== this.socket) return
      this.socket = null
      if (this.stopped) return
      const serverError = this.lastServerError
      if (serverError && /session|authToken|auth/i.test(serverError)) {
        this.emit('auth-failed', serverError)
      }
      this.scheduleReconnect(serverError ?? 'Connection closed')
    })
  }

  private scheduleReconnect(detail: string): void {
    if (this.stopped || this.timer) return
    const backoff = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** this.attempts)
    const wait = backoff + Math.floor(Math.random() * 1000)
    this.attempts++
    const retryAt = Date.now() + wait
    this.emit('state', 'waiting', { retryAt, detail })
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.stopped) this.open()
    }, wait)
  }

  private teardown(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.removeAllListeners('message')
    try {
      socket.terminate()
    } catch {
      // ignore
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/** Pipeline messages are `{type, content}` where content is usually a JSON string (double encoded). */
export function parseMessage(raw: string): PipelineEvent | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  if (typeof data.err === 'string') return { type: '__error', content: data.err }
  if (typeof data.type !== 'string') return null
  let content: unknown = data.content
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content)
    } catch {
      // see-notification / hide-notification carry a bare id string.
    }
  }
  return { type: data.type, content }
}
