#!/usr/bin/env bun
// Creates the effective access home {config,data,exports,backups,logs,tmp} with dir mode 0700.
// The home is resolved through @hasna/paths: the legacy ~/.hasna/access default stays the
// effective home until the store is migrated to the XDG data home or HASNA_DATA_HOME is set;
// exact-app HASNA_ACCESS_HOME / ACCESS_HOME win unconditionally. Mirrors src/core/app-home.ts.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

const APP = "access";
const SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"];

function ensure(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
}

const legacy = join(homedir(), ".hasna", APP);
const resolved = dataDir({ app: APP });
const adopted =
  (typeof process.env.HASNA_DATA_HOME === "string" && process.env.HASNA_DATA_HOME.trim().length > 0) ||
  existsSync(join(resolved, `${APP}.db`));
const root = resolve(
  process.env.HASNA_ACCESS_HOME || process.env.ACCESS_HOME || (adopted ? resolved : legacy),
);

ensure(root);
for (const name of SUBDIRS) ensure(join(root, name));
console.log(`access: ensured ${root} (0700) with subdirs ${SUBDIRS.join(", ")}`);
