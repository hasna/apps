import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

export const PROJECTS_HOME_ENV = "HASNA_PROJECTS_HOME";
export const PROJECT_WORKSPACE_ID_PATTERN = /^wks_[A-Za-z0-9_-]{1,80}$/;

export function assertProjectWorkspaceId(workspaceId: string): string {
  if (!PROJECT_WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error(`Invalid workspace id for project store path: ${workspaceId}`);
  }
  return workspaceId;
}

/** The effective user home, mirroring the pre-existing projects resolution (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time so a $HOME switch mid-process keeps working. */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: ~/.hasna/projects. */
export function legacyHomeDir(): string {
  return resolve(join(effectiveHome(), ".hasna", "projects"));
}

/** The @hasna/paths-resolved data home for projects (XDG / macOS home layout). */
export function resolverHome(): string {
  return dataDir({ app: "projects", home: process.env["HOME"] || process.env["USERPROFILE"] || undefined });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`projects.db` exists).
 * A machine that only redirects another kind must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "projects.db"));
}

/**
 * The projects home: an exact-app override (`HASNA_PROJECTS_HOME`) wins
 * unconditionally; otherwise the resolver (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/projects` default.
 */
export function getProjectsHome(): string {
  const configured = process.env[PROJECTS_HOME_ENV]?.trim();
  if (configured) return resolve(configured);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : legacyHomeDir();
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
