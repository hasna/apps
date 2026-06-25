import type { Database } from '../db/database.js'
import { upsertProject } from '../db/database.js'

interface OpenProject {
  id: string
  name: string
  description: string | null
  path?: string | null
  primary_path?: string | null
  tags: string[]
  created_at: string
}

type ListOpenProjects = (options: { status: 'active'; limit: number }) => OpenProject[]

interface OpenProjectsApi {
  listProjects?: ListOpenProjects
  listWorkspaces?: ListOpenProjects
}

export async function syncOpenProjectsRegistry(
  db: Database,
  listActiveProjects?: ListOpenProjects,
): Promise<{ imported: number; skipped: number }> {
  let listOpenProjects = listActiveProjects
  if (!listOpenProjects) {
    const projectsApi = await import('@hasna/projects') as OpenProjectsApi
    listOpenProjects = projectsApi.listProjects ?? projectsApi.listWorkspaces
  }
  if (!listOpenProjects) {
    throw new Error('@hasna/projects does not expose listWorkspaces or listProjects')
  }
  const projects = listOpenProjects({ status: 'active', limit: 5000 })
  let imported = 0
  let skipped = 0

  for (const project of projects) {
    const path = project.path ?? project.primary_path ?? ''
    if (!path) {
      skipped++
      continue
    }
    upsertProject(db, {
      id: project.id,
      path,
      name: project.name,
      description: project.description,
      tags: project.tags ?? [],
      created_at: project.created_at,
    })
    imported++
  }

  return { imported, skipped }
}
