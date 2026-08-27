// Best-effort install-time creation of the consolidations home directories,
// resolving the SAME effective home the runtime uses: an exact-app override
// (HASNA_CONSOLIDATIONS_HOME / CONSOLIDATIONS_HOME) wins; otherwise the
// @hasna/paths XDG data home once adopted (HASNA_DATA_HOME set, or the store
// already migrated there); otherwise the legacy ~/.hasna/consolidations
// default. Failures are non-fatal: the runtime ensureAppHome() creates the
// same directories on first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDE = (process.env["HASNA_CONSOLIDATIONS_HOME"] || process.env["CONSOLIDATIONS_HOME"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();
const LEGACY_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"];

try {
  const { cacheDir, configDir, dataDir, stateDir } = await import("@hasna/paths");
  const OPTIONS = { app: "consolidations" };
  let DIRS;
  if (EXACT_OVERRIDE) {
    // Exact-app override keeps the legacy subdir layout under the override root.
    DIRS = LEGACY_SUBDIRS.map((n) => join(EXACT_OVERRIDE, n));
  } else if (DATA_HOME_OVERRIDE || existsSync(join(dataDir(OPTIONS), "consolidations.db"))) {
    DIRS = [
      configDir(OPTIONS),
      dataDir(OPTIONS),
      join(dataDir(OPTIONS), "exports"),
      join(dataDir(OPTIONS), "backups"),
      join(stateDir(OPTIONS), "logs"),
      join(cacheDir(OPTIONS), "tmp"),
    ];
  } else {
    // Legacy default until the XDG home is adopted.
    const root = join(homedir(), ".hasna", "consolidations");
    DIRS = LEGACY_SUBDIRS.map((n) => join(root, n));
  }
  for (const dir of DIRS) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // best-effort on platforms without POSIX perms
    }
  }
} catch {
  // never fail an install over pre-created directories
}
