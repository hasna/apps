import { describe, expect, it } from 'bun:test'
import { appleScriptString, notificationScript, sendNotification } from './notification.js'

describe('watch notification helpers', () => {
  it('escapes AppleScript string literals without shell interpolation', () => {
    expect(appleScriptString('plain text')).toBe('"plain text"')
    expect(appleScriptString('model "quoted" \\ path')).toBe('"model \\"quoted\\" \\\\ path"')
  })

  it('builds safe notification scripts for quoted model names', () => {
    const script = notificationScript('economy: "high" cost', '$1.23 on model "preview"')

    expect(script).toBe('display notification "$1.23 on model \\"preview\\"" with title "economy: \\"high\\" cost"')
    expect(script).not.toContain("'")
  })

  it('passes the notification script as osascript argv instead of shell text', () => {
    const calls: Array<{ file: string, args: string[], options: { stdio: 'ignore' } }> = []

    sendNotification('economy: "high" cost', '$1.23 on model "preview"', (file, args, options) => {
      calls.push({ file, args, options })
    })

    expect(calls).toEqual([{
      file: 'osascript',
      args: ['-e', 'display notification "$1.23 on model \\"preview\\"" with title "economy: \\"high\\" cost"'],
      options: { stdio: 'ignore' },
    }])
  })

  it('ignores osascript failures on non-macOS hosts', () => {
    expect(() => sendNotification('Cost Alert', 'offline', () => {
      throw new Error('osascript missing')
    })).not.toThrow()
  })
})
