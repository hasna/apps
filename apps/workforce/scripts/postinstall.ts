#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Provision ~/.hasna/workforce/{config,data,exports,backups,logs,tmp} at mode 0700.
const root = join(homedir(), ".hasna", "workforce");
const subdirs = ["config", "data", "exports", "backups", "logs", "tmp"];
try {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const dir of subdirs) mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
} catch {
  // best-effort; the CLI also creates these lazily on first open.
}
