// Best-effort install-time creation of the tickets data home (and its
// training/ subdirectory), resolving the SAME effective data dir the runtime
// uses (src/lib/paths.ts getTicketsDir): an exact-app override
// (HASNA_TICKETS_HOME / TICKETS_HOME) wins; otherwise the @hasna/paths XDG
// data home once adopted (HASNA_DATA_HOME set, or config.json / tickets.db
// already migrated there); otherwise the legacy ~/.hasna/tickets default.
// Failures are non-fatal: the runtime creates the same directories on first
// use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDES = [
  (process.env["HASNA_TICKETS_HOME"] || "").trim(),
  (process.env["TICKETS_HOME"] || "").trim(),
].filter(Boolean);
const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({
    app: "tickets",
    home: process.env["HOME"] || process.env["USERPROFILE"] || homedir(),
  });
  let root;
  if (EXACT_OVERRIDES.length > 0) {
    root = EXACT_OVERRIDES[0];
  } else if (
    DATA_HOME_OVERRIDE ||
    existsSync(join(resolved, "config.json")) ||
    existsSync(join(resolved, "tickets.db"))
  ) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "tickets");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const trainingDir = join(root, "training");
  if (!existsSync(trainingDir)) mkdirSync(trainingDir, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
