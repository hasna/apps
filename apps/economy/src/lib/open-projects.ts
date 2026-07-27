import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import { upsertProject } from '../db/database.js'

/**
 * The subset of a project-registry row economy needs. The registry renamed its
 * filesystem-path field `path` -> `primary_path` when projects became
 * workspaces, so both spellings are accepted and `resolveProjectPath` below
 * picks whichever is present. Keeping both means the injectable
 * `listActiveProjects` seam (and its tests) stays valid across that rename.
 */
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

const resolveProjectPath = (project: OpenProject): string => project.primary_path || project.path || ''

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
    const path = resolveProjectPath(project)
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
