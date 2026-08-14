import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Provision the app-home dirs for local SQLite + exports/backups/logs with 0700 perms.
const root = join(process.env["HOME"] || process.env["USERPROFILE"] || homedir(), ".hasna", "fleet");
for (const sub of ["config", "data", "exports", "backups", "logs", "tmp"]) {
  try {
    mkdirSync(join(root, sub), { recursive: true, mode: 0o700 });
  } catch {
    // best-effort; the CLI/serve also create these lazily on first open.
  }
}
