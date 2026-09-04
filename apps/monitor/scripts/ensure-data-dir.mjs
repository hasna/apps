// Postinstall: ensure the effective monitor home exists before first run.
//
// Resolves the same effective home the runtime uses (see src/app-home.ts):
//   - the exact-app override MONITOR_CONFIG_DIR / HASNA_MONITOR_HOME wins;
//   - otherwise the @hasna/paths data home once adopted (HASNA_DATA_HOME set
//     or a config.json / monitor.db already at the resolver home);
//   - otherwise the legacy ~/.hasna/monitor default.
//
// This keeps the install-time mkdir on the path the runtime will actually
// read/write — never a hardcoded legacy path when the store has been migrated
// or the operator has opted into the XDG layout. Nothing is migrated here.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";


function resolverHome() {
  return resolverDataDir({ app: "monitor", home: process.env.HOME || undefined });
}

function exactMonitorDir() {
  const dir = process.env.MONITOR_CONFIG_DIR;
  if (dir && dir.trim()) return dir.trim();
  const home = process.env.HASNA_MONITOR_HOME;
  if (home && home.trim()) return home.trim();
  return undefined;
}

function getMonitorDir() {
  const exact = exactMonitorDir();
  if (exact) return resolve(exact);
  return resolve(resolverHome());
}

try {
  mkdirSync(getMonitorDir(), { recursive: true, mode: 0o700 });
} catch {
  // Best-effort: the runtime creates the directory lazily if this fails.
}
