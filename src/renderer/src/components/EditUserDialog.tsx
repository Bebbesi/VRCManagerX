import { useState } from 'react'
import { ExternalLink, Pencil, RefreshCw, ShieldBan, ShieldCheck } from 'lucide-react'
import type { ListKind, ManagedUser } from '@shared/types'
import { api } from '@/lib/api'
import { dateTime, relativeTime } from '@/lib/format'
import { actions, toastError } from '@/lib/store'
import { Avatar, CopyId, Modal, Segmented, Spinner } from './ui'

export function EditUserDialog({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [note, setNote] = useState(user.note ?? '')
  const [list, setList] = useState<ListKind>(user.list)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [current, setCurrent] = useState(user)
  const noteTooLong = note.length > 500

  const save = async () => {
    setSaving(true)
    try {
      if ((current.note ?? '') !== note) {
        const res = await api().updateUser(user.id, { note })
        if (!res.ok) return toastError('Could not save note', res.error)
      }
      if (list !== current.list) {
        const res = await api().moveUser(user.id, list)
        if (!res.ok) return toastError('Could not move user', res.error)
      }
      actions.pushToast({ tone: 'success', title: 'User updated', message: `${current.displayName} was saved.` })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    const res = await api().refreshUser(user.id)
    setRefreshing(false)
    if (res.ok) setCurrent(res.value)
    else toastError('Could not refresh profile', res.error)
  }

  return (
    <Modal
      title="Edit user"
      icon={<Pencil size={18} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={saving || noteTooLong} onClick={() => void save()}>
            {saving && <Spinner size={14} />} Save changes
          </button>
        </>
      }
    >
      <div className="profile-head">
        <Avatar name={current.displayName} url={current.avatarUrl} seed={current.id} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }} className="truncate">
            {current.displayName}
          </div>
          {current.username && <div className="faint">@{current.username}</div>}
          <CopyId value={current.id} label="user id" />
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm" onClick={() => void refresh()} disabled={refreshing} title="Fetch the latest name and picture from VRChat">
            <RefreshCw size={13} className={refreshing ? 'spinner' : undefined} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="Open VRChat profile"
            aria-label="Open VRChat profile"
            onClick={() => void api().openExternal(`https://vrchat.com/home/user/${current.id}`)}
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">List</span>
        <Segmented
          label="List"
          value={list}
          onChange={setList}
          options={[
            { value: 'whitelist', label: 'Whitelist - always accept', icon: <ShieldCheck size={14} /> },
            { value: 'blacklist', label: 'Blacklist - always reject', icon: <ShieldBan size={14} /> }
          ]}
        />
      </div>

      <label className="field">
        <span className="field-label">
          Private note <span className="char-count">{note.length}/500</span>
        </span>
        <textarea
          className={`textarea ${noteTooLong ? 'invalid' : ''}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why is this user on the list? Only stored on this computer."
        />
      </label>

      <dl className="kv" style={{ fontSize: 12 }}>
        <dt>Added</dt>
        <dd>{dateTime(current.addedAt)}</dd>
        <dt>Last updated</dt>
        <dd>{dateTime(current.updatedAt)}</dd>
        <dt>Last invite request</dt>
        <dd>{current.lastRequestAt ? relativeTime(current.lastRequestAt) : 'Never'}</dd>
      </dl>
    </Modal>
  )
}
