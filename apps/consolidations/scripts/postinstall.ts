#!/usr/bin/env bun
// Dev-time creation of the consolidations home dirs, mode 0700, resolving the
// SAME effective home the runtime uses (app-home.ts): exact-app override
// (HASNA_CONSOLIDATIONS_HOME / CONSOLIDATIONS_HOME), else the @hasna/paths XDG
// home once adopted, else the legacy ~/.hasna/consolidations default.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { APP_HOME_SUBDIRS, appHome, appHomeDir } from "../src/core/app-home.js";

function ensure(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
}

const root = appHome();
ensure(root);
for (const name of APP_HOME_SUBDIRS) ensure(appHomeDir(name));
console.log(`consolidations: ensured ${root} (0700) with subdirs ${APP_HOME_SUBDIRS.join(", ")}`);
