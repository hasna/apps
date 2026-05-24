import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase } from '../db/database.js'
import { syncOpenProjectsRegistry } from './open-projects.js'

let root: string
let projectDir: string

beforeEach(() => {
  root = join(tmpdir(), `economy-open-projects-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  projectDir = join(root, 'repo')
  mkdirSync(projectDir, { recursive: true })
  process.env['HASNA_PROJECTS_DB_PATH'] = join(root, 'projects.db')
})

afterEach(() => {
  delete process.env['HASNA_PROJECTS_DB_PATH']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('syncOpenProjectsRegistry', () => {
  it('imports active projects from @hasna/projects into economy projects', async () => {
    const { createProject } = await import('@hasna/projects')
    createProject({
      name: 'Economy Fixture',
      path: projectDir,
      description: 'fixture project',
      tags: ['test', 'economy'],
      git_init: false,
    })

    const db = openDatabase(':memory:', true)
    const result = await syncOpenProjectsRegistry(db)
    expect(result.imported).toBe(1)

    const row = db.prepare(`SELECT * FROM projects WHERE path = ?`).get(projectDir) as Record<string, string> | null
    expect(row?.name).toBe('Economy Fixture')
    expect(row?.description).toBe('fixture project')
  })

  it('skips project registry rows that do not have paths', async () => {
    const db = openDatabase(':memory:', true)
    const result = await syncOpenProjectsRegistry(db, () => [
      {
        id: 'missing-path',
        name: 'Missing Path',
        description: null,
        path: '',
        tags: [],
        created_at: '2026-05-09T00:00:00.000Z',
      },
      {
        id: 'with-path',
        name: 'With Path',
        description: 'valid project',
        path: projectDir,
        tags: ['valid'],
        created_at: '2026-05-09T00:00:00.000Z',
      },
    ])

    expect(result).toEqual({ imported: 1, skipped: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS count FROM projects`).get()).toEqual({ count: 1 })
    const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get('with-path') as Record<string, string> | null
    expect(row?.path).toBe(projectDir)
  })
})
