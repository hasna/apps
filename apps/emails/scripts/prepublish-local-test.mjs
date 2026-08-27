#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const legacyProduct = ["MAIL", "ERY"].join("");
const legacyKeys = [
  [legacyProduct, "MODE"],
  ["HASNA", legacyProduct, "MODE"],
  [legacyProduct, "STORAGE", "MODE"],
  ["HASNA", legacyProduct, "STORAGE", "MODE"],
  [legacyProduct, "API", "URL"],
  [legacyProduct, "API", "KEY"],
  [legacyProduct, ["CLO", "UD"].join(""), "API", "URL"],
  [legacyProduct, ["CLO", "UD"].join(""), "TOKEN"],
  ["HASNA", legacyProduct, "API", "URL"],
  ["HASNA", legacyProduct, "API", "KEY"],
  ["HASNA", legacyProduct, "ENV", "FILE"],
  ["EMAILS", "STORAGE", "MODE"],
  ["HASNA", "EMAILS", "STORAGE", "MODE"],
  // The hosted Emails API env the client reads (src/lib/client-env.ts,
  // src/store-resolution.ts). EMAILS_SELF_HOSTED_URL and
  // EMAILS_CLIENT_ENV_SECRET are the keys that turn "a local database AND an
  // API" into the deliberate both-configured hard boot error, so any machine
  // carrying them saw every prepublish gate fail (O15-00516). The credential
  // keys are scrubbed too: with the URL gone they are inert, but a local-test
  // environment must not carry a live operator credential at all.
  ["EMAILS", "SELF", "HOSTED", "URL"],
  ["EMAILS", "CLIENT", "ENV", "SECRET"],
  ["EMAILS", "SELF", "HOSTED", "API", "KEY"],
  ["EMAILS", "SESSION", "TOKEN"],
  ["EMAILS", "IDP", "TOKEN"],
  // The canonical DB-path key (src/db/database.ts getDbPath() checks
  // HASNA_EMAILS_DB_PATH BEFORE the EMAILS_DB_PATH=:memory: forced below), so an
  // inherited value would silently select an operator database and the suite
  // would run against it (release-review P1, publish-all lane 248f6ed8).
  ["HASNA", "EMAILS", "DB", "PATH"],
  // The resolver (XDG) path variables that became authoritative in 1.4.10
  // (src/paths.ts): an inherited value would move the local-test suite's
  // effective data root to operator data despite the temp HOME and the
  // EMAILS_DB_PATH=:memory: store override (release-review P1, publish-all
  // lane 248f6ed8).
  ["HASNA", "DATA", "HOME"],
  ["HASNA", "EMAILS", "HOME"],
  ["EMAILS", "HOME"],
  ["XDG", "DATA", "HOME"],
];

const scrubbedKeys = legacyKeys.map((parts) => parts.join("_"));

/**
 * The environment the prepublish local-test suite runs in: the process env with
 * a fresh HOME, the local store forced, and every hosted/legacy client env key
 * scrubbed. Exported so the regression test
 * (scripts/prepublish-local-test.test.ts) can assert the scrub without
 * spawning a test suite.
 */
export function buildPrepublishTestEnv(
  processEnv = process.env,
  home = process.env.HOME,
) {
  const env = { ...processEnv, HOME: home, EMAILS_MODE: "local", EMAILS_DB_PATH: ":memory:" };
  for (const key of scrubbedKeys) delete env[key];
  return env;
}

if (import.meta.main) {
  const tmpHome = mkdtempSync(join(tmpdir(), "emails-prepublish-"));
  try {
    const result = spawnSync("bun", ["test"], {
      stdio: "inherit",
      env: buildPrepublishTestEnv(process.env, tmpHome),
    });
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
}
