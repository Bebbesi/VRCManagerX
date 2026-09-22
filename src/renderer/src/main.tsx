import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { setApi } from './lib/api'
import { connectBackend } from './lib/store'

async function boot() {
  const root = createRoot(document.getElementById('root')!)
  let bridge = window.vrcmx
  if (!bridge && __UI_PREVIEW__) {
    const { createMockApi } = await import('./lib/mockApi')
    bridge = createMockApi()
  }
  if (!bridge) {
    root.render(<div style={{ padding: 32 }}>VRCManagerX must be started as a desktop application.</div>)
    return
  }
  setApi(bridge)
  const report = bridge.reportError
  window.addEventListener('error', (e) => report(`Uncaught: ${e.message} at ${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => report(`Unhandled rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`))
  await connectBackend()
  root.render(
    <StrictMode>
      <ErrorBoundary scope="app">
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}

void boot()
