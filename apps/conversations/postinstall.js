// Best-effort install-time creation of the conversations data home,
// resolving the SAME effective data root the runtime uses (src/lib/db.ts
// getDataDir): an exact-app override (HASNA_CONVERSATIONS_HOME /
// CONVERSATIONS_HOME) wins; otherwise the @hasna/paths XDG data home once
// adopted (HASNA_DATA_HOME set, or messages.db already migrated there);
// otherwise the legacy ~/.hasna/conversations default. Failures are
// non-fatal: the runtime getDataDir() creates the same directories on first
// use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDE = (process.env["HASNA_CONVERSATIONS_HOME"] || process.env["CONVERSATIONS_HOME"] || "").trim();
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({ app: "conversations" });
  let root;
  if (EXACT_OVERRIDE) {
    root = EXACT_OVERRIDE;
  } else if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "messages.db"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "conversations");
  }
  for (const dir of [root, join(root, "training")]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
} catch {
  // never fail an install over pre-created directories
}
