import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Check, Search, UserPlus, Users } from 'lucide-react'
import type { ListKind, UserLookupResult } from '@shared/types'
import { parseUserReference } from '@shared/validation'
import { api } from '@/lib/api'
import { statusLabel, statusTone } from '@/lib/format'
import { actions, toastError } from '@/lib/store'
import { Avatar, CopyId, Modal, Segmented, Spinner } from './ui'

type Tab = 'search' | 'friends'

/** Find a VRChat user (by name, id or profile link, or from the friends list) and add them to a list. */
export function AddUserDialog({ list, onClose }: { list: ListKind; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserLookupResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [friendsOffline, setFriendsOffline] = useState(false)
  const [friendsOffset, setFriendsOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<UserLookupResult | null>(null)
  const requestSeq = useRef(0)
  const label = list === 'whitelist' ? 'Whitelist' : 'Blacklist'
  const other: ListKind = list === 'whitelist' ? 'blacklist' : 'whitelist'

  const runSearch = async () => {
    const q = query.trim()
    if (!q) return
    if (!parseUserReference(q) && q.length < 2) {
      setError('Type at least 2 characters.')
      return
    }
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const res = await api().lookupUsers(q)
    if (seq !== requestSeq.current) return
    setLoading(false)
    setSearched(true)
    if (res.ok) setResults(res.value)
    else {
      setResults([])
      setError(res.error)
    }
  }

  const loadFriends = async (offline: boolean, offset: number) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const res = await api().listFriends({ offline, offset })
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (res.ok) {
      setResults((prev) => (offset === 0 ? res.value.users : [...prev, ...res.value.users]))
      setHasMore(res.value.hasMore)
      setFriendsOffset(offset + res.value.users.length)
    } else setError(res.error)
  }

  useEffect(() => {
    setResults([])
    setError(null)
    setSearched(false)
    if (tab === 'friends') void loadFriends(friendsOffline, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, friendsOffline])

  const add = async (user: UserLookupResult, move = false) => {
    setBusyId(user.id)
    const res = await api().addUser({ user: { ...user, list: undefined }, list, move })
    setBusyId(null)
    if (!res.ok) {
      toastError('Could not add user', res.error)
      return
    }
    if (res.value.kind === 'conflict') {
      if (res.value.existing.list === list) {
        actions.pushToast({ tone: 'info', title: 'Already listed', message: `${user.displayName} is already in your ${label.toLowerCase()}.` })
      } else setConflict(user)
      return
    }
    setResults((prev) => prev.map((r) => (r.id === user.id ? { ...r, list } : r)))
    actions.pushToast({
      tone: 'success',
      title: move ? `Moved to ${label}` : `Added to ${label}`,
      message: `${user.displayName} is now ${list === 'whitelist' ? 'whitelisted' : 'blacklisted'}.`
    })
  }

  return (
    <>
      <Modal
        title={`Add to ${label}`}
        description={
          list === 'whitelist'
            ? 'Whitelisted users are invited automatically when they request to join.'
            : 'Blacklisted users are declined automatically when they request to join.'
        }
        icon={<UserPlus size={19} />}
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        }
      >
        <Segmented
          label="Find users"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'search', label: 'Search VRChat', icon: <Search size={14} /> },
            { value: 'friends', label: 'Friends', icon: <Users size={14} /> }
          ]}
        />

        {tab === 'search' ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              void runSearch()
            }}
          >
            <div className="input-wrap" style={{ flex: 1 }}>
              <Search size={16} />
              <input
                className="input"
                autoFocus
                value={query}
                maxLength={256}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Display name, usr_... id or vrchat.com profile link"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
              {loading ? <Spinner size={14} /> : <Search size={14} />}
              Search
            </button>
          </form>
        ) : (
          <div className="row">
            <Segmented
              label="Friend filter"
              value={friendsOffline ? 'offline' : 'online'}
              onChange={(v) => setFriendsOffline(v === 'offline')}
              options={[
                { value: 'online', label: 'Online' },
                { value: 'offline', label: 'Offline' }
              ]}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              Only friends can send you invite requests.
            </span>
          </div>
        )}

        {error && <div className="field-error">{error}</div>}

        <div className="result-list">
          {results.length === 0 ? (
            <div className="result-empty">
              {loading ? (
                <Spinner />
              ) : tab === 'search' ? (
                searched ? (
                  'No users found. Try the exact display name, or paste their user id / profile link.'
                ) : (
                  'Search by display name, or paste a user id (usr_...) or a vrchat.com profile link.'
                )
              ) : (
                'No friends to show.'
              )}
            </div>
          ) : (
            results.map((r) => (
              <div className="result-row" key={r.id}>
                <Avatar name={r.displayName} url={r.avatarUrl} seed={r.id} />
                <div className="meta">
                  <div className="name">
                    <span className="truncate">{r.displayName}</span>
                    {r.isFriend && <span className="badge badge-accent">Friend</span>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {r.status && <span className={`status-dot ${statusTone(r.status)}`} title={statusLabel(r.status)} />}
                    <CopyId value={r.id} label="user id" />
                  </div>
                </div>
                {r.list === list ? (
                  <span className="badge badge-success">
                    <Check size={12} /> Added
                  </span>
                ) : r.list === other ? (
                  <button type="button" className="btn btn-sm" disabled={busyId === r.id} onClick={() => setConflict(r)}>
                    <ArrowLeftRight size={13} /> Move here
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={() => void add(r)}>
                    {busyId === r.id ? <Spinner size={13} /> : <UserPlus size={13} />} Add
                  </button>
                )}
              </div>
            ))
          )}
          {tab === 'friends' && hasMore && results.length > 0 && (
            <div className="load-more">
              <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void loadFriends(friendsOffline, friendsOffset)}>
                {loading && <Spinner size={13} />} Load more
              </button>
            </div>
          )}
        </div>
      </Modal>

      {conflict && (
        <Modal
          title={`Move to ${label}?`}
          description={`${conflict.displayName} is currently ${other === 'whitelist' ? 'whitelisted' : 'blacklisted'}. A user can only be in one list.`}
          icon={<ArrowLeftRight size={19} />}
          size="sm"
          onClose={() => setConflict(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setConflict(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const target = conflict
                  setConflict(null)
                  void add(target, true)
                }}
              >
                Move to {label}
              </button>
            </>
          }
        />
      )}
    </>
  )
}
