import { useMemo, useState } from 'react'
import { ArrowLeftRight, Pencil, Plus, Search, ShieldBan, ShieldCheck, Trash, UserPlus } from 'lucide-react'
import type { ListKind, ManagedUser } from '@shared/types'
import { AddUserDialog } from '@/components/AddUserDialog'
import { EditUserDialog } from '@/components/EditUserDialog'
import { ListBadge } from '@/components/StatusTags'
import { Avatar, ConfirmDialog, CopyId, EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import { relativeTime, shortDate } from '@/lib/format'
import { actions, toastError, useStore } from '@/lib/store'

const COPY: Record<ListKind, { title: string; sub: string; empty: string; icon: typeof ShieldCheck }> = {
  whitelist: {
    title: 'Whitelist',
    sub: 'Users who are always accepted. Their requests get an invite to your current instance.',
    empty: 'Add the friends you always want to let in. When they request to join, they are invited automatically.',
    icon: ShieldCheck
  },
  blacklist: {
    title: 'Blacklist',
    sub: 'Users who are always rejected. Blacklist rules take priority over everything else.',
    empty: 'Add the users whose requests should always be declined automatically.',
    icon: ShieldBan
  }
}

export function ListPage({ list }: { list: ListKind }) {
  const allUsers = useStore((s) => s.users)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [removing, setRemoving] = useState<ManagedUser | null>(null)
  const [moving, setMoving] = useState<ManagedUser | null>(null)
  const copy = COPY[list]
  const Icon = copy.icon
  const other: ListKind = list === 'whitelist' ? 'blacklist' : 'whitelist'

  const users = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allUsers
      .filter((u) => u.list === list)
      .filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) || (u.note?.toLowerCase().includes(q) ?? false))
  }, [allUsers, list, query])
  const total = allUsers.filter((u) => u.list === list).length

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-heading">
          <h1 className="page-title">
            <Icon size={24} color={list === 'whitelist' ? 'var(--success)' : 'var(--danger)'} />
            {copy.title}
            <span className="badge" style={{ fontSize: 12 }}>
              {total}
            </span>
          </h1>
          <p className="page-sub">{copy.sub}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add user
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="input-wrap">
          <Search size={16} />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, user id or note" aria-label="Search list" />
        </div>
        {query && (
          <span className="faint" style={{ fontSize: 12.5 }}>
            {users.length} of {total} shown
          </span>
        )}
      </div>

      <section className="card">
        {total === 0 ? (
          <EmptyState
            icon={<Icon size={22} />}
            title={`Your ${copy.title.toLowerCase()} is empty`}
            message={copy.empty}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                <UserPlus size={15} /> Add user
              </button>
            }
          />
        ) : users.length === 0 ? (
          <EmptyState icon={<Search size={22} />} title="No matches" message={`Nobody in your ${copy.title.toLowerCase()} matches "${query}".`} />
        ) : (
          <div className="user-list">
            {users.map((u) => (
              <div className="user-row" key={u.id}>
                <Avatar name={u.displayName} url={u.avatarUrl} seed={u.id} size="lg" />
                <div className="user-main">
                  <div className="user-name">
                    <span className="truncate">{u.displayName}</span>
                  </div>
                  {u.username && <div className="user-sub">@{u.username}</div>}
                  <CopyId value={u.id} label="VRChat user id" />
                </div>
                <div className="user-meta">
                  <div>
                    Added {shortDate(u.addedAt)}
                    {u.lastRequestAt ? ` · last request ${relativeTime(u.lastRequestAt)}` : ''}
                  </div>
                  {u.note && (
                    <div className="note truncate" title={u.note}>
                      {u.note}
                    </div>
                  )}
                </div>
                <div className="user-status">
                  <ListBadge status={u.list} />
                </div>
                <div className="user-actions">
                  <button type="button" className="btn btn-ghost btn-icon" title="Edit" aria-label={`Edit ${u.displayName}`} onClick={() => setEditing(u)}>
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    title={`Move to ${other}`}
                    aria-label={`Move ${u.displayName} to ${other}`}
                    onClick={() => setMoving(u)}
                  >
                    <ArrowLeftRight size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon danger"
                    title="Remove"
                    aria-label={`Remove ${u.displayName}`}
                    onClick={() => setRemoving(u)}
                  >
                    <Trash size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {adding && <AddUserDialog list={list} onClose={() => setAdding(false)} />}
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove from ${copy.title.toLowerCase()}?`}
          message={`${removing.displayName} will be treated as an unknown user again.`}
          confirmLabel="Remove"
          icon={<Trash size={18} />}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const res = await api().removeUser(removing.id)
            if (res.ok) actions.pushToast({ tone: 'info', title: 'User removed', message: `${removing.displayName} was removed from your ${copy.title.toLowerCase()}.` })
            else toastError('Could not remove user', res.error)
          }}
        />
      )}
      {moving && (
        <ConfirmDialog
          title={`Move to ${other}?`}
          message={
            other === 'blacklist'
              ? `${moving.displayName}'s future requests will be rejected automatically.`
              : `${moving.displayName}'s future requests will be accepted automatically.`
          }
          confirmLabel={`Move to ${other}`}
          icon={<ArrowLeftRight size={18} />}
          danger={other === 'blacklist'}
          onClose={() => setMoving(null)}
          onConfirm={async () => {
            const res = await api().moveUser(moving.id, other)
            if (res.ok) actions.pushToast({ tone: 'success', title: 'User moved', message: `${moving.displayName} is now ${other === 'whitelist' ? 'whitelisted' : 'blacklisted'}.` })
            else toastError('Could not move user', res.error)
          }}
        />
      )}
    </div>
  )
}
