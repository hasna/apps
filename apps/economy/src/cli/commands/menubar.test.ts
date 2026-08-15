import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'

describe('menubar command shell usage', () => {
  it('does not interpolate installer commands through a shell', () => {
    const source = readFileSync(new URL('./menubar.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('execSync')
    expect(source).not.toMatch(/`(?:pgrep|rm|mkdir|unzip|cp|xattr|open|osascript|sleep)\b/)
    expect(source).toContain('execFileSync')
  })
})
