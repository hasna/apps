// Postinstall data-dir provisioning for @hasna/files.
//
// Mirrors src/lib/paths.ts selection semantics so the installed surface and
// the runtime surface stay in parity: an exact-app override
// (HASNA_FILES_DATA_DIR, FILES_DATA_DIR, then HASNA_FILES_HOME, FILES_HOME)
// wins unconditionally; otherwise the @hasna/paths (XDG / macOS home layout)
// data root once adopted (the operator set the data-kind override
// HASNA_DATA_HOME, or a files.db already exists there); otherwise the legacy
// ~/.hasna/files default. The legacy default is what keeps today's machines
// byte-identical; the resolver root is what the XDG home migration (hotfixes
// plan 0f49f56a, task P3.3) moves toward. Nothing else moves on disk — this
// only provisions the effective home so a first run lands in the right place.
//
// Best-effort: an override pointing at an uncreatable path, or a resolver that
// cannot be resolved at install time, must never fail the install — the runtime
// provisions the effective home on first use the same way.
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

function legacyDataRoot(home) {
  return join(home, ".hasna", "files");
}

function adoptResolverRoot(resolved) {
  const override = process.env.HASNA_DATA_HOME;
  if (typeof override === "string" && override.trim().length > 0) return true;
  return existsSync(join(resolved, "files.db"));
}

async function effectiveDataRoot() {
  const exact =
    process.env.HASNA_FILES_DATA_DIR?.trim() ||
    process.env.FILES_DATA_DIR?.trim() ||
    process.env.HASNA_FILES_HOME?.trim() ||
    process.env.FILES_HOME?.trim();
  if (exact) return resolve(exact);
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  let resolverRoot = null;
  try {
  // (local resolver — @hasna/paths deleted, hasna/apps#1535)
    resolverRoot = dataDir({ app: "files", home });
  } catch {
    // @hasna/paths unavailable — fall back to the legacy root.
  }
  if (resolverRoot && adoptResolverRoot(resolverRoot)) return resolve(resolverRoot);
  return legacyDataRoot(home);
}

// Best-effort: a data-dir creation failure must never block install.
try {
  const root = await effectiveDataRoot();
  mkdirSync(root, { recursive: true });
} catch {
  // ignore
}
