// Best-effort install-time creation of the domains home directory, resolving
// the SAME effective home the runtime uses (src/lib/app-home.ts): an exact-app
// override (HASNA_DOMAINS_HOME / DOMAINS_HOME / HASNA_DOMAINS_DIR / DOMAINS_DIR)
// wins; otherwise the @hasna/paths XDG data home once adopted (HASNA_DATA_HOME
// set, or domains.db already migrated there); otherwise the legacy
// ~/.hasna/domains default. Failures are non-fatal: the runtime creates the
// same directory on first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
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

try {
  // (local resolver — @hasna/paths deleted, hasna/apps#1535)
  const env = process.env;
  const override = (
    env["HASNA_DOMAINS_HOME"] ||
    env["DOMAINS_HOME"] ||
    env["HASNA_DOMAINS_DIR"] ||
    env["DOMAINS_DIR"] ||
    ""
  ).trim();
  const dataHomeOverride = (env["HASNA_DATA_HOME"] || "").trim();
  const home = env["HOME"] || env["USERPROFILE"] || homedir();

  let dir;
  if (override) {
    dir = override;
  } else {
    const resolved = dataDir({ app: "domains", home, env });
    const adopted = Boolean(dataHomeOverride) || existsSync(join(resolved, "domains.db"));
    dir = adopted ? resolved : join(home, ".hasna", "domains");
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
} catch {
  // never fail an install over pre-created directories
}
