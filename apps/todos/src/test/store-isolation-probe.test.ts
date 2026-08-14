/**
 * The inner half of the store-isolation regression test.
 *
 * This file is a fixture, not a test of its own: it is skipped unless the outer
 * test in `store-isolation.test.ts` launches it as a nested `bun test` run with
 * sentinel routing variables set. Guarding on an environment variable rather
 * than a filename keeps it discoverable by the same glob as everything else,
 * so it cannot silently stop being run.
 */
import { expect, test } from "bun:test";
import { assertLocalTodosTestEnv, SHARED_TODOS_STORE_ENV_KEYS } from "../testing.js";

const nested = process.env["TODOS_TEST_NESTED_ISOLATION_PROBE"] === "1";

test.skipIf(!nested)(
  "a nested test run cannot see the sentinel hosted-store routing it was launched with",
  () => {
    // The outer test sets every one of these to a sentinel before spawning. If
    // the preload did not run, or stopped scrubbing one of them, the sentinel
    // survives into this process and the assertion below names which key leaked.
    const leaked = SHARED_TODOS_STORE_ENV_KEYS.filter(
      (key) => (process.env[key] ?? "").includes("sentinel-must-not-survive"),
    );
    expect(leaked).toEqual([]);

    // Same guarantee stated against the package's own predicate rather than the
    // shape of the dictionary, so the two cannot drift apart.
    expect(() => assertLocalTodosTestEnv()).not.toThrow();

    // Storage must be pinned local, not merely un-pointed: an unset mode is a
    // different failure that resolves by guessing.
    expect(process.env["HASNA_TODOS_STORAGE_MODE"]).toBe("local");
  },
);
