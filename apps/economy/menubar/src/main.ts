import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  shell,
  ipcMain,
  screen,
} from 'electron'
import * as path from 'path'
import * as cp from 'child_process'

const ECONOMY_URL = process.env['ECONOMY_URL'] ?? 'http://localhost:3456'
const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
const SYNC_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes
const REFRESH_INTERVAL_MS = 60 * 1000   // 1 minute

interface CostSummary {
  total_usd: number
  sessions: number
  requests: number
  tokens: number
  period: string
}

interface ApiResponse<T> {
  data: T
  meta: Record<string, unknown>
}

let tray: Tray | null = null
let popupWindow: BrowserWindow | null = null
let lastSync: Date | null = null

let statsCache = {
  today: 0,
  week: 0,
  month: 0,
  lastSync: null as string | null,
}

async function fetchSummary(period: string): Promise<number> {
  try {
    const res = await fetch(`${ECONOMY_URL}/api/summary?period=${period}`)
    if (!res.ok) return 0
    const body = (await res.json()) as ApiResponse<CostSummary>
    return body.data.total_usd
  } catch {
    return 0
  }
}

async function refreshStats(): Promise<void> {
  const [today, week, month] = await Promise.all([
    fetchSummary('today'),
    fetchSummary('week'),
    fetchSummary('month'),
  ])

  statsCache = {
    today,
    week,
    month,
    lastSync: lastSync ? lastSync.toISOString() : null,
  }

  updateTrayTitle(today)

  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('stats-update', statsCache)
  }
}

function updateTrayTitle(todayCost: number): void {
  if (!tray) return
  const label = `$${todayCost.toFixed(2)}`
  tray.setTitle(label)
  tray.setToolTip(`Economy: ${label} today`)
}

function createTrayIcon(): Electron.NativeImage {
  // 16x16 PNG with a white dollar-sign circle, suitable for macOS dark/light menu bar
  // Generated as a base64-encoded 1x1 white pixel PNG scaled by Electron
  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="white" opacity="0.9"/>
    <text x="8" y="12" font-family="Helvetica" font-size="10" font-weight="bold" text-anchor="middle" fill="black">$</text>
  </svg>`
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgIcon).toString('base64')}`
  const img = nativeImage.createFromDataURL(dataUrl)
  img.setTemplateImage(true)
  return img
}

function getPopupPosition(tray: Tray, win: BrowserWindow): { x: number; y: number } {
  const trayBounds = tray.getBounds()
  const winBounds = win.getBounds()
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
  const { workArea } = display

  // Center horizontally on tray icon
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2)
  // Place below the tray (top of screen on macOS)
  let y = Math.round(trayBounds.y + trayBounds.height + 4)

  // If below screen bottom, flip above tray
  if (y + winBounds.height > workArea.y + workArea.height) {
    y = Math.round(trayBounds.y - winBounds.height - 4)
  }

  // Clamp to work area
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winBounds.width))
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - winBounds.height))

  return { x, y }
}

function createPopup(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js')
  const win = new BrowserWindow({
    width: 300,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile(path.join(__dirname, '..', 'src', 'popup.html'))

  win.on('blur', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide()
    }
  })

  return win
}

function togglePopup(): void {
  if (!tray) return

  if (!popupWindow || popupWindow.isDestroyed()) {
    popupWindow = createPopup()
  }

  if (popupWindow.isVisible()) {
    popupWindow.hide()
    return
  }

  const pos = getPopupPosition(tray, popupWindow)
  popupWindow.setPosition(pos.x, pos.y)
  popupWindow.show()

  // Push latest stats immediately when popup opens
  popupWindow.webContents.send('stats-update', statsCache)
}

async function runSync(): Promise<void> {
  return new Promise((resolve) => {
    // Try to trigger sync via API first; fall back to spawning the CLI
    fetch(`${ECONOMY_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: 'all' }),
    })
      .then(async (res) => {
        if (res.ok) {
          lastSync = new Date()
          await refreshStats()
        }
        resolve()
      })
      .catch(() => {
        // Fall back to CLI
        const proc = cp.spawn('economy', ['sync'], { stdio: 'ignore' })
        proc.on('close', async () => {
          lastSync = new Date()
          await refreshStats()
          resolve()
        })
        proc.on('error', () => resolve()) // silently ignore if CLI not found
      })
  })
}

app.on('ready', async () => {
  // Hide from dock on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  // Create tray
  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setTitle('$—')
  tray.setToolTip('Economy')

  // Context menu as fallback (right-click)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => shell.openExternal(DASHBOARD_URL) },
    { label: 'Sync Now', click: () => runSync() },
    { type: 'separator' },
    { label: 'Quit Economy', click: () => app.quit() },
  ])
  tray.setContextMenu(contextMenu)

  // Left-click toggles popup
  tray.on('click', () => togglePopup())

  // IPC handlers for popup buttons
  ipcMain.handle('sync-now', async () => {
    await runSync()
    return statsCache
  })

  ipcMain.handle('open-dashboard', () => {
    shell.openExternal(DASHBOARD_URL)
  })

  ipcMain.handle('quit', () => {
    app.quit()
  })

  // Initial data load
  await refreshStats()

  // Auto-sync every 5 minutes
  setInterval(() => runSync(), SYNC_INTERVAL_MS)

  // Refresh display every 60 seconds (recalculate "today" etc.)
  setInterval(() => refreshStats(), REFRESH_INTERVAL_MS)
})

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit when all windows close
})

// Prevent second instance
app.requestSingleInstanceLock()
app.on('second-instance', () => {
  togglePopup()
})
