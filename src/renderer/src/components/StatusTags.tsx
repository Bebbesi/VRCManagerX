import { Check, CircleDashed, CircleHelp, ShieldBan, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import type { ActivityAction, ActivityEntry, ListStatus } from '@shared/types'

export function ListBadge({ status }: { status: ListStatus | undefined }) {
  if (status === 'whitelist')
    return (
      <span className="badge badge-success">
        <ShieldCheck size={12} /> Whitelisted
      </span>
    )
  if (status === 'blacklist')
    return (
      <span className="badge badge-danger">
        <ShieldBan size={12} /> Blacklisted
      </span>
    )
  return (
    <span className="badge">
      <CircleHelp size={12} /> Unknown User
    </span>
  )
}

export function ActionBadge({ action }: { action: ActivityAction }) {
  switch (action) {
    case 'ACCEPTED':
      return (
        <span className="badge badge-success">
          <Check size={12} /> Invite Accepted
        </span>
      )
    case 'REJECTED':
      return (
        <span className="badge badge-danger">
          <X size={12} /> Invite Rejected
        </span>
      )
    case 'IGNORED':
      return (
        <span className="badge">
          <CircleDashed size={12} /> Invite left untouched
        </span>
      )
    default:
      return (
        <span className="badge badge-warning">
          <TriangleAlert size={12} /> Action failed
        </span>
      )
  }
}

const ACTION_TAG: Record<ActivityAction, string> = {
  ACCEPTED: 'tag-success',
  REJECTED: 'tag-danger',
  IGNORED: '',
  ERROR: 'tag-warning'
}

export function logTags(entry: ActivityEntry): { list: { text: string; cls: string }; action: { text: string; cls: string } } {
  const list =
    entry.kind === 'error'
      ? { text: 'SYSTEM', cls: 'tag-info' }
      : entry.listStatus === 'whitelist'
        ? { text: 'WHITELIST', cls: 'tag-success' }
        : entry.listStatus === 'blacklist'
          ? { text: 'BLACKLIST', cls: 'tag-danger' }
          : { text: entry.rule === 'TRUSTED_ONLY' ? 'TRUSTED ONLY' : 'UNKNOWN', cls: entry.rule === 'TRUSTED_ONLY' ? 'tag-accent' : '' }
  return { list, action: { text: entry.action, cls: ACTION_TAG[entry.action] } }
}
