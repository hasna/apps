// Best-effort install-time creation of the repos data home, resolving the
// SAME effective data dir the runtime uses (src/lib/paths.ts getDataRoot):
// an exact-app override (`HASNA_REPOS_HOME`) names an explicit root and wins;
// otherwise the @hasna/paths XDG data home is used once adopted
// (`HASNA_DATA_HOME` set, or `repos.db` already migrated there); otherwise
// the legacy `~/.hasna/repos` default. File-level overrides
// (`HASNA_REPOS_CONFIG_PATH`, `HASNA_REPOS_DB_PATH`, `REPOS_DB_PATH`,
// `HASNA_REPOS_HOOK_QUEUE_PATH`, `HASNA_REPOS_GITHUB_CACHE_PATH`) are layered
// on top of that root by the runtime and do not change which directory is
// created here. Failures are non-fatal: the runtime creates the same
// directories on first use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_ROOT = (process.env["HASNA_REPOS_HOME"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({ app: "repos" });
  let root;
  if (EXACT_ROOT) {
    root = EXACT_ROOT;
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "repos.db"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "repos");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
