// Best-effort install-time provisioning of the snapshots data home and its
// subdirectories (exports, logs, plans), resolving the SAME effective data
// home the runtime uses (src/paths.ts getDataRoot): an exact-app override
// (HASNA_SNAPSHOTS_DIR) wins; otherwise the @hasna/paths XDG data home once
// adopted (HASNA_DATA_HOME set, or snapshots.sqlite already migrated there);
// otherwise the legacy ~/.hasna/snapshots default. Failures are non-fatal:
// the runtime creates the same directories on first use.
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
import { join } from "node:path";

const EXACT_OVERRIDE = (process.env["HASNA_SNAPSHOTS_DIR"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  // (local resolver — @hasna/paths deleted, hasna/apps#1535)
  const resolved = dataDir({ app: "snapshots" });
  let root;
  if (EXACT_OVERRIDE) {
    root = EXACT_OVERRIDE;
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "snapshots.sqlite"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "snapshots");
  }
  for (const sub of ["exports", "logs", "plans"]) {
    mkdirSync(join(root, sub), { recursive: true });
  }
} catch {
  // never fail an install over pre-created directories
}
