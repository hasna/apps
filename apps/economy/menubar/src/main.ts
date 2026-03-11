import {
  app,
  BrowserWindow,
  Tray,
  nativeImage,
  shell,
  ipcMain,
  screen,
} from 'electron'
import * as path from 'path'

const ECONOMY_URL = process.env['ECONOMY_URL'] ?? 'http://localhost:3456'
const SYNC_INTERVAL_MS = 30 * 1000  // 30 seconds
const REFRESH_INTERVAL_MS = 30 * 1000

interface Summary { total_usd: number; sessions: number; requests: number; tokens: number }
interface ProjectStat { project_name: string; project_path: string; cost_usd: number; sessions: number }

let tray: Tray | null = null
let popupWindow: BrowserWindow | null = null
let lastSync: Date | null = null

let statsCache = {
  today: 0, week: 0, month: 0,
  lastSync: null as string | null,
  topProjects: [] as ProjectStat[],
}

function fmtUsd(n: number): string {
  if (n >= 0.01) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return '$' + n.toFixed(4)
}

async function fetchJson<T>(urlPath: string): Promise<T | null> {
  try {
    const res = await fetch(`${ECONOMY_URL}${urlPath}`)
    if (!res.ok) return null
    const body = await res.json() as { data: T }
    return body.data
  } catch { return null }
}

async function refreshStats(): Promise<void> {
  const [today, week, month, projects] = await Promise.all([
    fetchJson<Summary>('/api/summary?period=today'),
    fetchJson<Summary>('/api/summary?period=week'),
    fetchJson<Summary>('/api/summary?period=month'),
    fetchJson<ProjectStat[]>('/api/projects'),
  ])

  const topProjects = (projects ?? [])
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 5)

  statsCache = {
    today: today?.total_usd ?? 0,
    week: week?.total_usd ?? 0,
    month: month?.total_usd ?? 0,
    lastSync: lastSync ? lastSync.toLocaleTimeString() : null,
    topProjects,
  }

  if (tray) {
    tray.setTitle(fmtUsd(statsCache.today))
    tray.setToolTip(`Economy: ${fmtUsd(statsCache.today)} today`)
  }

  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('stats-update', statsCache)
  }
}

async function runSync(): Promise<void> {
  try {
    await fetch(`${ECONOMY_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: 'all' }),
    })
  } catch {
    const cp = await import('child_process')
    await new Promise<void>(resolve => {
      const proc = cp.spawn('economy', ['sync'], { stdio: 'ignore' })
      proc.on('close', () => resolve())
      proc.on('error', () => resolve())
    })
  }
  lastSync = new Date()
  await refreshStats()
}

function createTrayIcon(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="white" opacity="0.9"/>
    <text x="8" y="12" font-family="Helvetica" font-size="10" font-weight="bold" text-anchor="middle" fill="black">$</text>
  </svg>`
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  img.setTemplateImage(true)
  return img
}

function createPopup(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile(path.join(__dirname, '..', 'src', 'popup.html'))
  win.on('blur', () => { if (!win.isDestroyed()) win.hide() })
  return win
}

function togglePopup(): void {
  if (!tray) return
  if (!popupWindow || popupWindow.isDestroyed()) popupWindow = createPopup()

  if (popupWindow.isVisible()) { popupWindow.hide(); return }

  const tb = tray.getBounds()
  const wb = popupWindow.getBounds()
  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y })
  const { workArea } = display

  let x = Math.round(tb.x + tb.width / 2 - wb.width / 2)
  let y = Math.round(tb.y + tb.height + 4)
  if (y + wb.height > workArea.y + workArea.height) y = Math.round(tb.y - wb.height - 4)
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - wb.width))

  popupWindow.setPosition(x, y)
  popupWindow.show()
  popupWindow.webContents.send('stats-update', statsCache)
}

app.on('ready', async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide()

  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setTitle('$—')
  tray.setToolTip('Economy')

  // Only left-click popup — NO context menu (fixes double menu)
  tray.on('click', () => togglePopup())

  ipcMain.handle('sync-now', async () => { await runSync(); return statsCache })
  ipcMain.handle('open-dashboard', () => { shell.openExternal('http://localhost:3456') })
  ipcMain.handle('quit', () => { app.quit() })

  await runSync()
  setInterval(() => runSync(), SYNC_INTERVAL_MS)
  setInterval(() => refreshStats(), REFRESH_INTERVAL_MS)
})

app.on('window-all-closed', () => {})
app.requestSingleInstanceLock()
app.on('second-instance', () => { togglePopup() })
