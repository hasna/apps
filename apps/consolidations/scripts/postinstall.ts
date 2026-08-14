import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Provision the app-home dir tree (mode 0700) for local SQLite + working dirs.
const base = join(homedir(), ".hasna", "consolidations");
for (const sub of ["", "config", "data", "exports", "backups", "logs", "tmp"]) {
  try {
    mkdirSync(sub ? join(base, sub) : base, { recursive: true, mode: 0o700 });
  } catch {
    // best-effort; the CLI also creates these lazily on first open.
  }
}
