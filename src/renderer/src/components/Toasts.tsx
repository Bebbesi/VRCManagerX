import { useEffect, useState } from 'react'
import { Check, Info, TriangleAlert, X } from 'lucide-react'
import type { Toast } from '@shared/types'
import { actions, useStore } from '@/lib/store'

const DURATION = 6000

function ToastItem({ toast }: { toast: Toast }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const leave = setTimeout(() => setLeaving(true), DURATION)
    const remove = setTimeout(() => actions.dismissToast(toast.id), DURATION + 220)
    return () => {
      clearTimeout(leave)
      clearTimeout(remove)
    }
  }, [toast.id])
  const Icon = toast.tone === 'success' ? Check : toast.tone === 'danger' ? X : toast.tone === 'warning' ? TriangleAlert : Info
  return (
    <div className={`toast ${toast.tone} ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite">
      <div className="toast-icon">
        <Icon size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="toast-title">{toast.title}</div>
        <div className="toast-message">{toast.message}</div>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm toast-close"
        aria-label="Dismiss notification"
        onClick={() => {
          setLeaving(true)
          setTimeout(() => actions.dismissToast(toast.id), 200)
        }}
      >
        <X size={14} />
      </button>
      <div className="toast-progress" style={{ animationDuration: `${DURATION}ms` }} />
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
