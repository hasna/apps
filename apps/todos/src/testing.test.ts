import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyLocalTodosTestEnv,
  assertLocalTodosTestEnv,
  localTodosTestEnv,
  LOCAL_ONLY_TODOS_ENV_KEYS,
  REMOVED_TODOS_ENV_KEYS,
  SHARED_TODOS_STORE_ENV_KEYS,
} from "./testing.js";
import { resolveTodosCliTransport } from "./cli/cloud-router.js";

describe("localTodosTestEnv", () => {
  test("blanks every shared-store pointer and deletes the retired storage-mode variables", () => {
    const env = localTodosTestEnv();
    for (const key of SHARED_TODOS_STORE_ENV_KEYS) expect(env[key]).toBe("");
    for (const key of REMOVED_TODOS_ENV_KEYS) expect(key in env).toBe(false);
  });

  test("the scrubbed env cannot resolve the hosted transport", () => {
    // The point of the helper, stated as an assertion on the resolver itself rather
    // than on the shape of the dictionary: a child handed this env routes to SQLite.
    const env = localTodosTestEnv({
      HASNA_TODOS_API_URL: "",
      HASNA_TODOS_API_KEY: "",
    });
    expect(resolveTodosCliTransport(env).transport).toBe("sqlite");
  });

  test("still resolves http when a test opts back in explicitly", () => {
    const env = localTodosTestEnv({
      HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
      HASNA_TODOS_API_KEY: "throwaway",
    });
    expect(resolveTodosCliTransport(env).transport).toBe("http");
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

    const covered = new Set<string>([
      ...SHARED_TODOS_STORE_ENV_KEYS,
      ...LOCAL_ONLY_TODOS_ENV_KEYS,
      ...REMOVED_TODOS_ENV_KEYS,
    ]);
    const uncovered = [...read].filter((key) => !covered.has(key)).sort();
    expect(uncovered).toEqual([]);
  });

  test("a no-HOME caller cannot touch the machine credential file", () => {
    // Negative control (hasna/apps#719 review P1): disk delivery of a fixture
    // key must happen only under a DELIBERATELY supplied HOME. A caller that
    // does not override HOME inherits the machine home through process.env and
    // must never receive a write to ~/.hasna/cloud/todos.env — doing so would
    // replace the machine's configured credential with the fixture value.
    const machineFile = join(
      process.env.HOME ?? "/nonexistent",
      ".hasna",
      "cloud",
      "todos.env",
    );
    const before = existsSync(machineFile)
      ? { size: statSync(machineFile).size, mtimeNs: statSync(machineFile).mtimeNs }
      : null;

    localTodosTestEnv({
      HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
      HASNA_TODOS_API_KEY: "throwaway",
    });

    const after = existsSync(machineFile)
      ? { size: statSync(machineFile).size, mtimeNs: statSync(machineFile).mtimeNs }
      : null;
    expect(after).toEqual(before);
  });

  test("a HOME-overriding caller delivers the key to that home only", () => {
    // Positive control: with HOME deliberately supplied, the fixture key lands
    // in the override home's credential file and nowhere else.
    const home = mkdtempSync(join(tmpdir(), "todos-fixture-delivery-"));
    try {
      localTodosTestEnv({
        HOME: home,
        HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
        HASNA_TODOS_API_KEY: "throwaway",
      });
      const written = readFileSync(join(home, ".hasna", "cloud", "todos.env"), "utf8");
      expect(written).toContain("HASNA_TODOS_API_KEY=throwaway");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
