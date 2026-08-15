/**
 * Regression test for: this package's own `bun test` could reach the live fleet
 * todos store (task `b96293ea`; a reviewer's run briefly completed production
 * task `b9cdd17c`, #incidents 615551).
 *
 * ## Why this spawns a nested run instead of just asserting on `process.env`
 *
 * A test that only asserts the CURRENT process is clean passes for the wrong
 * reason in CI, where the ambient variables were never set in the first place.
 * It would therefore go green on exactly the bytes that carry the bug, and the
 * guard would only ever fail on a developer workstation — which is the same
 * class of vacuous check that let the original defect ship.
 *
 * So this test SUPPLIES the hostile environment itself: it launches a nested
 * `bun test` with sentinel routing variables and asserts the nested process
 * cannot see them. That fails on bytes without the preload and passes with it,
 * identically on a loaded workstation and on a clean CI runner.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const probeFile = join("src", "test", "store-isolation-probe.test.ts");

const SENTINEL_URL = "https://sentinel-must-not-survive.invalid";
const SENTINEL_VALUE = "sentinel-must-not-survive";

describe("todos test-store isolation", () => {
  test("bunfig preloads the store-isolation setup", () => {
    // The mechanism is only load-bearing while it is wired in. Assert the wiring
    // explicitly so deleting it fails here with a clear reason rather than
    // silently re-opening the hole for whoever runs the suite next.
    const bunfig = Bun.file(join(repoRoot, "bunfig.toml"));
    expect(existsSync(join(repoRoot, "bunfig.toml"))).toBe(true);
    expect(existsSync(join(repoRoot, "test", "setup.ts"))).toBe(true);
    return bunfig.text().then((text) => {
      expect(text).toContain("./test/setup.ts");
    });
  });

  test(
    "a nested run launched with sentinel hosted-store routing cannot reach it",
    () => {
      const result = spawnSync(
        process.execPath,
        ["test", probeFile],
        {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 120_000,
          env: {
            ...process.env,
            TODOS_TEST_NESTED_ISOLATION_PROBE: "1",
            // Every shared-store pointer set to a sentinel. If the preload is
            // missing or incomplete, these survive into the nested process.
            HASNA_TODOS_API_URL: SENTINEL_URL,
            HASNA_TODOS_API_KEY: SENTINEL_VALUE,
            HASNA_TODOS_API_SIGNING_KEY: SENTINEL_VALUE,
            TODOS_API_URL: SENTINEL_URL,
            TODOS_API_KEY: SENTINEL_VALUE,
            HASNA_TODOS_DATABASE_URL: SENTINEL_URL,
            TODOS_DATABASE_URL: SENTINEL_URL,
            DATABASE_URL: SENTINEL_URL,
            TODOS_ALLOW_ANONYMOUS: SENTINEL_VALUE,
            HASNA_TODOS_STORAGE_MODE: "remote",
            TODOS_STORAGE_MODE: "remote",
          },
        },
      );

      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      // Report the nested output on failure; a bare exit code here is
      // indistinguishable between "the probe failed" and "bun could not start".
      expect(output).toContain("1 pass");
      expect(result.status).toBe(0);
    },
    180_000,
  );
});
