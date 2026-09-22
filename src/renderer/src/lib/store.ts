import { useSyncExternalStore } from 'react'
import type { AppSnapshot, ManagedUser, Toast } from '@shared/types'
import { api } from './api'

export type PageKey = 'dashboard' | 'whitelist' | 'blacklist' | 'activity' | 'settings'

interface State {
  snapshot: AppSnapshot | null
  users: ManagedUser[]
  toasts: Toast[]
  page: PageKey
  /** Bumped whenever a new activity entry arrives, so views can refresh. */
  activityVersion: number
}

let state: State = { snapshot: null, users: [], toasts: [], page: 'dashboard', activityVersion: 0 }
const listeners = new Set<() => void>()

function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function getState(): State {
  return state
}

export const actions = {
  navigate(page: PageKey) {
    set({ page })
  },
  setSnapshot(snapshot: AppSnapshot) {
    set({ snapshot })
  },
  setUsers(users: ManagedUser[]) {
    set({ users })
  },
  pushToast(toast: Omit<Toast, 'id'> & { id?: string }) {
    const t: Toast = { ...toast, id: toast.id ?? crypto.randomUUID() }
    set({ toasts: [...state.toasts, t].slice(-4) })
  },
  dismissToast(id: string) {
    set({ toasts: state.toasts.filter((t) => t.id !== id) })
  },
  activityArrived() {
    set({ activityVersion: state.activityVersion + 1 })
  }
}

/** Connects the store to the main process. Returns a cleanup function. */
export async function connectBackend(): Promise<() => void> {
  const bridge = api()
  const offs = [
    bridge.onSnapshot((s) => actions.setSnapshot(s)),
    bridge.onUsers((u) => actions.setUsers(u)),
    bridge.onActivity(() => actions.activityArrived()),
    bridge.onToast((t) => actions.pushToast(t))
  ]
  const [snapshot, users] = await Promise.all([bridge.snapshot(), bridge.listUsers()])
  actions.setSnapshot(snapshot)
  actions.setUsers(users)
  const online = () => bridge.networkOnline()
  window.addEventListener('online', online)
  return () => {
    offs.forEach((off) => off())
    window.removeEventListener('online', online)
  }
}

/** Shows a toast for a failed backend call. */
export function toastError(title: string, error: string): void {
  actions.pushToast({ tone: 'danger', title, message: error })
}
