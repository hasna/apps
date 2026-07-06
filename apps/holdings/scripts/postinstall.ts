import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Provision ~/.hasna/holdings/{config,data,exports,backups,logs,tmp} with dir mode 0700 (§4.4).
const root = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
const base = join(root, ".hasna", "holdings");
for (const dir of ["config", "data", "exports", "backups", "logs", "tmp"]) {
  try {
    mkdirSync(join(base, dir), { recursive: true, mode: 0o700 });
  } catch {
    // best-effort; the CLI also creates these lazily on first open.
  }
}
