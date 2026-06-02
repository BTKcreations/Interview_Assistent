const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  healthCheck: () => ipcRenderer.invoke('health-check'),
  toggleCaptureProtection: (enabled) => ipcRenderer.invoke('toggle-capture-protection', enabled),
  windowMoveStart: () => ipcRenderer.send('window-move-start'),
  windowMove: () => ipcRenderer.send('window-move'),
  windowMoveEnd: () => ipcRenderer.send('window-move-end'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onShortcutToggleMic: (callback) => {
    const subscription = (_event) => callback()
    ipcRenderer.on('shortcut-toggle-mic', subscription)
    return () => ipcRenderer.removeListener('shortcut-toggle-mic', subscription)
  },
  onShortcutSnapshot: (callback) => {
    const subscription = (_event) => callback()
    ipcRenderer.on('shortcut-toggle-snapshot', subscription)
    return () => ipcRenderer.removeListener('shortcut-toggle-snapshot', subscription)
  },
  onShortcutFocusInput: (callback) => {
    const subscription = (_event) => callback()
    ipcRenderer.on('shortcut-focus-input', subscription)
    return () => ipcRenderer.removeListener('shortcut-focus-input', subscription)
  }
})
