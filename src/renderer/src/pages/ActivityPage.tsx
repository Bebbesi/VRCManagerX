import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Download, ScrollText, Search, ShieldBan, ShieldCheck, Trash } from 'lucide-react'
import type { ActivityEntry, ActivityFilter, ListKind } from '@shared/types'
import { logTags } from '@/components/StatusTags'
import { Avatar, ConfirmDialog, CopyId, EmptyState, Segmented, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { dateTime, shortDate, timeOfDay } from '@/lib/format'
import { actions, toastError, useStore } from '@/lib/store'

const PAGE = 100

const FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'whitelist', label: 'Whitelist' },
  { value: 'blacklist', label: 'Blacklist' },
  { value: 'errors', label: 'Errors' }
]

export function ActivityPage() {
  const activityVersion = useStore((s) => s.activityVersion)
  const users = useStore((s) => s.users)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [search, setSearch] = useState('')
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    const page = await api().queryActivity({ filter, search: search.trim() || undefined, limit })
    setEntries(page.entries)
    setTotal(page.total)
  }, [filter, search, limit])

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0)
    return () => clearTimeout(t)
  }, [load, activityVersion, search])

  const exportLog = async (format: 'csv' | 'json') => {
    setExporting(true)
    const res = await api().exportActivity(format)
    setExporting(false)
    if (!res.ok) toastError('Export failed', res.error)
    else if (res.value) actions.pushToast({ tone: 'success', title: 'Log exported', message: res.value })
  }

  const addTo = async (entry: ActivityEntry, list: ListKind) => {
    if (!entry.user) return
    const res = await api().addUser({ user: { id: entry.user.id, displayName: entry.user.displayName, avatarUrl: entry.user.avatarUrl }, list })
    if (!res.ok) return toastError('Could not add user', res.error)
    if (res.value.kind === 'conflict') {
      actions.pushToast({ tone: 'info', title: 'Already listed', message: `${entry.user.displayName} is already in your ${res.value.existing.list}.` })
      return
    }
    actions.pushToast({ tone: 'success', title: `Added to ${list}`, message: `${entry.user.displayName} is now ${list === 'whitelist' ? 'whitelisted' : 'blacklisted'}.` })
  }

  let lastDay = ''

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-heading">
          <h1 className="page-title">Activity</h1>
          <p className="page-sub">Every invite request handled or seen by VRCManagerX, newest first.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" disabled={exporting} onClick={() => void exportLog('csv')}>
            <Download size={15} /> Export CSV
          </button>
          <button type="button" className="btn" disabled={exporting} onClick={() => void exportLog('json')}>
            <Download size={15} /> JSON
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)}>
            <Trash size={15} /> Clear
          </button>
        </div>
      </header>

      <div className="toolbar">
        <Segmented
          label="Filter"
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setLimit(PAGE)
          }}
          options={FILTERS}
        />
        <div className="input-wrap">
          <Search size={16} />
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, id or reason" aria-label="Search activity" />
        </div>
      </div>

      <section className="card">
        {entries === null ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={22} />}
            title="Nothing here yet"
            message={filter === 'all' && !search ? 'Handled invite requests will be logged here.' : 'No entries match this filter.'}
          />
        ) : (
          <div className="log-list">
            {entries.map((e) => {
              const tags = logTags(e)
              const day = shortDate(e.timestamp)
              const showDay = day !== lastDay
              lastDay = day
              const open = expanded === e.id
              const listed = e.user ? users.find((u) => u.id === e.user!.id)?.list : undefined
              return (
                <div className="log-row" key={e.id}>
                  {showDay && (
                    <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, padding: '10px 16px 0', letterSpacing: '0.04em' }}>
                      {day.toUpperCase()}
                    </div>
                  )}
                  <button type="button" className="log-line" aria-expanded={open} onClick={() => setExpanded(open ? null : e.id)}>
                    <span className="log-time">[{timeOfDay(e.timestamp)}]</span>
                    {e.user ? <Avatar name={e.user.displayName} url={e.user.avatarUrl} seed={e.user.id} size="xs" /> : <span />}
                    <span style={{ minWidth: 0 }}>
                      <span className="log-flow">
                        <span className="who">{e.user?.displayName ?? 'System'}</span>
                        <span className="arrow">→</span>
                        <span className={`tag ${tags.list.cls}`}>{tags.list.text}</span>
                        <span className="arrow">→</span>
                        <span className={`tag ${tags.action.cls}`}>{tags.action.text}</span>
                      </span>
                      <span className="log-reason" style={{ display: 'block' }}>
                        {e.detail ?? e.reason}
                      </span>
                    </span>
                    <span className="log-end row faint" style={{ fontSize: 12 }}>
                      {e.mode}
                      <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
                    </span>
                  </button>
                  {open && (
                    <div className="log-details">
                      <dl className="log-details-grid">
                        <Detail label="Timestamp" value={dateTime(e.timestamp)} />
                        <Detail label="Display name" value={e.user?.displayName ?? '-'} />
                        <Detail label="Username" value={e.user?.username ? `@${e.user.username}` : 'Not exposed by VRChat'} />
                        <div>
                          <dt>VRChat user id</dt>
                          <dd>{e.user ? <CopyId value={e.user.id} label="user id" /> : '-'}</dd>
                        </div>
                        <Detail label="Action" value={e.action} />
                        <Detail label="Rule" value={e.rule.replace(/_/g, ' ')} />
                        <Detail label="Reason / message" value={e.reason} />
                        <Detail label="Mode" value={e.mode} />
                        <Detail label="Result" value={e.result} />
                        {e.detail && <Detail label="Details" value={e.detail} />}
                        {e.notificationId && <Detail label="Notification id" value={e.notificationId} mono />}
                      </dl>
                      {e.user && e.kind === 'invite' && !listed && (
                        <div className="log-details-actions">
                          <button type="button" className="btn btn-sm" onClick={() => void addTo(e, 'whitelist')}>
                            <ShieldCheck size={14} /> Add to whitelist
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => void addTo(e, 'blacklist')}>
                            <ShieldBan size={14} /> Add to blacklist
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="list-summary">
              Showing {entries.length} of {total} entries
            </div>
            {entries.length < total && (
              <div className="load-more">
                <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {confirmClear && (
        <ConfirmDialog
          title="Clear the activity log?"
          message="All log entries will be permanently removed. Statistics on the dashboard are kept."
          confirmLabel="Clear log"
          icon={<Trash size={18} />}
          danger
          onClose={() => setConfirmClear(false)}
          onConfirm={async () => {
            await api().clearActivity()
            await load()
          }}
        />
      )}
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono selectable' : 'selectable'}>{value}</dd>
    </div>
  )
}
