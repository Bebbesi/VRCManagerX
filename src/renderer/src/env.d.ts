/// <reference types="vite/client" />
import type { VrcmxApi } from '@shared/ipc'

declare global {
  /** True only in the browser UI preview (mocked backend). */
  const __UI_PREVIEW__: boolean
  interface Window {
    vrcmx?: VrcmxApi
  }
}

export {}
