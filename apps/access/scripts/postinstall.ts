#!/usr/bin/env bun
// Dev-time creation of the access home dirs, resolved via @hasna/paths
// (XDG / macOS layout): config, data, exports, backups, logs, tmp, mode 0700.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, configDir, dataDir, stateDir } from "@hasna/paths";

const OPTIONS = { app: "access" };
const SUBDIRS = [
  configDir(OPTIONS),
  dataDir(OPTIONS),
  join(dataDir(OPTIONS), "exports"),
  join(dataDir(OPTIONS), "backups"),
  join(stateDir(OPTIONS), "logs"),
  join(cacheDir(OPTIONS), "tmp"),
];

function ensure(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
}

for (const dir of SUBDIRS) ensure(dir);
console.log(`access: ensured ${SUBDIRS.join(", ")} (0700)`);
