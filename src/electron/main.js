const { app, BrowserWindow, ipcMain, screen, desktopCapturer, session, shell, globalShortcut } = require('electron')
const path = require('path')
const { fork } = require('child_process')

const isDev = !app.isPackaged
let mainWindow
let backendProcess

// REQUIRED FOR TRANSPARENCY ON SOME WINDOWS MACHINES
app.disableHardwareAcceleration()

function logToFile(msg) {
  const fs = require('fs')
  const logPath = path.join(app.getPath('userData'), 'ghost-debug.log')
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`)
}

function startBackend() {
  if (isDev) return

  const appPath = app.getAppPath().replace('app.asar', 'app.asar.unpacked')
  const serverPath = path.join(appPath, 'src', 'backend', 'server.js')
  const envPath = path.join(appPath, '.env')

  logToFile(`app.getAppPath() = ${app.getAppPath()}`)
  logToFile(`appPath = ${appPath}`)
  logToFile(`serverPath = ${serverPath}`)
  logToFile(`envPath = ${envPath}`)
  logToFile(`fs.existsSync(serverPath) = ${require('fs').existsSync(serverPath)}`)
  logToFile(`fs.existsSync(envPath) = ${require('fs').existsSync(envPath)}`)
  logToFile(`userData = ${app.getPath('userData')}`)

  backendProcess = fork(serverPath, [], {
    silent: true,
    cwd: appPath,
    env: { ...process.env, DOTENV_CONFIG_PATH: envPath }
  })
  backendProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim()
    console.log('[backend]', msg)
    logToFile(`[stdout] ${msg}`)
  })
  backendProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim()
    console.error('[backend]', msg)
    logToFile(`[stderr] ${msg}`)
  })
  backendProcess.on('error', (err) => {
    console.error('[electron] Backend failed to start:', err)
    logToFile(`[error] ${err.message}`)
  })
  backendProcess.on('exit', (code) => {
    console.log('[electron] Backend exited with code:', code)
    logToFile(`[exit] code=${code}`)
  })
}

// Force enable speech recognition flags
app.commandLine.appendSwitch('enable-speech-dispatcher')
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI')

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: Math.min(screenW, 800),
    height: 500,
    x: Math.max(0, Math.floor((screenW - Math.min(screenW, 800)) / 2)),
    y: 0,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000', // ENFORCE TRANSPARENT BACKGROUND
    alwaysOnTop: true,
    hasShadow: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // SPOOF USER AGENT TO UNLOCK GOOGLE SPEECH API
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  mainWindow.webContents.setUserAgent(chromeUA)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools({ mode: 'undocked' })
  } else {
    // USE ABSOLUTE PATH FROM APP ROOT
    const indexPath = path.join(app.getAppPath(), 'dist/index.html')
    mainWindow.loadFile(indexPath)
  }

  // Grant permissions for microphone and speech recognition access automatically
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'audio-capture', 'speech-recognition']
    if (allowedPermissions.includes(permission)) {
      callback(true)
    } else {
      callback(false)
    }
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'audio-capture', 'speech-recognition']
    return allowedPermissions.includes(permission)
  })

  // Enable screen capture protection immediately after window creation
  // This makes the window INVISIBLE in screen shares (Zoom, Teams, Discord, OBS, etc.)
  setWindowCaptureProtection(true)
}

function setWindowCaptureProtection(enabled) {
  try {
    if (!mainWindow) return
    // setContentProtection(true) uses WDA_EXCLUDEFROMCAPTURE on Windows 10 2004+
    // On macOS it uses NSWindowSharingNone
    // The window becomes completely invisible in screen capture/sharing
    mainWindow.setContentProtection(enabled)
    console.log(`Screen capture protection: ${enabled ? 'ON' : 'OFF'} — window is ${enabled ? 'hidden' : 'visible'} in screen shares`)
  } catch (error) {
    console.warn('Failed to set screen capture protection:', error.message)
  }
}

app.whenReady().then(async () => {
  startBackend()
  // Give backend a moment to bind port, then create window
  await new Promise(r => setTimeout(r, 1500))
  createWindow()

  // Register Global Shortcuts for Stealth Mode
  globalShortcut.register('Alt+M', () => {
    if (mainWindow) mainWindow.webContents.send('shortcut-toggle-mic')
  })
  globalShortcut.register('Alt+S', () => {
    if (mainWindow) mainWindow.webContents.send('shortcut-toggle-snapshot')
  })
  globalShortcut.register('Alt+Q', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.send('shortcut-focus-input')
    }
  })
})

app.on('will-quit', () => {
  if (backendProcess) backendProcess.kill()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

ipcMain.handle('health-check', () => ({ status: 'ok' }))

ipcMain.handle('toggle-capture-protection', (_event, enabled) => {
  setWindowCaptureProtection(enabled)
  return { enabled }
})

ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: 1920, height: 1080 } 
    })
    if (sources.length > 0) {
      // Use the first screen source
      return sources[0].thumbnail.toDataURL()
    }
    throw new Error('No screen sources found')
  } catch (error) {
    console.error('Screen capture error:', error)
    throw error
  }
})

// Window drag support for frameless window
ipcMain.on('window-move-start', () => {
  if (!mainWindow) return
  const [wx, wy] = mainWindow.getPosition()
  const cursor = screen.getCursorScreenPoint()
  mainWindow._dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
})

ipcMain.on('window-move', () => {
  if (!mainWindow || !mainWindow._dragOffset) return
  const cursor = screen.getCursorScreenPoint()
  mainWindow.setPosition(
    cursor.x - mainWindow._dragOffset.x,
    cursor.y - mainWindow._dragOffset.y
  )
})

ipcMain.on('window-move-end', () => {
  if (mainWindow) mainWindow._dragOffset = null
})

ipcMain.on('resize-window', (event, height) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const maxHeight = Math.floor(screenH * 0.9)
  const minHeight = 180
  const newHeight = Math.max(minHeight, Math.min(maxHeight, Math.ceil(height)))
  const [, currentH] = mainWindow.getSize()
  if (Math.abs(currentH - newHeight) > 4) {
    mainWindow.setSize(mainWindow.getSize()[0], newHeight)
  }
})

ipcMain.handle('open-external', async (event, url) => {
  return shell.openExternal(url)
})
