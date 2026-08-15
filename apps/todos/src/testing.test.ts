import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyLocalTodosTestEnv,
  assertLocalTodosTestEnv,
  localTodosTestEnv,
  LOCAL_ONLY_TODOS_ENV_KEYS,
  SHARED_TODOS_STORE_ENV_KEYS,
} from "./testing.js";
import { resolveTodosCliStorageMode } from "./cli/cloud-router.js";

describe("localTodosTestEnv", () => {
  test("blanks every shared-store pointer and pins storage local", () => {
    const env = localTodosTestEnv();
    for (const key of SHARED_TODOS_STORE_ENV_KEYS) expect(env[key]).toBe("");
    expect(env["HASNA_TODOS_STORAGE_MODE"]).toBe("local");
    expect(env["TODOS_STORAGE_MODE"]).toBe("local");
  });

  test("the scrubbed env cannot resolve the hosted transport", () => {
    // The point of the helper, stated as an assertion on the resolver itself rather
    // than on the shape of the dictionary: a child handed this env routes to SQLite.
    const env = localTodosTestEnv({
      HASNA_TODOS_API_URL: "",
      HASNA_TODOS_API_KEY: "",
    });
    expect(resolveTodosCliStorageMode(env).mode).toBe("sqlite");
  });

  test("still resolves http when a test opts back in explicitly", () => {
    const env = localTodosTestEnv({
      HASNA_TODOS_STORAGE_MODE: "http",
      TODOS_STORAGE_MODE: "http",
      HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
      HASNA_TODOS_API_KEY: "throwaway",
    });
    expect(resolveTodosCliStorageMode(env).mode).toBe("http");
  });

  test("overrides are applied after the scrub, not before", () => {
    const env = localTodosTestEnv({ HASNA_TODOS_DB_PATH: "/tmp/x.db" });
    expect(env["HASNA_TODOS_DB_PATH"]).toBe("/tmp/x.db");
    expect(env["HASNA_TODOS_API_URL"]).toBe("");
  });
});

describe("applyLocalTodosTestEnv", () => {
  test("mutates process.env and restores every touched key exactly", () => {
    const previousUrl = process.env["HASNA_TODOS_API_URL"];
    process.env["HASNA_TODOS_API_URL"] = "https://todos.example.invalid";
    delete process.env["HASNA_TODOS_DB_PATH"];

    const restore = applyLocalTodosTestEnv({ HASNA_TODOS_DB_PATH: "/tmp/isolated.db" });
    expect(process.env["HASNA_TODOS_API_URL"]).toBe("");
    expect(process.env["HASNA_TODOS_DB_PATH"]).toBe("/tmp/isolated.db");

    restore();
    expect(process.env["HASNA_TODOS_API_URL"]).toBe("https://todos.example.invalid");
    // Was unset before the call, so it must be unset again — not blanked.
    expect("HASNA_TODOS_DB_PATH" in process.env).toBe(false);

    if (previousUrl === undefined) delete process.env["HASNA_TODOS_API_URL"];
    else process.env["HASNA_TODOS_API_URL"] = previousUrl;
  });
});

describe("assertLocalTodosTestEnv", () => {
  test("passes on a scrubbed env and names the leaking key otherwise", () => {
    expect(() => assertLocalTodosTestEnv(localTodosTestEnv())).not.toThrow();
    expect(() =>
      assertLocalTodosTestEnv(localTodosTestEnv({ HASNA_TODOS_API_KEY: "live-key-shape" })),
    ).toThrow(/SHARED_TODOS_STORE_REACHABLE: HASNA_TODOS_API_KEY/);
  });
});

describe("scrub coverage against the resolver", () => {
  // The load-bearing test. A consumer copying the scrub list gets it wrong the day the
  // resolver grows a variable; this fails the build here instead, where the contract is.
  test("every routing variable the cloud router reads is scrubbed or explicitly local-only", () => {
    const source = readFileSync(join(import.meta.dir, "cli", "cloud-router.ts"), "utf8");
    const read = new Set<string>();
    for (const match of source.matchAll(/\benv(?:\.|\[")((?:HASNA_)?TODOS_[A-Z0-9_]+)/g)) {
      read.add(match[1]!);
    }
    expect(read.size).toBeGreaterThan(0);

    const covered = new Set<string>([...SHARED_TODOS_STORE_ENV_KEYS, ...LOCAL_ONLY_TODOS_ENV_KEYS]);
    const uncovered = [...read].filter((key) => !covered.has(key)).sort();
    expect(uncovered).toEqual([]);
  });
});
