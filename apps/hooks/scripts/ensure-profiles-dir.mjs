// Ensure the hooks agent-profile directory exists at the effective data root.
// Runs at install time (postinstall). Mirrors src/lib/app-home.ts resolution:
// granular data-dir override (HASNA_HOOKS_DATA_DIR/HOOKS_DATA_DIR), then
// exact-app override (HASNA_HOOKS_HOME/HOOKS_HOME), then the @hasna/paths
// resolver data root once adopted (HASNA_DATA_HOME set or hooks.db already
// present there), then the legacy ~/.hasna/hooks default. Best-effort — the
// package must never fail to install because this script cannot run.
import { existsSync, mkdirSync } from "node:fs";
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the resolver contract (XDG / macOS home layout
// honoring HASNA_{CONFIG,DATA,STATE,CACHE}_HOME, with the same env-override
// and home-override semantics the deleted package had).
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

const PATHS_RESOLVER_KIND_ENV = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

function pathsResolverBaseDir(kind, options) {
  const env = options.env ?? process.env;
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

function pathsResolverResolve(kind, options) {
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
function dataDir(options) {
  return pathsResolverResolve("data", options);
}
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOME = process.env.HOME || process.env.USERPROFILE || homedir();

function legacyDataRoot() {
  return join(HOME, ".hasna", "hooks");
}

function adoptResolverRoot(resolved) {
  const override = process.env.HASNA_DATA_HOME;
  if (typeof override === "string" && override.trim().length > 0) return true;
  return existsSync(join(resolved, "hooks.db"));
}

async function effectiveDataRoot() {
  const explicit = process.env.HASNA_HOOKS_DATA_DIR ?? process.env.HOOKS_DATA_DIR;
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim();

  const exact = process.env.HASNA_HOOKS_HOME?.trim() || process.env.HOOKS_HOME?.trim();
  if (exact) return resolve(exact);

  let resolved = null;
  try {
  // (local resolver — @hasna/paths deleted, hasna/apps#1535)
    resolved = dataDir({ app: "hooks", home: HOME });
  } catch {
    // @hasna/paths unavailable — fall back to the legacy root.
  }
  if (resolved && adoptResolverRoot(resolved)) return resolve(resolved);
  return legacyDataRoot();
}

// Best-effort: a profile-directory creation failure must never block install.
try {
  const root = await effectiveDataRoot();
  mkdirSync(join(root, "profiles"), { recursive: true });
} catch {
  // ignore
}
