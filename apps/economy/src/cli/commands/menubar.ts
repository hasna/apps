import chalk from 'chalk'
import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir, arch } from 'os'
import { join } from 'path'

const APP_PATH = '/Applications/Economy Bar.app'
const REPO = 'hasna/economy'

function getArch(): 'arm64' | 'x86_64' {
  return arch() === 'arm64' ? 'arm64' : 'x86_64'
}

function isInstalled(): boolean {
  return existsSync(APP_PATH)
}

function isRunning(): boolean {
  try {
    const result = execFileSync('pgrep', ['-x', 'EconomyBar'], { stdio: 'pipe' }).toString().trim()
    return result.length > 0
  } catch {
    return false
  }
}

export async function menubarInstall(opts: { force?: boolean }): Promise<void> {
  if (isInstalled() && !opts.force) {
    console.log(chalk.yellow('Economy Bar is already installed. Use --force to reinstall.'))
    console.log(chalk.dim(`  Location: ${APP_PATH}`))
    return
  }

  const cpuArch = getArch()
  console.log(chalk.cyan(`→ Detecting architecture: ${cpuArch}`))

  // Fetch latest release from GitHub API
  console.log(chalk.cyan('→ Fetching latest release info...'))
  let assetUrl: string
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'economy-cli' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
    const release = await res.json() as { assets: Array<{ name: string; browser_download_url: string }> }
    const assetName = `economy-bar-${cpuArch}.zip`
    const asset = release.assets.find(a => a.name === assetName)
    if (!asset) throw new Error(`No asset found for ${assetName}. Check releases at https://github.com/${REPO}/releases`)
    assetUrl = asset.browser_download_url
  } catch (e) {
    console.error(chalk.red(`✗ Failed to fetch release info: ${e instanceof Error ? e.message : String(e)}`))
    process.exit(1)
  }

  // Download zip
  const zipPath = join(tmpdir(), `economy-bar-${cpuArch}.zip`)
  const extractDir = join(tmpdir(), 'economy-bar-extracted')
  console.log(chalk.cyan(`→ Downloading ${assetUrl}...`))
  try {
    const res = await fetch(assetUrl, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    const buffer = await res.arrayBuffer()
    writeFileSync(zipPath, Buffer.from(buffer))
    console.log(chalk.green(`✓ Downloaded (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`))
  } catch (e) {
    console.error(chalk.red(`✗ Download failed: ${e instanceof Error ? e.message : String(e)}`))
    process.exit(1)
  }

  // Unzip and install
  console.log(chalk.cyan('→ Installing to /Applications...'))
  try {
    rmSync(extractDir, { recursive: true, force: true })
    mkdirSync(extractDir, { recursive: true })
    execFileSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: 'ignore' })
    if (isInstalled()) rmSync(APP_PATH, { recursive: true, force: true })
    cpSync(join(extractDir, 'Economy Bar.app'), APP_PATH, { recursive: true })
    // Clear quarantine so macOS doesn't block unsigned app
    try {
      execFileSync('xattr', ['-rd', 'com.apple.quarantine', APP_PATH], { stdio: 'ignore' })
    } catch { /* xattr may be absent outside macOS */ }
    // Cleanup
    rmSync(zipPath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
    console.log(chalk.green(`✓ Installed to ${APP_PATH}`))
  } catch (e) {
    console.error(chalk.red(`✗ Install failed: ${e instanceof Error ? e.message : String(e)}`))
    process.exit(1)
  }

  // Launch
  console.log(chalk.cyan('→ Launching Economy Bar...'))
  try {
    execFileSync('open', [APP_PATH], { stdio: 'ignore' })
    console.log(chalk.bold.green('\n✓ Economy Bar is running in your menu bar!'))
    console.log(chalk.dim('  Make sure economy serve is running: economy serve'))
  } catch (e) {
    console.log(chalk.yellow('⚠ Installed but could not auto-launch. Open from /Applications manually.'))
  }
}

export function menubarUninstall(): void {
  if (!isInstalled()) {
    console.log(chalk.yellow('Economy Bar is not installed.'))
    return
  }
  // Quit if running
  if (isRunning()) {
    try {
      execFileSync('osascript', ['-e', 'quit app "Economy Bar"'], { stdio: 'ignore' })
      execFileSync('sleep', ['1'], { stdio: 'ignore' })
    } catch {}
  }
  rmSync(APP_PATH, { recursive: true, force: true })
  console.log(chalk.green('✓ Economy Bar uninstalled'))
}

export function menubarStart(): void {
  if (!isInstalled()) {
    console.error(chalk.red('Economy Bar is not installed. Run: economy menubar install'))
    process.exit(1)
  }
  execFileSync('open', [APP_PATH], { stdio: 'ignore' })
  console.log(chalk.green('✓ Economy Bar launched'))
}

export function menubarStop(): void {
  if (!isRunning()) {
    console.log(chalk.yellow('Economy Bar is not running.'))
    return
  }
  try {
    execFileSync('osascript', ['-e', 'quit app "Economy Bar"'], { stdio: 'ignore' })
    console.log(chalk.green('✓ Economy Bar stopped'))
  } catch {
    console.log(chalk.yellow('Could not quit Economy Bar gracefully'))
  }
}
