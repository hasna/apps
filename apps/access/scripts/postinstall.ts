#!/usr/bin/env bun
// Dev-time creation of the access home dirs, mode 0700, resolving the SAME
// effective home the runtime uses (app-home.ts): exact-app override
// (HASNA_ACCESS_HOME / ACCESS_HOME), else the @hasna/paths XDG home once
// adopted, else the legacy ~/.hasna/access default.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { APP_SUBDIRS, getAppDir, getAppHome } from "../src/core/app-home.js";

function ensure(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
}

const root = getAppHome();
ensure(root);
for (const name of APP_SUBDIRS) ensure(getAppDir(name));
console.log(`access: ensured ${root} (0700) with subdirs ${APP_SUBDIRS.join(", ")}`);
