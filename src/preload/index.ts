import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVT, IPC, type VrcmxApi } from '@shared/ipc'

// The only bridge between the UI and the main process. It exposes narrow, typed
// functions; no Node.js or Electron objects ever reach the page.

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: VrcmxApi = {
  snapshot: () => ipcRenderer.invoke(IPC.snapshot),
  login: (input) => ipcRenderer.invoke(IPC.login, input),
  verify2fa: (input) => ipcRenderer.invoke(IPC.verify2fa, input),
  cancel2fa: () => ipcRenderer.invoke(IPC.cancel2fa),
  logout: () => ipcRenderer.invoke(IPC.logout),

  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  resetSettings: (section) => ipcRenderer.invoke(IPC.resetSettings, section),

  listUsers: () => ipcRenderer.invoke(IPC.listUsers),
  addUser: (input) => ipcRenderer.invoke(IPC.addUser, input),
  removeUser: (id) => ipcRenderer.invoke(IPC.removeUser, id),
  moveUser: (id, to) => ipcRenderer.invoke(IPC.moveUser, id, to),
  updateUser: (id, patch) => ipcRenderer.invoke(IPC.updateUser, id, patch),
  refreshUser: (id) => ipcRenderer.invoke(IPC.refreshUser, id),
  lookupUsers: (query) => ipcRenderer.invoke(IPC.lookupUsers, query),
  listFriends: (input) => ipcRenderer.invoke(IPC.listFriends, input),

  queryActivity: (query) => ipcRenderer.invoke(IPC.queryActivity, query),
  clearActivity: () => ipcRenderer.invoke(IPC.clearActivity),
  exportActivity: (format) => ipcRenderer.invoke(IPC.exportActivity, format),
  resetStats: () => ipcRenderer.invoke(IPC.resetStats),

  syncSlots: () => ipcRenderer.invoke(IPC.syncSlots),
  reconnect: () => ipcRenderer.invoke(IPC.reconnect),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  networkOnline: () => ipcRenderer.send(IPC.networkOnline),
  reportError: (message) => ipcRenderer.send(IPC.reportError, String(message).slice(0, 4000)),

  onSnapshot: (cb) => subscribe(EVT.snapshot, cb),
  onUsers: (cb) => subscribe(EVT.users, cb),
  onActivity: (cb) => subscribe(EVT.activity, cb),
  onToast: (cb) => subscribe(EVT.toast, cb)
}

contextBridge.exposeInMainWorld('vrcmx', api)
