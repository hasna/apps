// Postinstall: ensure the effective monitor home exists before first run.
//
// Resolves the same effective home the runtime uses (see src/app-home.ts):
//   - the exact-app override MONITOR_CONFIG_DIR / HASNA_MONITOR_HOME wins;
//   - otherwise the @hasna/paths data home once adopted (HASNA_DATA_HOME set
//     or a config.json / monitor.db already at the resolver home);
//   - otherwise the legacy ~/.hasna/monitor default.
//
// This keeps the install-time mkdir on the path the runtime will actually
// read/write — never a hardcoded legacy path when the store has been migrated
// or the operator has opted into the XDG layout. Nothing is migrated here.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

function effectiveHome() {
  return process.env.HOME || homedir();
}

function legacyHomeDir() {
  return join(effectiveHome(), ".hasna", "monitor");
}

function resolverHome() {
  return dataDir({ app: "monitor", home: process.env.HOME || undefined });
}

function adoptResolverHome(resolved) {
  const override = process.env.HASNA_DATA_HOME;
  if (typeof override === "string" && override.trim().length > 0) return true;
  return existsSync(join(resolved, "config.json")) || existsSync(join(resolved, "monitor.db"));
}

function exactMonitorDir() {
  const dir = process.env.MONITOR_CONFIG_DIR;
  if (dir && dir.trim()) return dir.trim();
  const home = process.env.HASNA_MONITOR_HOME;
  if (home && home.trim()) return home.trim();
  return undefined;
}

function getMonitorDir() {
  const exact = exactMonitorDir();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}

try {
  mkdirSync(getMonitorDir(), { recursive: true, mode: 0o700 });
} catch {
  // Best-effort: the runtime creates the directory lazily if this fails.
}
