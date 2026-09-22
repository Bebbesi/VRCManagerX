import type { AppSnapshot, ConnectionPhase } from '@shared/types'
import { statusLabel } from './format'

export type AutomationKind = 'on' | 'paused' | 'off'

export function automationState(s: AppSnapshot): { kind: AutomationKind; title: string; description: string } {
  const a = s.settings.automation
  if (!a.enabled) {
    return {
      kind: 'off',
      title: 'AUTOMATION DISABLED',
      description: 'No automatic action is taken. Every invite request is left for you to handle in VRChat.'
    }
  }
  if (s.connection.phase !== 'connected') {
    return {
      kind: 'paused',
      title: 'AUTOMATION PAUSED',
      description: 'Automation is enabled, but VRCManagerX is not connected to VRChat right now.'
    }
  }
  if (a.onlyWhenAskMe && s.presence.status !== 'ask me') {
    return {
      kind: 'on',
      title: 'AUTOMATION ACTIVE',
      description: `Standing by: your status is ${statusLabel(s.presence.status)}. Requests are handled while you are set to Ask Me.`
    }
  }
  const mode = a.trustedOnly
    ? 'Trusted Only: whitelisted users are accepted, everyone else is rejected.'
    : 'Whitelisted users are accepted, blacklisted users are rejected, everyone else is left to you.'
  return { kind: 'on', title: 'AUTOMATION ACTIVE', description: mode }
}

export const CONNECTION_LABEL: Record<ConnectionPhase, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  rate_limited: 'Rate limited',
  unreachable: 'VRChat unreachable',
  disconnected: 'Disconnected',
  session_expired: 'Session expired'
}

export function connectionTone(phase: ConnectionPhase): 'success' | 'warning' | 'danger' {
  if (phase === 'connected') return 'success'
  if (phase === 'connecting' || phase === 'reconnecting' || phase === 'rate_limited') return 'warning'
  return 'danger'
}
