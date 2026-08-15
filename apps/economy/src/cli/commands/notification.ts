import { execFileSync } from 'child_process'

type ExecFile = (file: string, args: string[], options: { stdio: 'ignore' }) => unknown

export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function notificationScript(title: string, body: string): string {
  return `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`
}

export function sendNotification(title: string, body: string, execFile: ExecFile = execFileSync): void {
  try {
    execFile('osascript', ['-e', notificationScript(title, body)], { stdio: 'ignore' })
  } catch { /* non-macOS */ }
}
