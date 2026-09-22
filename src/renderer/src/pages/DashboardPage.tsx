import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Inbox,
  MapPin,
  MessageSquare,
  Power,
  RefreshCw,
  ShieldBan,
  ShieldCheck,
  TriangleAlert,
  Wifi,
  WifiOff
} from 'lucide-react'
import type { ActivityEntry, AppSnapshot } from '@shared/types'
import { ActionBadge, ListBadge } from '@/components/StatusTags'
import { Avatar, EmptyState, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { automationState, connectionTone, CONNECTION_LABEL } from '@/lib/automation'
import { relativeTime, shortDate, statusLabel, statusTone } from '@/lib/format'
import { actions, toastError, useStore } from '@/lib/store'

export function DashboardPage({ snapshot }: { snapshot: AppSnapshot }) {
  const activityVersion = useStore((s) => s.activityVersion)
  const [recent, setRecent] = useState<ActivityEntry[] | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void api()
      .queryActivity({ filter: 'all', limit: 30 })
      .then((page) => {
        if (!cancelled) setRecent(page.entries.filter((e) => e.kind === 'invite').slice(0, 8))
      })
    return () => {
      cancelled = true
    }
  }, [activityVersion])

  // Keep relative times fresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const automation = automationState(snapshot)
  const a = snapshot.settings.automation

  const setEnabled = async (enabled: boolean) => {
    const res = await api().updateSettings({ automation: { enabled } })
    if (!res.ok) toastError('Could not change automation', res.error)
  }

  const warnings = collectWarnings(snapshot)

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-heading">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Live overview of your invite automation.</p>
        </div>
      </header>

      <div className="dash-grid">
        <section className={`card automation-card ${automation.kind}`} aria-label="Automation status">
          <div className="automation-head">
            <div className="automation-icon">
              <Power size={24} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="automation-eyebrow">System status</div>
              <div className="automation-title">{automation.title}</div>
            </div>
            <label className="automation-toggle">
              <span>Enable Automation</span>
              <Switch checked={a.enabled} onChange={setEnabled} label="Enable Automation" size="lg" tone="success" />
            </label>
          </div>
          <p className="automation-desc" style={{ margin: 0 }}>
            {automation.description}
          </p>
          <div className="chips">
            <span className={`badge ${a.trustedOnly ? 'badge-accent' : ''}`}>
              <ShieldCheck size={12} /> Trusted Only: {a.trustedOnly ? 'On' : 'Off'}
            </span>
            <span className={`badge ${a.autoAcceptWhitelist ? 'badge-success' : ''}`}>
              <CircleCheck size={12} /> Auto-accept {a.autoAcceptWhitelist ? 'on' : 'off'}
            </span>
            <span className={`badge ${a.autoRejectBlacklist ? 'badge-danger' : ''}`}>
              <CircleX size={12} /> Auto-reject {a.autoRejectBlacklist ? 'on' : 'off'}
            </span>
            {a.onlyWhenAskMe && (
              <span className="badge badge-warning">
                <Activity size={12} /> Ask Me only
              </span>
            )}
            <span className={`badge ${a.sendReasonMessages ? 'badge-info' : ''}`}>
              <MessageSquare size={12} /> Reasons {a.sendReasonMessages ? 'sent' : 'off'}
            </span>
          </div>
        </section>

        <ConnectionCard snapshot={snapshot} />

        <section className="span-2" aria-label="Invite activity">
          <div className="stat-grid">
            <Stat icon={<Inbox size={17} />} tone="accent" value={snapshot.stats.received} label="Invites received" />
            <Stat icon={<CircleCheck size={17} />} tone="success" value={snapshot.stats.accepted} label="Accepted automatically" />
            <Stat icon={<CircleX size={17} />} tone="danger" value={snapshot.stats.rejected} label="Rejected automatically" />
            <Stat
              icon={<CircleDashed size={17} />}
              tone="neutral"
              value={snapshot.stats.ignored}
              label={snapshot.stats.errors ? `Left manually (+${snapshot.stats.errors} failed)` : 'Left manually'}
            />
            <Stat icon={<ShieldCheck size={17} />} tone="success" value={snapshot.counts.whitelist} label="Whitelisted users" onClick={() => actions.navigate('whitelist')} />
            <Stat icon={<ShieldBan size={17} />} tone="danger" value={snapshot.counts.blacklist} label="Blacklisted users" onClick={() => actions.navigate('blacklist')} />
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Statistics since {shortDate(snapshot.stats.since)}
          </div>
        </section>
      </div>

      {warnings.length > 0 && (
        <div className="warn-list">
          {warnings.map((w) => (
            <div key={w.text} className={`callout callout-${w.tone}`}>
              <TriangleAlert size={16} />
              <div style={{ flex: 1 }}>{w.text}</div>
              {w.action}
            </div>
          ))}
        </div>
      )}

      <div className="section-title">
        <h2>Recent Activity</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.navigate('activity')}>
          View all <ArrowRight size={14} />
        </button>
      </div>
      <section className="card">
        {recent === null ? (
          <div className="empty" style={{ padding: 32 }} />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title="No invite requests yet"
            message="When someone requests an invite while you're set to Ask Me, it will show up here."
          />
        ) : (
          <div className="recent-list">
            {recent.map((e) => (
              <div className="recent-item" key={e.id}>
                <Avatar name={e.user?.displayName ?? '?'} url={e.user?.avatarUrl} seed={e.user?.id} size="sm" />
                <div className="who">
                  <div className="name truncate">{e.user?.displayName ?? 'Unknown'}</div>
                  <div className="reason truncate" title={e.detail ?? e.reason}>
                    {e.detail ?? e.reason}
                  </div>
                </div>
                <div className="recent-tags">
                  <ListBadge status={e.listStatus} />
                  <ActionBadge action={e.action} />
                </div>
                <div className="time" title={new Date(e.timestamp).toLocaleString()}>
                  {relativeTime(e.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat(props: { icon: React.ReactNode; tone: string; value: number; label: string; onClick?: () => void }) {
  return (
    <div
      className="card stat"
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      style={{ cursor: props.onClick ? 'pointer' : undefined }}
      onClick={props.onClick}
      onKeyDown={(e) => props.onClick && (e.key === 'Enter' || e.key === ' ') && props.onClick()}
    >
      <div className={`stat-icon tone-${props.tone}`}>{props.icon}</div>
      <div>
        <div className="stat-value">{props.value.toLocaleString()}</div>
        <div className="stat-label">{props.label}</div>
      </div>
    </div>
  )
}

function ConnectionCard({ snapshot }: { snapshot: AppSnapshot }) {
  const c = snapshot.connection
  const tone = connectionTone(c.phase)
  const account = snapshot.auth.account
  const [busy, setBusy] = useState(false)
  const connected = c.phase === 'connected'

  return (
    <section className="card conn-card" aria-label="Connection status">
      <div className="card-header">
        <h2 className="card-title">Connection Status</h2>
        {!connected && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await api().reconnect()
              setTimeout(() => setBusy(false), 1500)
            }}
          >
            <RefreshCw size={13} className={busy ? 'spinner' : undefined} /> Reconnect
          </button>
        )}
      </div>
      <div className="card-body">
        <div className="conn-status">
          <div className={`conn-icon ${tone}`}>{connected ? <Wifi size={20} /> : <WifiOff size={20} />}</div>
          <div style={{ minWidth: 0 }}>
            <div className="conn-title">{connected ? 'Connected' : CONNECTION_LABEL[c.phase]}</div>
            <div className="faint" style={{ fontSize: 12 }}>
              {connected ? `Live since ${relativeTime(c.since)}` : c.retryAt ? `Retrying ${relativeTime(c.retryAt)}` : (c.detail ?? 'Not connected')}
            </div>
          </div>
        </div>
        {account && (
          <div className="row" style={{ gap: 10 }}>
            <Avatar name={account.displayName} url={account.avatarUrl} seed={account.id} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 650 }} className="truncate">
                {account.displayName}
              </div>
              <div className="row faint" style={{ fontSize: 12, gap: 6 }}>
                <span className={`status-dot ${statusTone(snapshot.presence.status)}`} />
                {statusLabel(snapshot.presence.status)}
                {account.statusDescription ? <span className="truncate">- {account.statusDescription}</span> : null}
              </div>
            </div>
          </div>
        )}
        <dl className="kv">
          <dt>Real-time link</dt>
          <dd>{connected ? 'Active (VRChat pipeline)' : 'Inactive'}</dd>
          <dt>Current instance</dt>
          <dd className="row" style={{ justifyContent: 'flex-end', gap: 5 }}>
            <MapPin size={12} />
            {snapshot.presence.inInstance ? 'In an instance' : 'Not in an instance'}
          </dd>
          <dt>Last event</dt>
          <dd>{relativeTime(c.lastEventAt)}</dd>
        </dl>
      </div>
    </section>
  )
}

function collectWarnings(s: AppSnapshot): Array<{ tone: 'warning' | 'danger' | 'info'; text: string; action?: React.ReactNode }> {
  const out: Array<{ tone: 'warning' | 'danger' | 'info'; text: string; action?: React.ReactNode }> = []
  const a = s.settings.automation
  for (const w of s.startupWarnings) out.push({ tone: 'warning', text: w })
  if (a.enabled && s.connection.phase === 'connected') {
    if (a.onlyWhenAskMe && s.presence.status !== 'ask me') {
      out.push({ tone: 'info', text: `Your VRChat status is ${statusLabel(s.presence.status)}. Set it to Ask Me in VRChat for requests to be handled automatically.` })
    }
    if (!s.presence.inInstance && a.autoAcceptWhitelist && s.counts.whitelist > 0) {
      out.push({ tone: 'info', text: "You're not in an instance right now, so whitelisted users can't be invited yet. Their requests will be logged as failed." })
    }
    if (a.trustedOnly && !a.autoAcceptWhitelist) {
      out.push({ tone: 'warning', text: 'Trusted Only is on but automatic whitelist acceptance is off: whitelisted users will be left pending.' })
    }
  }
  if (a.sendReasonMessages && s.auth.phase === 'logged_in') {
    const bad = s.slots.filter((slot) => slot.status === 'cooldown' || slot.status === 'error')
    if (bad.length) {
      out.push({
        tone: 'warning',
        text: `${bad.length} reason message${bad.length > 1 ? 's are' : ' is'} not yet saved on VRChat (message slots can only be changed every 60 minutes). The previous text is used until then.`,
        action: (
          <button type="button" className="btn btn-sm" onClick={() => actions.navigate('settings')}>
            Review
          </button>
        )
      })
    }
  }
  return out
}
