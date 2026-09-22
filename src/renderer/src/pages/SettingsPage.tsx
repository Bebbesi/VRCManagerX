import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CircleCheck,
  Clock,
  FolderOpen,
  Info,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sun,
  TriangleAlert,
  UserRound,
  Zap
} from 'lucide-react'
import { REASON_LABELS, REASON_MAX_LENGTH, SLOT_MAX, SLOT_MIN } from '@shared/defaults'
import type { AppSnapshot, ReasonKey, Settings, SettingsPatch, SlotSyncState } from '@shared/types'
import { hasControlChars } from '@shared/validation'
import { Avatar, ConfirmDialog, Segmented, Spinner, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { relativeTime, shortDate } from '@/lib/format'
import { actions, toastError } from '@/lib/store'

const REASON_KEYS: ReasonKey[] = ['whitelistAccept', 'blacklistReject', 'trustedOnlyReject']
const REASON_HELP: Record<ReasonKey, string> = {
  whitelistAccept: 'Attached to the invite sent to whitelisted users.',
  blacklistReject: 'Sent when declining a blacklisted user.',
  trustedOnlyReject: 'Sent when Trusted Only declines a user who is not whitelisted.'
}

async function patchSettings(patch: SettingsPatch): Promise<boolean> {
  const res = await api().updateSettings(patch)
  if (!res.ok) toastError('Could not save settings', res.error)
  return res.ok
}

export function SettingsPage({ snapshot }: { snapshot: AppSnapshot }) {
  const s = snapshot.settings
  const [confirm, setConfirm] = useState<null | 'logout' | 'stats' | 'reset'>(null)

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-heading">
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Configure how invite requests are handled. Changes are saved automatically.</p>
        </div>
      </header>

      <div className="settings-layout">
        <AutomationSection settings={s} />
        <ReasonsSection snapshot={snapshot} />

        <Section icon={<Settings2 size={15} />} title="Application">
          <Row title="Theme" desc="Dark mode is the default.">
            <Segmented
              label="Theme"
              value={s.app.theme}
              onChange={(theme) => void patchSettings({ app: { theme } })}
              options={[
                { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
                { value: 'light', label: 'Light', icon: <Sun size={13} /> },
                { value: 'system', label: 'System', icon: <Monitor size={13} /> }
              ]}
            />
          </Row>
          <ToggleRow
            title="Keep running in the system tray"
            desc="Closing the window keeps the automation running in the background. Quit from the tray icon."
            checked={s.app.minimizeToTray}
            onChange={(v) => void patchSettings({ app: { minimizeToTray: v } })}
          />
          <ToggleRow
            title="Start with Windows"
            desc="Launch minimized to the tray when you sign in to Windows (installed version only)."
            checked={s.app.startWithWindows}
            onChange={(v) => void patchSettings({ app: { startWithWindows: v } })}
          />
          <ToggleRow
            title="In-app notifications"
            desc="Show a small notification whenever a request is handled."
            checked={s.app.showNotifications}
            onChange={(v) => void patchSettings({ app: { showNotifications: v } })}
          />
          <ToggleRow
            title="Keep me signed in"
            desc={
              snapshot.auth.secureStorageAvailable
                ? 'Store the VRChat session token encrypted with your Windows account (never the password).'
                : 'Unavailable: the operating system does not provide secure storage.'
            }
            checked={s.app.rememberSession && snapshot.auth.secureStorageAvailable}
            disabled={!snapshot.auth.secureStorageAvailable}
            onChange={(v) => void patchSettings({ app: { rememberSession: v } })}
          />
        </Section>

        <Section icon={<UserRound size={15} />} title="Account">
          {snapshot.auth.account && (
            <div className="setting-row">
              <Avatar name={snapshot.auth.account.displayName} url={snapshot.auth.account.avatarUrl} seed={snapshot.auth.account.id} size="lg" />
              <div className="setting-text">
                <div className="setting-title">{snapshot.auth.account.displayName}</div>
                <div className="setting-desc">
                  {snapshot.auth.account.username ? `@${snapshot.auth.account.username} · ` : ''}
                  <span className="mono">{snapshot.auth.account.id}</span>
                </div>
              </div>
              <button type="button" className="btn btn-danger" onClick={() => setConfirm('logout')}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
          <div className="callout callout-info" style={{ marginTop: 6 }}>
            <ShieldCheck size={16} />
            <div>
              Your password is never stored. Session tokens are encrypted by Windows, never shown in the interface and never written to logs.
              Signing out invalidates the session on VRChat and deletes it from this computer.
            </div>
          </div>
        </Section>

        <AdvancedSection snapshot={snapshot} onResetStats={() => setConfirm('stats')} onResetAll={() => setConfirm('reset')} />

        <div className="faint" style={{ fontSize: 12, textAlign: 'center', padding: '6px 0 0' }}>
          VRCManagerX v{snapshot.version} · Uses VRChat's unofficial, community-documented API. Not affiliated with VRChat Inc.
        </div>
      </div>

      {confirm === 'logout' && (
        <ConfirmDialog
          title="Sign out of VRChat?"
          message="Automatic invite management stops until you sign in again. Your lists and settings are kept."
          confirmLabel="Sign out"
          icon={<LogOut size={18} />}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => api().logout()}
        />
      )}
      {confirm === 'stats' && (
        <ConfirmDialog
          title="Reset statistics?"
          message="Dashboard counters go back to zero. The activity log is not affected."
          confirmLabel="Reset"
          icon={<RotateCcw size={18} />}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => api().resetStats()}
        />
      )}
      {confirm === 'reset' && (
        <ConfirmDialog
          title="Reset all settings?"
          message="All settings, including custom reasons, return to their defaults. Your whitelist, blacklist and log are kept."
          confirmLabel="Reset settings"
          icon={<RotateCcw size={18} />}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const res = await api().resetSettings('all')
            if (!res.ok) toastError('Could not reset settings', res.error)
          }}
        />
      )}
    </div>
  )
}

function AutomationSection({ settings }: { settings: Settings }) {
  const a = settings.automation
  const [age, setAge] = useState(String(a.pendingMaxAgeMinutes))
  useEffect(() => {
    setAge(String(a.pendingMaxAgeMinutes))
  }, [a.pendingMaxAgeMinutes])
  const set = (patch: Partial<Settings['automation']>) => void patchSettings({ automation: patch })

  return (
    <Section icon={<Zap size={15} />} title="Automation" desc="Priority: Blacklist, then Whitelist, then Trusted Only, then manual.">
      <ToggleRow
        title="Enable automatic invite management"
        desc="Master switch. When off, no request is ever accepted or rejected automatically."
        checked={a.enabled}
        onChange={(v) => set({ enabled: v })}
        tone="success"
      />
      <ToggleRow
        title="Trusted Only"
        desc="Accept whitelisted users and automatically reject everyone else. No request is left pending."
        checked={a.trustedOnly}
        disabled={!a.enabled}
        onChange={(v) => set({ trustedOnly: v })}
      />
      <ToggleRow
        title="Automatic whitelist acceptance"
        desc="Invite whitelisted users to your current instance."
        checked={a.autoAcceptWhitelist}
        disabled={!a.enabled}
        onChange={(v) => set({ autoAcceptWhitelist: v })}
      />
      <ToggleRow
        title="Automatic blacklist rejection"
        desc="Decline requests from blacklisted users."
        checked={a.autoRejectBlacklist}
        disabled={!a.enabled}
        onChange={(v) => set({ autoRejectBlacklist: v })}
      />
      <ToggleRow
        title="Only while my status is Ask Me"
        desc="Requests received with any other status are left for you to handle."
        checked={a.onlyWhenAskMe}
        disabled={!a.enabled}
        onChange={(v) => set({ onlyWhenAskMe: v })}
      />
      <ToggleRow
        title="Handle requests received while the app was closed"
        desc="When connecting, also process still-pending requests that are recent enough."
        checked={a.processPendingOnStartup}
        disabled={!a.enabled}
        onChange={(v) => set({ processPendingOnStartup: v })}
      />
      {a.processPendingOnStartup && (
        <Row title="Maximum age of pending requests" desc="Older requests are left alone." indent disabled={!a.enabled}>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              type="number"
              min={1}
              max={1440}
              value={age}
              disabled={!a.enabled}
              style={{ width: 90 }}
              aria-label="Maximum age in minutes"
              onChange={(e) => setAge(e.target.value)}
              onBlur={() => {
                const n = Math.round(Number(age))
                if (Number.isFinite(n) && n >= 1 && n <= 1440) set({ pendingMaxAgeMinutes: n })
                else setAge(String(a.pendingMaxAgeMinutes))
              }}
            />
            <span className="faint">minutes</span>
          </div>
        </Row>
      )}
    </Section>
  )
}

type Drafts = Record<ReasonKey, { text: string; slot: number }>

function ReasonsSection({ snapshot }: { snapshot: AppSnapshot }) {
  const s = snapshot.settings
  const saved: Drafts = useMemo(
    () => ({
      whitelistAccept: { ...s.reasons.whitelistAccept },
      blacklistReject: { ...s.reasons.blacklistReject },
      trustedOnlyReject: { ...s.reasons.trustedOnlyReject }
    }),
    [s.reasons]
  )
  const [drafts, setDrafts] = useState<Drafts>(saved)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  useEffect(() => {
    setDrafts(saved)
  }, [saved])

  const dirty = REASON_KEYS.some((k) => drafts[k].text !== saved[k].text || drafts[k].slot !== saved[k].slot)
  const errors = Object.fromEntries(REASON_KEYS.map((k) => [k, validateReason(drafts[k].text)])) as Record<ReasonKey, string | null>
  const slotClash = drafts.blacklistReject.slot === drafts.trustedOnlyReject.slot
  const invalid = REASON_KEYS.some((k) => errors[k]) || slotClash
  const slotState = (k: ReasonKey) => snapshot.slots.find((x) => x.key === k)

  const save = async () => {
    setSaving(true)
    const patch: SettingsPatch = { reasons: {} }
    for (const k of REASON_KEYS) {
      if (drafts[k].text !== saved[k].text || drafts[k].slot !== saved[k].slot) patch.reasons![k] = { text: drafts[k].text.trim(), slot: drafts[k].slot }
    }
    const ok = await patchSettings(patch)
    setSaving(false)
    if (ok) actions.pushToast({ tone: 'success', title: 'Reasons saved', message: 'The new messages are being written to your VRChat message slots.' })
  }

  return (
    <Section
      icon={<MessageSquare size={15} />}
      title="Custom Reasons"
      desc="VRChat only delivers texts stored in your account's invite message slots (12 per type). Each slot can be changed once every 60 minutes."
      footer={
        <div className="save-bar">
          {slotClash && (
            <span className="field-error row" style={{ gap: 6 }}>
              <TriangleAlert size={14} /> The two reject reasons need different slots.
            </span>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const res = await api().resetSettings('reasons')
              if (!res.ok) toastError('Could not reset reasons', res.error)
            }}
          >
            <RotateCcw size={13} /> Defaults
          </button>
          <button type="button" className="btn btn-sm" disabled={!dirty} onClick={() => setDrafts(saved)}>
            Discard
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || invalid || saving} onClick={() => void save()}>
            {saving ? <Spinner size={13} /> : <Save size={13} />} Save reasons
          </button>
        </div>
      }
    >
      <ToggleRow
        title="Send reason messages"
        desc="Attach these messages to accepts and declines. When off, accepts are sent without a message and declines are silent."
        checked={s.automation.sendReasonMessages}
        onChange={(v) => void patchSettings({ automation: { sendReasonMessages: v } })}
      />
      {REASON_KEYS.map((k) => (
        <div className="reason-editor" key={k}>
          <label className="field">
            <span className="field-label">
              {REASON_LABELS[k]}
              <span className={`char-count ${drafts[k].text.length > REASON_MAX_LENGTH ? 'over' : ''}`}>
                {drafts[k].text.length}/{REASON_MAX_LENGTH}
              </span>
            </span>
            <input
              className={`input ${errors[k] ? 'invalid' : ''}`}
              value={drafts[k].text}
              disabled={!s.automation.sendReasonMessages}
              onChange={(e) => setDrafts({ ...drafts, [k]: { ...drafts[k], text: e.target.value } })}
            />
          </label>
          <label className="field">
            <span className="field-label">{k === 'whitelistAccept' ? 'Invite slot' : 'Decline slot'}</span>
            <select
              className="select"
              value={drafts[k].slot}
              disabled={!s.automation.sendReasonMessages}
              onChange={(e) => setDrafts({ ...drafts, [k]: { ...drafts[k], slot: Number(e.target.value) } })}
            >
              {Array.from({ length: SLOT_MAX - SLOT_MIN + 1 }, (_, i) => i + SLOT_MIN).map((n) => (
                <option key={n} value={n}>
                  Slot {n + 1}
                </option>
              ))}
            </select>
          </label>
          <div className="full field-hint">{errors[k] ?? REASON_HELP[k]}</div>
          <div className="full">
            <SlotStatus state={slotState(k)} loggedIn={snapshot.auth.phase === 'logged_in'} />
          </div>
        </div>
      ))}
      {snapshot.auth.phase === 'logged_in' && s.automation.sendReasonMessages && (
        <div className="row" style={{ paddingBottom: 4 }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true)
              const res = await api().syncSlots()
              setSyncing(false)
              if (!res.ok) toastError('Could not sync message slots', res.error)
            }}
          >
            <RefreshCw size={13} className={syncing ? 'spinner' : undefined} /> Check slots on VRChat
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            Tip: use slots you don't use in-game, so your own messages are not overwritten.
          </span>
        </div>
      )}
    </Section>
  )
}

function validateReason(text: string): string | null {
  const t = text.trim()
  if (!t) return 'The message cannot be empty.'
  if (t.length > REASON_MAX_LENGTH) return `Keep it under ${REASON_MAX_LENGTH} characters.`
  if (hasControlChars(t)) return 'The message contains invalid characters.'
  return null
}

function SlotStatus({ state, loggedIn }: { state: SlotSyncState | undefined; loggedIn: boolean }) {
  if (!state) return null
  if (state.status === 'disabled') return <div className="reason-status">Reason messages are turned off.</div>
  if (!loggedIn) return <div className="reason-status">Sign in to sync this message with VRChat.</div>
  const current = state.currentText !== undefined && state.currentText !== state.desiredText ? state.currentText : null
  let badge: ReactNode
  switch (state.status) {
    case 'synced':
      badge = (
        <span className="badge badge-success">
          <CircleCheck size={12} /> Saved on VRChat
        </span>
      )
      break
    case 'syncing':
      badge = (
        <span className="badge badge-info">
          <Spinner size={11} /> Saving...
        </span>
      )
      break
    case 'cooldown':
      badge = (
        <span className="badge badge-warning" title={state.retryAt ? `Retry ${relativeTime(state.retryAt)}` : undefined}>
          <Clock size={12} /> Slot cooldown{state.retryAt ? `, retrying ${relativeTime(state.retryAt)}` : ''}
        </span>
      )
      break
    case 'error':
      badge = (
        <span className="badge badge-danger" title={state.error}>
          <TriangleAlert size={12} /> {state.error ?? 'Sync failed'}
        </span>
      )
      break
    default:
      badge = (
        <span className="badge">
          <Spinner size={11} /> Checking slot...
        </span>
      )
  }
  return (
    <div className="reason-status">
      {badge}
      {current && (
        <span className="truncate" title={current}>
          VRChat currently sends: "{current}"
        </span>
      )}
    </div>
  )
}

function AdvancedSection(props: { snapshot: AppSnapshot; onResetStats: () => void; onResetAll: () => void }) {
  const saved = props.snapshot.settings.app.userAgentContact
  const [contact, setContact] = useState(saved)
  useEffect(() => {
    setContact(saved)
  }, [saved])
  return (
    <Section icon={<Info size={15} />} title="Advanced">
      <Row
        title="Contact for API identification"
        desc="VRChat asks apps to identify themselves with contact info in the User-Agent (e.g. your Discord or email). Optional; stored locally."
      >
        <input
          className="input"
          style={{ width: 240 }}
          value={contact}
          maxLength={80}
          placeholder="e.g. discord: yourname"
          onChange={(e) => setContact(e.target.value)}
          onBlur={() => {
            if (contact.trim() !== saved) void patchSettings({ app: { userAgentContact: contact.trim() } })
          }}
        />
      </Row>
      <Row title="Data folder" desc="Settings, lists, logs and the encrypted session are stored here.">
        <button type="button" className="btn btn-sm" onClick={() => void api().openDataFolder()}>
          <FolderOpen size={14} /> Open folder
        </button>
      </Row>
      <Row title="Statistics" desc={`Counting since ${shortDate(props.snapshot.stats.since)}.`}>
        <button type="button" className="btn btn-sm" onClick={props.onResetStats}>
          <RotateCcw size={14} /> Reset statistics
        </button>
      </Row>
      <Row title="Reset settings" desc="Restore every setting to its default value.">
        <button type="button" className="btn btn-sm btn-danger" onClick={props.onResetAll}>
          <RotateCcw size={14} /> Reset all settings
        </button>
      </Row>
    </Section>
  )
}

function Section(props: { icon: ReactNode; title: string; desc?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card settings-section">
      <div className="card-header">
        <h2 className="card-title">
          {props.icon}
          {props.title}
        </h2>
      </div>
      {props.desc && <p className="settings-desc">{props.desc}</p>}
      <div className="card-body">{props.children}</div>
      {props.footer}
    </section>
  )
}

function Row(props: { title: string; desc?: ReactNode; children: ReactNode; indent?: boolean; disabled?: boolean }) {
  return (
    <div className={`setting-row ${props.indent ? 'indent' : ''} ${props.disabled ? 'disabled' : ''}`}>
      <div className="setting-text">
        <div className="setting-title">{props.title}</div>
        {props.desc && <div className="setting-desc">{props.desc}</div>}
      </div>
      {props.children}
    </div>
  )
}

function ToggleRow(props: {
  title: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  tone?: 'success'
}) {
  return (
    <Row title={props.title} desc={props.desc} disabled={props.disabled}>
      <Switch checked={props.checked} onChange={props.onChange} disabled={props.disabled} label={props.title} tone={props.tone} />
    </Row>
  )
}
