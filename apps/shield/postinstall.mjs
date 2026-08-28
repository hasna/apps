// Best-effort install-time creation of the shield data home, resolving the
// SAME effective data root the runtime uses (src/lib/paths.ts getDataRoot):
// an exact-app override (`HASNA_SHIELD_HOME`) names an explicit root and
// wins; otherwise the @hasna/paths XDG data home is used once adopted
// (`HASNA_DATA_HOME` set, or `shield.db` already migrated there); otherwise
// the legacy `~/.hasna/security` default. The per-file `SECURITY_DB` override
// is layered on top of that root by the runtime and does not change which
// directory is created here. Failures are non-fatal: the runtime creates the
// same directory on first use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_ROOT = (process.env["HASNA_SHIELD_HOME"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const resolved = dataDir({ app: "security", home });
  let root;
  if (EXACT_ROOT) {
    root = EXACT_ROOT;
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "shield.db"))) {
    root = resolved;
  } else {
    root = join(home, ".hasna", "security");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
