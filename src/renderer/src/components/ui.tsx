import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, LoaderCircle, X } from 'lucide-react'
import { colorFor, copyText, imageSrc, initials } from '@/lib/format'

export function Switch(props: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
  size?: 'md' | 'lg'
  tone?: 'accent' | 'success'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className={`switch ${props.size === 'lg' ? 'switch-lg' : ''} ${props.tone === 'success' ? 'success' : ''}`}
      onClick={() => props.onChange(!props.checked)}
    />
  )
}

export function Avatar(props: { name: string; url?: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; seed?: string }) {
  const [failed, setFailed] = useState(false)
  const src = imageSrc(props.url)
  useEffect(() => {
    setFailed(false)
  }, [props.url])
  const sizeClass = props.size && props.size !== 'md' ? `avatar-${props.size}` : ''
  return (
    <div className={`avatar ${sizeClass}`} style={{ background: src && !failed ? undefined : colorFor(props.seed ?? props.name) }} aria-hidden>
      {src && !failed ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : initials(props.name)}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className="spinner" aria-label="Loading" />
}

export function Modal(props: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  tone?: 'danger'
  size?: 'sm' | 'md'
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.size === 'sm' ? 'modal-sm' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-header">
          {props.icon && <div className={`modal-icon ${props.tone === 'danger' ? 'danger' : ''}`}>{props.icon}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{props.title}</h2>
            {props.description && <p>{props.description}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={props.onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {props.children && <div className="modal-body">{props.children}</div>}
        {props.footer && <div className="modal-footer">{props.footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog(props: {
  title: string
  message: ReactNode
  confirmLabel: string
  icon: ReactNode
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={props.title}
      description={props.message}
      icon={props.icon}
      tone={props.danger ? 'danger' : undefined}
      size="sm"
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await props.onConfirm()
              } finally {
                setBusy(false)
              }
              props.onClose()
            }}
          >
            {busy && <Spinner size={14} />}
            {props.confirmLabel}
          </button>
        </>
      }
    />
  )
}

export function EmptyState(props: { icon: ReactNode; title: string; message: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon}</div>
      <h3>{props.title}</h3>
      <p>{props.message}</p>
      {props.action}
    </div>
  )
}

export function CopyId({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="copy-id"
      title={`Copy ${label ?? 'value'}`}
      onClick={async (e) => {
        e.stopPropagation()
        if (await copyText(value)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }
      }}
    >
      <span className="truncate">{value}</span>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

export function Segmented<T extends string>(props: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  label: string
}) {
  return (
    <div className="seg" role="tablist" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={props.value === o.value}
          className={`seg-item ${props.value === o.value ? 'active' : ''}`}
          onClick={() => props.onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
