import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('economy', {
  syncNow: () => ipcRenderer.invoke('sync-now'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  quit: () => ipcRenderer.invoke('quit'),
  onStats: (cb: (stats: unknown) => void) => {
    ipcRenderer.on('stats-update', (_event, data: unknown) => cb(data))
  },
})
