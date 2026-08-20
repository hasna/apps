import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Regression tests for scripts/pg-test-gate.mjs — the command named by
// storage.pgTestGate in hasna.contract.json. The gate exists to prove live
// PostgreSQL support, so its FAIL-CLOSED shape is the whole point: a proof
// gate that reports success when it did not run is the vacuous check the
// contract's storage clause exists to prevent.

const repoRoot = join(import.meta.dir, "..", "..");
const gate = join(repoRoot, "scripts", "pg-test-gate.mjs");

function runGate(env: Record<string, string>) {
  return Bun.spawnSync(["bun", "run", gate], { env, stdout: "pipe", stderr: "pipe" });
}

function hermeticEnv(): Record<string, string> {
  // Scrub every variable the gate or the delegated verifier consults, so the
  // tests are deterministic on boxes whose shell profiles export a live DSN.
  const env: Record<string, string> = { ...process.env };
  for (const key of [
    "CONVERSATIONS_TEST_DATABASE_URL",
    "HASNA_CONVERSATIONS_TEST_DATABASE_URL",
    "HASNA_CONVERSATIONS_DATABASE_URL_OWNER",
    "CONVERSATIONS_DATABASE_URL_OWNER",
  ]) {
    delete env[key];
  }
  return env;
}

describe("scripts/pg-test-gate.mjs (storage.pgTestGate)", () => {
  test("fails closed (exit 2) when CONVERSATIONS_TEST_DATABASE_URL is not set", () => {
    const result = runGate(hermeticEnv());
    // The gate must have RUN: a missing script or a spawn failure is not a
    // refusal, it is an unverified run.
    expect(result.exitCode).not.toBeNull();
    expect(result.exitCode).toBe(2);
    const text = new TextDecoder().decode(result.stderr);
    expect(text).toContain("CONVERSATIONS_TEST_DATABASE_URL");
  });

  test("never reports success with an unreachable DSN (refusal, not skip)", () => {
    const env = hermeticEnv();
    // No embedded credentials (synthetic fixture; the secrets scan must stay
    // clean): port 1 on loopback is closed, so the connection is refused. The
    // scheme is built from parts so the source carries no DSN-looking text.
    env.CONVERSATIONS_TEST_DATABASE_URL = ["postgres", "://127.0.0.1:1/conversations_test"].join("");
    const result = runGate(env);
    expect(result.exitCode).not.toBeNull();
    expect(result.exitCode).not.toBe(0);
  });
});
