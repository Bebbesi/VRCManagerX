import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict Content-Security-Policy for the packaged renderer. The dev server needs inline
// scripts (React refresh preamble) and a websocket for HMR, so it gets a relaxed policy.
function contentSecurityPolicy(): Plugin {
  const prod = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: vrcmx-img:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
  const dev = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: vrcmx-img:",
    "font-src 'self' data:",
    "connect-src 'self' ws://localhost:* http://localhost:*",
    "object-src 'none'"
  ].join('; ')
  let isBuild = false
  return {
    name: 'vrcmx-csp',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml(html) {
      const policy = isBuild ? prod : dev
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { outDir: 'out/main' }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } },
    plugins: [react(), contentSecurityPolicy()],
    define: { __UI_PREVIEW__: 'false' },
    build: { outDir: 'out/renderer' }
  }
})
