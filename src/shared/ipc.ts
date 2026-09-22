import type {
  ActivityEntry,
  ActivityPage,
  ActivityQuery,
  AddUserOutcome,
  AppSnapshot,
  ListKind,
  LoginOutcome,
  ManagedUser,
  Result,
  SettingsPatch,
  Settings,
  Toast,
  TwoFactorMethod,
  UserLookupResult
} from './types'

/** Invoke channels (renderer -> main, request/response). */
export const IPC = {
  snapshot: 'app:snapshot',
  login: 'auth:login',
  verify2fa: 'auth:verify2fa',
  cancel2fa: 'auth:cancel2fa',
  logout: 'auth:logout',
  updateSettings: 'settings:update',
  resetSettings: 'settings:reset',
  listUsers: 'users:list',
  addUser: 'users:add',
  removeUser: 'users:remove',
  moveUser: 'users:move',
  updateUser: 'users:update',
  refreshUser: 'users:refresh',
  lookupUsers: 'users:lookup',
  listFriends: 'users:friends',
  queryActivity: 'activity:query',
  clearActivity: 'activity:clear',
  exportActivity: 'activity:export',
  resetStats: 'stats:reset',
  syncSlots: 'slots:sync',
  reconnect: 'connection:reconnect',
  openDataFolder: 'app:openDataFolder',
  openExternal: 'app:openExternal',
  networkOnline: 'app:networkOnline',
  reportError: 'app:reportError'
} as const

/** Push channels (main -> renderer). */
export const EVT = {
  snapshot: 'evt:snapshot',
  users: 'evt:users',
  activity: 'evt:activity',
  toast: 'evt:toast'
} as const

export interface FriendsPage {
  users: UserLookupResult[]
  hasMore: boolean
}

/** The API exposed to the renderer by the preload script as `window.vrcmx`. */
export interface VrcmxApi {
  snapshot(): Promise<AppSnapshot>
  login(input: { username: string; password: string; remember: boolean }): Promise<Result<LoginOutcome>>
  verify2fa(input: { method: TwoFactorMethod; code: string }): Promise<Result<LoginOutcome>>
  cancel2fa(): Promise<void>
  logout(): Promise<void>

  updateSettings(patch: SettingsPatch): Promise<Result<Settings>>
  resetSettings(section: 'reasons' | 'all'): Promise<Result<Settings>>

  listUsers(): Promise<ManagedUser[]>
  addUser(input: { user: UserLookupResult; list: ListKind; note?: string; move?: boolean }): Promise<Result<AddUserOutcome>>
  removeUser(id: string): Promise<Result<true>>
  moveUser(id: string, to: ListKind): Promise<Result<ManagedUser>>
  updateUser(id: string, patch: { note?: string; displayName?: string }): Promise<Result<ManagedUser>>
  refreshUser(id: string): Promise<Result<ManagedUser>>
  lookupUsers(query: string): Promise<Result<UserLookupResult[]>>
  listFriends(input: { offline: boolean; offset: number }): Promise<Result<FriendsPage>>

  queryActivity(query: ActivityQuery): Promise<ActivityPage>
  clearActivity(): Promise<void>
  exportActivity(format: 'csv' | 'json'): Promise<Result<string | null>>
  resetStats(): Promise<void>

  syncSlots(): Promise<Result<true>>
  reconnect(): Promise<void>
  openDataFolder(): Promise<void>
  openExternal(url: string): Promise<void>
  networkOnline(): void
  /** Records a UI error in the diagnostic log (errors.log). */
  reportError(message: string): void

  onSnapshot(cb: (s: AppSnapshot) => void): () => void
  onUsers(cb: (users: ManagedUser[]) => void): () => void
  onActivity(cb: (entry: ActivityEntry) => void): () => void
  onToast(cb: (toast: Toast) => void): () => void
}
