/**
 * projects data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the projects data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the projects-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const PROJECTS_HOME_ENV = "HASNA_PROJECTS_HOME";
export const PROJECT_WORKSPACE_ID_PATTERN = /^wks_[A-Za-z0-9_-]{1,80}$/;

export function assertProjectWorkspaceId(workspaceId: string): string {
  if (!PROJECT_WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error(`Invalid workspace id for project store path: ${workspaceId}`);
  }
  return workspaceId;
}

/**
 * The resolver projects data root: kind overrides honored,
 * `the projects data root` on macOS, `~/.local/share/hasna/projects` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "projects", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`the projects data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "projects");
}

export function getProjectsHome(): string {
  const configured = process.env[PROJECTS_HOME_ENV]?.trim();
  if (configured) return resolve(configured);
  return resolve(resolverHome());
}
export function projectWorkspaceStorePath(workspaceId: string): string {
  return resolve(join(getProjectsHome(), "workspaces", assertProjectWorkspaceId(workspaceId)));
}
export function projectDataStorePath(workspaceId: string): string {
  return resolve(join(getProjectsHome(), "data", assertProjectWorkspaceId(workspaceId)));
}
export function isProjectWorkspaceStorePath(workspaceId: string, path: string | null | undefined): boolean {
  return Boolean(path && resolve(path) === projectWorkspaceStorePath(workspaceId));
}