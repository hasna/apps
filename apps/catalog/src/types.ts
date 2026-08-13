import type { App, AppLifecycle, ReleaseChannel } from "./contracts.js";

export type { App, AppInput, AppLifecycle, ReleaseChannel } from "./contracts.js";

export interface ListAppsOptions {
  lifecycle?: AppLifecycle;
  channel?: ReleaseChannel;
  limit?: number;
  offset?: number;
}

export interface SearchAppsOptions {
  limit?: number;
}

export interface CatalogStoreLike {
  upsertApps(apps: App[]): number;
  getApp(appId: string): App | null;
  listApps(options?: ListAppsOptions): App[];
  searchApps(query: string, options?: SearchAppsOptions): App[];
  countApps(): number;
}

export interface SeedCandidate {
  folder: string;
  path: string;
  npmName: string | null;
  version: string | null;
  description: string | null;
  bins: string[];
  readmeFirstLine: string | null;
  repositoryUrl: string | null;
}

export interface SeedSkip {
  folder: string;
  reason: string;
}

export interface SeedReport {
  root: string;
  scanned: number;
  seeded: App[];
  skipped: SeedSkip[];
  joinedProjects: number;
}

export interface ProjectJoinRecord {
  slug: string;
  primaryPath: string | null;
  gitRemote: string | null;
  description: string | null;
}
