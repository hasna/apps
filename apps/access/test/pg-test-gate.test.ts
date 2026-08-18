import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * storage.pgTestGate (hasna.contract.json) names scripts/pg-test-gate.mjs.
 * The gate is fail-closed by design: it must refuse (rc=2) when the test DSN
 * is absent, and it must fail through the app's own TLS policy when the DSN
 * does not request verify-full — a proof gate that passes without running is
 * the vacuous check the storage clause exists to prevent.
 */
describe("pg-test-gate fail-closed behavior", () => {
  it("exits 2 with the guidance message when ACCESS_TEST_DATABASE_URL is unset", () => {
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env["ACCESS_TEST_DATABASE_URL"];
    delete env["HASNA_ACCESS_DATABASE_URL"];
    const result = spawnSync("bun", ["scripts/pg-test-gate.mjs"], {
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ACCESS_TEST_DATABASE_URL is not set");
  });

  it("refuses a DSN that violates the app's verify-full TLS policy", () => {
    const env = { ...process.env } as Record<string, string | undefined>;
    env["ACCESS_TEST_DATABASE_URL"] = "postgres://user:pass@127.0.0.1:5432/access_test?sslmode=require";
    delete env["HASNA_ACCESS_DATABASE_URL"];
    const result = spawnSync("bun", ["scripts/pg-test-gate.mjs"], {
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("verify-full");
  });
});

// Sanity: the gate file exists and is runnable without syntax errors.
describe("pg-test-gate script", () => {
  it("is registered as the test:postgres script", () => {
    const pkg = JSON.parse(execFileSync("bun", ["-e", "console.log(JSON.stringify(require('./package.json').scripts))"], {
      encoding: "utf8",
      timeout: 30_000,
    }) as string) as Record<string, string>;
    expect(pkg["test:postgres"]).toBe("bun scripts/pg-test-gate.mjs");
  });
});
