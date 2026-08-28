// Best-effort install-time creation of the prompts data home, resolving the
// SAME effective data root the runtime uses (src/lib/paths.ts getDataRoot): an
// exact-app override (HASNA_PROMPTS_HOME / PROMPTS_HOME) wins; otherwise the
// @hasna/paths XDG data home once adopted (HASNA_DATA_HOME set, or prompts.db
// already migrated there); otherwise the legacy ~/.hasna/prompts default.
// Failures are non-fatal: the runtime creates the same directories on first
// use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDES = [
  (process.env["HASNA_PROMPTS_HOME"] || "").trim(),
  (process.env["PROMPTS_HOME"] || "").trim(),
].filter(Boolean);
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const resolved = dataDir({ app: "prompts", home });
  let root;
  if (EXACT_OVERRIDES.length > 0) {
    root = EXACT_OVERRIDES[0];
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "prompts.db"))) {
    root = resolved;
  } else {
    root = join(home, ".hasna", "prompts");
  }
  for (const sub of ["", "runs"]) {
    mkdirSync(join(root, sub), { recursive: true });
  }
} catch {
  // never fail an install over pre-created directories
}
