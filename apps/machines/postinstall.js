// Best-effort install-time creation of the machines data home, resolving the
// SAME effective data dir the runtime uses (src/paths.ts getDataDir): an
// exact-app override (HASNA_MACHINES_HOME / MACHINES_HOME / HASNA_MACHINES_DIR)
// wins; otherwise the @hasna/paths XDG data home once adopted (HASNA_DATA_HOME
// set, or machines.db already migrated there); otherwise the legacy
// ~/.hasna/machines default. Failures are non-fatal: the runtime creates the
// same directories on first use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDES = [
  (process.env["HASNA_MACHINES_HOME"] || "").trim(),
  (process.env["MACHINES_HOME"] || "").trim(),
  (process.env["HASNA_MACHINES_DIR"] || "").trim(),
].filter(Boolean);
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({ app: "machines", home: process.env["HOME"] || process.env["USERPROFILE"] || homedir() });
  let root;
  if (EXACT_OVERRIDES.length > 0) {
    root = EXACT_OVERRIDES[0];
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "machines.db"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "machines");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
