#!/usr/bin/env bun

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const CLI_INSTALL_SECURITY_FAILURE =
  "SECURITY_POLICY_DENIED: Refusing to run @hasna/capacity because its CLI artifact is writable by group or world or cannot be verified as a regular non-symlink file";
const cliUrl = new URL("../dist/cli.js", import.meta.url);

async function loadValidatedCli() {
  let descriptor;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(fileURLToPath(cliUrl), constants.O_RDONLY | noFollow);
  } catch {
    return undefined;
  }

  let source;
  let valid = false;
  try {
    const status = fstatSync(descriptor);
    if (!status.isFile() || (process.platform !== "win32" && (status.mode & 0o022) !== 0)) {
      valid = false;
    } else {
      source = readFileSync(descriptor);
      valid = true;
    }
  } catch {
    valid = false;
  }

  try {
    closeSync(descriptor);
  } catch {
    return undefined;
  }
  if (!valid || source === undefined) return undefined;

  const moduleUrl = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    const loaded = await import(moduleUrl);
    return typeof loaded.runAccountsCli === "function" ? loaded : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

if (import.meta.main) {
  const cli = await loadValidatedCli();
  if (cli === undefined) {
    Bun.stderr.write(`${CLI_INSTALL_SECURITY_FAILURE}\n`);
    process.exitCode = 126;
  } else {
    process.exitCode = await cli.runAccountsCli(Bun.argv.slice(2));
  }
}
