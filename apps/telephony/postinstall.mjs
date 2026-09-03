// Best-effort install-time creation of the telephony data directory, resolving
// the SAME effective data home the runtime uses (src/paths.ts): the
// @hasna/paths XDG data home once adopted (HASNA_DATA_HOME set, or
// telephony.db already migrated there); otherwise the legacy
// ~/.hasna/telephony default. Failures are non-fatal: the runtime creates the
// same directories on first use.
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
  const dataHomeOverride = (env["HASNA_DATA_HOME"] || "").trim();
  const home = env["HOME"] || env["USERPROFILE"] || homedir();

  const resolved = dataDir({ app: "telephony", home, env });
  const adopted = Boolean(dataHomeOverride) || existsSync(join(resolved, "telephony.db"));
  const dir = adopted ? resolved : join(home, ".hasna", "telephony");

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
  if (!existsSync(join(dir, "audio"))) {
    mkdirSync(join(dir, "audio"), { recursive: true, mode: 0o700 });
  }
} catch {
  // Non-fatal: the runtime creates the same directories on first use.
}
