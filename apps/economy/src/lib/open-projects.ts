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

type ListOpenProjects = (options: { status: 'active'; limit: number }) => OpenProject[]

export async function syncOpenProjectsRegistry(
  db: Database,
  listActiveProjects?: ListOpenProjects,
): Promise<{ imported: number; skipped: number }> {
  let listProjects = listActiveProjects
  if (!listProjects) {
    const projectsApi = await import('@hasna/projects')
    listProjects = projectsApi.listProjects as ListOpenProjects
  }
  const projects = listProjects({ status: 'active', limit: 5000 })
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
