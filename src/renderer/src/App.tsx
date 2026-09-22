import { useEffect, useRef } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Sidebar } from '@/components/Sidebar'
import { Toasts } from '@/components/Toasts'
import { Spinner } from '@/components/ui'
import { useStore } from '@/lib/store'
import { ActivityPage } from '@/pages/ActivityPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ListPage } from '@/pages/ListPage'
import { LoginPage } from '@/pages/LoginPage'
import { SettingsPage } from '@/pages/SettingsPage'

function useTheme(theme: 'dark' | 'light' | 'system' | undefined) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const effective = theme === 'system' ? (media.matches ? 'light' : 'dark') : (theme ?? 'dark')
      document.documentElement.dataset.theme = effective
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

export function App() {
  const snapshot = useStore((s) => s.snapshot)
  const page = useStore((s) => s.page)
  const mainRef = useRef<HTMLElement>(null)
  useTheme(snapshot?.settings.app.theme)
  // Block body on purpose: scrollTo() returns a Promise in recent Chromium, and an effect
  // must never return anything but a cleanup function.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [page])

  if (!snapshot || snapshot.auth.phase === 'initializing') {
    return (
      <div className="splash">
        <div className="splash-inner">
          <BrandMark size={52} />
          <div className="row">
            <Spinner /> Loading VRCManagerX...
          </div>
        </div>
        <Toasts />
      </div>
    )
  }

  if (snapshot.auth.phase !== 'logged_in') {
    return (
      <>
        <LoginPage snapshot={snapshot} />
        <Toasts />
      </>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main" ref={mainRef}>
        <ErrorBoundary scope="page" key={page}>
          {page === 'dashboard' && <DashboardPage snapshot={snapshot} />}
          {page === 'whitelist' && <ListPage key="whitelist" list="whitelist" />}
          {page === 'blacklist' && <ListPage key="blacklist" list="blacklist" />}
          {page === 'activity' && <ActivityPage />}
          {page === 'settings' && <SettingsPage snapshot={snapshot} />}
        </ErrorBoundary>
      </main>
      <Toasts />
    </div>
  )
}
