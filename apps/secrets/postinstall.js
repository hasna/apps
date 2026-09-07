// Best-effort install-time creation of the secrets data home, resolving the
// SAME effective data dir the runtime uses (src/data-dir.ts
// effectiveOperatorDataDir): the @hasna/paths XDG data home is used once
// adopted (`HASNA_DATA_HOME` set, or `vault.db` already migrated there);
// otherwise the legacy `~/.hasna/secrets` default. The explicit file-level
// overrides (`HASNA_SECRETS_DB_PATH`, `HASNA_SECRETS_KEY_DIR`) are layered on
// top of that root by the runtime and do not change which directory is
// created here. Failures are non-fatal: the runtime creates the same
// directories on first use.
import { existsSync, mkdirSync } from "node:fs";
// --- Local data-home resolver ------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this copy mirrors
// src/data-dir.ts and resolves the DATA kind only (HASNA_DATA_HOME, else the
// XDG / macOS data home). No config/state/cache location is composed here.
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

function pathsResolverDataBaseDir(options) {
  const env = options.env ?? process.env;
  const override = env.HASNA_DATA_HOME;
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
  }
  return pathsResolverJoin(home, ".local", "share", "hasna");
}

function dataDir(options) {
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverDataBaseDir(options), appSegment);
}
import { homedir } from "node:os";
import { join } from "node:path";

const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  // (local resolver — @hasna/paths deleted, hasna/apps#1535)
  const resolved = dataDir({ app: "secrets" });
  let root;
  if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "vault.db"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "secrets");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
