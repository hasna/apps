#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";

// Fixtures select their own explicit service/store settings. Never inherit an
// operator endpoint, identity, provider credential, database or runtime preload.
const executionKeys = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "CI", "NO_COLOR", "FORCE_COLOR"];

export function buildPrepublishTestEnv(processEnv = process.env, home) {
  if (typeof home !== "string" || !isAbsolute(home)) throw new Error("An absolute isolated test home is required");
  const env = {};
  for (const key of executionKeys) if (processEnv[key] !== undefined) env[key] = processEnv[key];
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_STATE_HOME: join(home, "state"),
    TMPDIR: join(home, "tmp"),
    TEMP: join(home, "tmp"),
    TMP: join(home, "tmp"),
    npm_config_userconfig: join(home, ".npmrc"),
    AWS_EC2_METADATA_DISABLED: "true",
    TZ: "UTC",
  };
}

if (import.meta.main) {
  const testHome = mkdtempSync(join(tmpdir(), "emails-prepublish-"));
  try {
    const env = buildPrepublishTestEnv(process.env, testHome);
    for (const name of ["config", "data", "cache", "state", "tmp"]) mkdirSync(join(testHome, name));
    const result = spawnSync(process.execPath, ["test", ...process.argv.slice(2)], { stdio: "inherit", env });
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(testHome, { recursive: true, force: true });
  }
}
