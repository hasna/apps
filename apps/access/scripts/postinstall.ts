#!/usr/bin/env bun
// Creates ~/.hasna/access/{config,data,exports,backups,logs,tmp} with dir mode 0700.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"];

function home(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

function appHome(): string {
  return resolve(process.env["HASNA_ACCESS_HOME"] ?? join(home(), ".hasna", "access"));
}

function ensure(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort */
  }
}

const root = appHome();
ensure(root);
for (const name of SUBDIRS) ensure(join(root, name));
console.log(`access: ensured ${root} (0700) with subdirs ${SUBDIRS.join(", ")}`);
