// Best-effort install-time creation of the feedback data home, resolving the
// SAME effective data dir the runtime uses (src/storage.paths.ts getDataDir):
// an exact-app override (`HASNA_FEEDBACK_HOME`, then `FEEDBACK_HOME`) names an
// explicit root and wins; the legacy `HASNA_FEEDBACK_DATA_DIR` /
// `FEEDBACK_DATA_DIR` data-dir overrides are honoured on top; otherwise the
// @hasna/paths XDG data home is used once adopted (`HASNA_DATA_HOME` set, or
// `feedback.db` / `feedback.jsonl` already migrated there); otherwise the
// legacy `~/.hasna/feedback` default. Failures are non-fatal: the runtime
// creates the same directories on first use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DATA_DIR_OVERRIDE = (
  process.env["HASNA_FEEDBACK_DATA_DIR"] ||
  process.env["FEEDBACK_DATA_DIR"] ||
  ""
).trim();
const EXACT_ROOT = (
  process.env["HASNA_FEEDBACK_HOME"] ||
  process.env["FEEDBACK_HOME"] ||
  ""
).trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({ app: "feedback" });
  let root;
  if (DATA_DIR_OVERRIDE) {
    root = DATA_DIR_OVERRIDE;
  } else if (EXACT_ROOT) {
    root = EXACT_ROOT;
  } else if (
    DATA_HOME_OVERRIDE ||
    existsSync(join(resolved, "feedback.db")) ||
    existsSync(join(resolved, "feedback.jsonl"))
  ) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "feedback");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
