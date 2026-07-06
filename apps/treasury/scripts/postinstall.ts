import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Provision ~/.hasna/treasury/{config,data,exports,backups,logs,tmp} at mode 0700.
const root = join(homedir(), ".hasna", "treasury");
const subdirs = ["config", "data", "exports", "backups", "logs", "tmp"];
try {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const sub of subdirs) mkdirSync(join(root, sub), { recursive: true, mode: 0o700 });
} catch {
  // best-effort; the CLI also creates dirs lazily on first open.
}
