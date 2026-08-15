import { describe, expect, test } from 'bun:test'
import { getHomeDir, expandHome } from './paths.js'

describe('paths', () => {
  test('expandHome replaces tilde prefix', () => {
    const home = getHomeDir()
    expect(expandHome('~/.claude/projects')).toBe(`${home}/.claude/projects`)
  })
})
