import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser-only preview of the renderer with a mocked backend (no Electron, no VRChat calls).
// Used for UI development: `npm run preview:ui`.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  define: { __UI_PREVIEW__: 'true' },
  resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } },
  server: { port: 5199, strictPort: true }
})
