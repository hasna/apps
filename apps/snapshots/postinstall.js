// Best-effort install-time provisioning of the snapshots data home and its
// subdirectories (exports, logs, plans), resolving the SAME effective data
// home the runtime uses (src/paths.ts getDataRoot): an exact-app override
// (HASNA_SNAPSHOTS_DIR) wins; otherwise the @hasna/paths XDG data home once
// adopted (HASNA_DATA_HOME set, or snapshots.sqlite already migrated there);
// otherwise the legacy ~/.hasna/snapshots default. Failures are non-fatal:
// the runtime creates the same directories on first use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDE = (process.env["HASNA_SNAPSHOTS_DIR"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
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
