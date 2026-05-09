import type { SqliteAdapter as Database } from '@hasna/cloud'
import { upsertProject } from '../db/database.js'

interface OpenProject {
  id: string
  name: string
  description: string | null
  path: string
  tags: string[]
  created_at: string
}

export async function syncOpenProjectsRegistry(db: Database): Promise<{ imported: number; skipped: number }> {
  const { listProjects } = await import('@hasna/projects')
  const projects = listProjects({ status: 'active', limit: 5000 }) as OpenProject[]
  let imported = 0
  let skipped = 0

  for (const project of projects) {
    if (!project.path) {
      skipped++
      continue
    }
    upsertProject(db, {
      id: project.id,
      path: project.path,
      name: project.name,
      description: project.description,
      tags: project.tags ?? [],
      created_at: project.created_at,
    })
    imported++
  }

  return { imported, skipped }
}
