import { Activity, LayoutDashboard, Power, Settings, ShieldBan, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { automationState, connectionTone, CONNECTION_LABEL } from '@/lib/automation'
import { statusLabel, statusTone } from '@/lib/format'
import { actions, useStore, type PageKey } from '@/lib/store'
import { Avatar } from './ui'
import { BrandMark } from './BrandMark'

const NAV: Array<{ key: PageKey; label: string; icon: ReactNode }> = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { key: 'whitelist', label: 'Whitelist', icon: <ShieldCheck size={18} /> },
  { key: 'blacklist', label: 'Blacklist', icon: <ShieldBan size={18} /> },
  { key: 'activity', label: 'Activity', icon: <Activity size={18} /> },
  { key: 'settings', label: 'Settings', icon: <Settings size={18} /> }
]

export function Sidebar() {
  const page = useStore((s) => s.page)
  const snapshot = useStore((s) => s.snapshot)
  if (!snapshot) return null
  const account = snapshot.auth.account
  const automation = automationState(snapshot)
  const tone = connectionTone(snapshot.connection.phase)

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <div className="brand-name">VRCManagerX</div>
          <div className="brand-sub">Invite Manager</div>
        </div>
      </div>

      <nav className="nav" aria-label="Main">
        <div className="nav-label">Menu</div>
        {NAV.map((item) => {
          const count = item.key === 'whitelist' ? snapshot.counts.whitelist : item.key === 'blacklist' ? snapshot.counts.blacklist : null
          return (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${page === item.key ? 'active' : ''}`}
              aria-current={page === item.key ? 'page' : undefined}
              title={item.label}
              onClick={() => actions.navigate(item.key)}
            >
              {item.icon}
              <span className="nav-text">{item.label}</span>
              {count !== null && <span className="nav-count">{count}</span>}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className={`automation-pill ${automation.kind}`}
          title={automation.description}
          onClick={() => actions.navigate('dashboard')}
        >
          <Power size={15} />
          <span className="label">{automation.title}</span>
          <span className={`status-dot ${automation.kind === 'on' ? 'success pulse' : automation.kind === 'paused' ? 'warning' : ''}`} />
        </button>

        {account && (
          <div className="account-chip" title={`${account.displayName} - ${CONNECTION_LABEL[snapshot.connection.phase]}`}>
            <Avatar name={account.displayName} url={account.avatarUrl} seed={account.id} size="sm" />
            <div className="meta">
              <div className="name truncate">{account.displayName}</div>
              <div className="sub">
                <span className={`status-dot ${statusTone(snapshot.presence.status)}`} />
                <span className="truncate">{statusLabel(snapshot.presence.status)}</span>
              </div>
            </div>
            <span className={`badge badge-${tone}`} style={{ padding: '0 6px' }} aria-label={CONNECTION_LABEL[snapshot.connection.phase]}>
              {tone === 'success' ? <Wifi size={13} /> : <WifiOff size={13} />}
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}
