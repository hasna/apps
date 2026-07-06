import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Provision ~/.hasna/billing/{config,data,exports,backups,logs,tmp} at mode 0700
// (BUILD-SPEC §3.2/§4.4). Best-effort; the app also creates dirs lazily.
const root = join(homedir(), ".hasna", "billing");
const subdirs = ["config", "data", "exports", "backups", "logs", "tmp"];
try {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const dir of subdirs) mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
} catch {
  // best-effort
}
