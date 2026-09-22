import type { VrcmxApi } from '@shared/ipc'

let current: VrcmxApi | null = null

export function setApi(api: VrcmxApi): void {
  current = api
}

/** The typed bridge to the main process (see src/preload). */
export function api(): VrcmxApi {
  if (!current) throw new Error('Backend not available')
  return current
}
