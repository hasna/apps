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

// The projects SDK is an OPTIONAL runtime integration for the registry sync:
// loaded dynamically and its use below is cast to the local OpenProject
// shape, so its static resolution must not gate the prepack typecheck. In
// this monorepo @hasna/projects links to the workspace member apps/projects
// (pin 0.1.135 == member version), whose dist/ — its types entry — only
// exists after that member's own build, and the publish-guard packs members
// by readdir order (economy can precede projects in a fresh checkout). A
// literal specifier makes tsc demand the missing declarations (TS2307 at
// prepack, row 029ceb00, same class as 0cbbd621); the non-literal form keeps
// the module resolved at runtime only.
const PROJECTS_MODULE = '@hasna/projects'

export async function syncOpenProjectsRegistry(
  db: Database,
  listActiveProjects?: ListOpenProjects,
): Promise<{ imported: number; skipped: number }> {
  let listProjects = listActiveProjects
  if (!listProjects) {
    const projectsApi = await import(PROJECTS_MODULE)
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
