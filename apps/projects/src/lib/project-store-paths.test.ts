import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the resolver contract (XDG / macOS home layout
// honoring HASNA_{CONFIG,DATA,STATE,CACHE}_HOME, with the same env-override
// and home-override semantics the deleted package had).
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

export type PathKind = "config" | "data" | "state" | "cache";

const PATHS_RESOLVER_KIND_ENV: Record<PathKind, string> = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

export interface PathsResolverOptions {
  app: string;
  internal?: boolean;
  platform?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

const PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pathsResolverAssertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

function pathsResolverAssertKind(kind: PathKind): void {
  if (!(Object.keys(PATHS_RESOLVER_KIND_ENV) as string[]).includes(kind)) {
    throw new TypeError(
      `paths: invalid path kind "${kind}" — expected one of ${Object.keys(PATHS_RESOLVER_KIND_ENV).join(", ")}`,
    );
  }
}

function pathsResolverBaseDir(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertKind(kind);
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    switch (kind) {
      case "config":
      case "data":
        return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
      case "cache":
        return pathsResolverJoin(home, "Library", "Caches", "Hasna");
      case "state":
        return pathsResolverJoin(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "config":
      return pathsResolverJoin(home, ".config", "hasna");
    case "data":
      return pathsResolverJoin(home, ".local", "share", "hasna");
    case "state":
      return pathsResolverJoin(home, ".local", "state", "hasna");
    case "cache":
      return pathsResolverJoin(home, ".cache", "hasna");
  }
}

function pathsResolverResolve(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
export function dataDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("data", options);
}

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `projects-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "projects"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  adoptResolverHome,
  getProjectsHome,
  legacyHomeDir,
  resolverHome,
  projectWorkspaceStorePath,
  projectDataStorePath,
  PROJECTS_HOME_ENV,
} = await import("./project-store-paths.js");

const KIND_HOME_ENV_KEYS = ["HASNA_DATA_HOME", "HASNA_CONFIG_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME"] as const;

beforeEach(() => {
  delete process.env[PROJECTS_HOME_ENV];
  for (const k of KIND_HOME_ENV_KEYS) delete process.env[k];
  // Remove any resolver-home store a prior test may have planted.
  rmSync(join(resolverHome(), "projects.db"), { force: true });
});

afterAll(() => {
  process.env.HOME = savedHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe("projects home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy ~/.hasna/projects default until the XDG store exists or an override is set", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "projects"));
    // No overrides and no store migrated to the resolver home: the effective
    // home MUST stay on the legacy layout.
    expect(getProjectsHome()).toBe(legacyHomeDir());
  });

  it("honors the HASNA_PROJECTS_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "projects-home-"));
    try {
      process.env[PROJECTS_HOME_ENV] = join(base, "custom-home");
      expect(getProjectsHome()).toBe(join(base, "custom-home"));
      expect(projectWorkspaceStorePath("wks_abc")).toBe(join(base, "custom-home", "workspaces", "wks_abc"));
      expect(projectDataStorePath("wks_abc")).toBe(join(base, "custom-home", "data", "wks_abc"));
    } finally {
      delete process.env[PROJECTS_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver data home when HASNA_DATA_HOME is set (deliberate XDG opt-in)", () => {
    const base = mkdtempSync(join(tmpdir(), "projects-xdg-"));
    try {
      process.env.HASNA_DATA_HOME = base;
      const expected = dataDir({ app: "projects", home: testHome, env: { HASNA_DATA_HOME: base } });
      expect(resolverHome()).toBe(expected);
      expect(adoptResolverHome(expected, process.env)).toBe(true);
      expect(getProjectsHome()).toBe(expected);
      expect(projectWorkspaceStorePath("wks_abc")).toBe(join(expected, "workspaces", "wks_abc"));
    } finally {
      delete process.env.HASNA_DATA_HOME;
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver data home once the store has been physically migrated there", () => {
    const migrated = resolverHome();
    mkdirSync(migrated, { recursive: true });
    writeFileSync(join(migrated, "projects.db"), "");
    expect(adoptResolverHome(migrated, process.env)).toBe(true);
    expect(getProjectsHome()).toBe(migrated);
  });

  it("does NOT adopt the resolver home when only another kind is redirected", () => {
    process.env.HASNA_CACHE_HOME = "/tmp/projects-cache-only";
    expect(adoptResolverHome(resolverHome(), process.env)).toBe(false);
    expect(getProjectsHome()).toBe(legacyHomeDir());
    delete process.env.HASNA_CACHE_HOME;
  });
});
