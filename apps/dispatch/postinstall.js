// Best-effort install-time creation of the dispatch data home, resolving the
// SAME effective data dir the runtime uses (src/lib/paths.ts getDataDir): an
// exact-app override (DISPATCH_DATA_DIR) wins; otherwise the @hasna/paths XDG
// data home once adopted (HASNA_DATA_HOME set, or dispatch.db already migrated
// there); otherwise the legacy ~/.hasna/dispatch default. Failures are
// non-fatal: the runtime creates the same directories on first use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDE = (process.env["DISPATCH_DATA_DIR"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({ app: "dispatch" });
  let root;
  if (EXACT_OVERRIDE) {
    root = EXACT_OVERRIDE;
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "dispatch.db"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "dispatch");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
