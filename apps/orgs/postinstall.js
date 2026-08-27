// Best-effort install-time creation of the orgs data home, resolving the
// SAME effective data dir the runtime uses (src/paths.ts getDataRoot):
// an exact-app override (`HASNA_ORGS_HOME`) names an explicit root and wins;
// otherwise the @hasna/paths XDG data home is used once adopted
// (`HASNA_DATA_HOME` set, or `orgs.json` already migrated there); otherwise
// the legacy `~/.hasna/orgs` default. The existing `OPEN_ORGS_STORE` /
// `OPEN_ORGS_AUDIT` file-level overrides are layered on top of that root by
// the store layer and do not change which directory is created here.
// Failures are non-fatal: the runtime creates the same directories on first
// use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_ROOT = (process.env["HASNA_ORGS_HOME"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({ app: "orgs" });
  let root;
  if (EXACT_ROOT) {
    root = EXACT_ROOT;
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "orgs.json"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "orgs");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
