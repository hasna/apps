import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../db/database.js'
import { buildStatusLine } from './tui.js'

describe('status line', () => {
  test('buildStatusLine includes spend and fleet fields', () => {
    const db = openDatabase(':memory:', true)
    const line = buildStatusLine(db)
    expect(line).toContain('today')
    expect(line).toContain('week')
    expect(line).toContain('machines')
  })
})
