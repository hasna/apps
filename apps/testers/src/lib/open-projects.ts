import { createProject as createTesterProject, getProjectByPath, listProjects } from "../db/projects.js";
import type { Project } from "../types/index.js";

export interface OpenProjectsMirrorResult {
  project: Project;
  openProject: {
    id: string;
    slug: string;
    name: string;
    path: string;
  };
  created: boolean;
}

export async function importFromOpenProjects(ref: string): Promise<OpenProjectsMirrorResult> {
  const sdk = await import("@hasna/projects");
  const openProject = resolveOpenProject(sdk, ref);
  if (!openProject) throw new Error(`open-projects project not found: ${ref}`);

  const existing = getProjectByPath(openProject.path)
    ?? listProjects().find((project) => project.settings.openProjectsProjectId === openProject.id);
  if (existing) {
    return {
      project: existing,
      openProject: toOpenProjectRef(openProject),
      created: false,
    };
  }

  const project = createTesterProject({
    name: openProject.name,
    path: openProject.path,
    description: openProject.description ?? undefined,
    settings: {
      openProjectsProjectId: openProject.id,
      openProjectsSlug: openProject.slug,
      source: "open-projects",
    },
  });

  return {
    project,
    openProject: toOpenProjectRef(openProject),
    created: true,
  };
}

export async function exportToOpenProjects(projectIdOrName: string): Promise<OpenProjectsMirrorResult> {
  const project = listProjects().find((item) => (
    item.id === projectIdOrName
    || item.id.startsWith(projectIdOrName)
    || item.name === projectIdOrName
  ));
  if (!project) throw new Error(`Project not found: ${projectIdOrName}`);
  if (!project.path) throw new Error(`Project has no path to export to open-projects: ${project.name}`);

  const sdk = await import("@hasna/projects");
  const existing = sdk.getProjectByPath(project.path);
  const openProject = existing ?? sdk.createProject({
    name: project.name,
    path: project.path,
    description: project.description ?? undefined,
    git_init: false,
    tags: ["testers"],
  });

  return {
    project,
    openProject: toOpenProjectRef(openProject),
    created: !existing,
  };
}

function resolveOpenProject(sdk: typeof import("@hasna/projects"), ref: string) {
  return sdk.getProject(ref)
    ?? sdk.getProjectBySlug(ref)
    ?? sdk.getProjectByPath(ref)
    ?? sdk.listProjects({ status: "active", limit: 1000 }).find((project) => project.name === ref || project.slug === ref);
}

function toOpenProjectRef(openProject: { id: string; slug: string; name: string; path: string }) {
  return {
    id: openProject.id,
    slug: openProject.slug,
    name: openProject.name,
    path: openProject.path,
  };
}
