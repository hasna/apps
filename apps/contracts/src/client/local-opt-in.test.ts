import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientResolutionError } from "./errors.js";
import {
  LOCAL_OPT_IN_FALSE_VALUES,
  LOCAL_OPT_IN_TRUE_VALUES,
  describeLocalOptIn,
  hostedClientEnvKeys,
  localOptInAliasEnvKey,
  localOptInEnvKey,
  localStoreNotice,
  selectsLocalStore,
} from "./local-opt-in.js";
import { resolveClientTransport, type KeychainCommandRunner } from "./transport.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("the one local opt-in door: HASNA_<APP>_LOCAL", () => {
  test("derives the canonical key and the one-minor alias from the app name", () => {
    expect(localOptInEnvKey("todos")).toBe("HASNA_TODOS_LOCAL");
    expect(localOptInEnvKey("my-app")).toBe("HASNA_MY_APP_LOCAL");
    expect(localOptInAliasEnvKey("todos")).toBe("TODOS_LOCAL");
    expect(hostedClientEnvKeys("todos")).toEqual([
      "HASNA_TODOS_API_URL",
      "TODOS_API_URL",
      "HASNA_TODOS_API_KEY",
      "TODOS_API_KEY",
      "HASNA_TODOS_API_KEY_OVERRIDE",
      "HASNA_TODOS_API_KEY_REF",
      "HASNA_PROFILE",
    ]);
  });

  test("absent or falsy is off; 1|true|yes is on; anything else is off and reported unrecognised", () => {
    expect(selectsLocalStore("todos", {})).toBe(false);
    for (const value of LOCAL_OPT_IN_FALSE_VALUES) {
      expect(selectsLocalStore("todos", { HASNA_TODOS_LOCAL: value })).toBe(false);
    }
    for (const value of LOCAL_OPT_IN_TRUE_VALUES) {
      expect(selectsLocalStore("todos", { HASNA_TODOS_LOCAL: value })).toBe(true);
      expect(selectsLocalStore("todos", { HASNA_TODOS_LOCAL: ` ${value.toUpperCase()} ` })).toBe(true);
    }
    expect(selectsLocalStore("todos", { HASNA_TODOS_LOCAL: "on" })).toBe(false);
    expect(describeLocalOptIn("todos", { HASNA_TODOS_LOCAL: "on" })).toEqual({
      state: "off",
      envKey: "HASNA_TODOS_LOCAL",
      source: null,
      conflicts: [],
      recognized: false,
    });
    expect(describeLocalOptIn("todos", { HASNA_TODOS_LOCAL: "1" })).toEqual({
      state: "on",
      envKey: "HASNA_TODOS_LOCAL",
      source: "HASNA_TODOS_LOCAL",
      conflicts: [],
      recognized: true,
    });
  });

  test("the unprefixed alias is accepted for one minor, and a disagreement between the two is a conflict", () => {
    expect(selectsLocalStore("todos", { TODOS_LOCAL: "1" })).toBe(true);
    expect(describeLocalOptIn("todos", { TODOS_LOCAL: "yes" }).source).toBe("TODOS_LOCAL");
    expect(() => selectsLocalStore("todos", { HASNA_TODOS_LOCAL: "0", TODOS_LOCAL: "1" })).toThrow(ClientResolutionError);
    expect(describeLocalOptIn("todos", { HASNA_TODOS_LOCAL: "1", TODOS_LOCAL: "false" }).state).toBe("conflict");
  });

  test("on + any hosted client key declared is LOCAL_OPT_IN_CONFLICT (exit 6), naming keys and never values", () => {
    for (const key of hostedClientEnvKeys("todos")) {
      let thrown: unknown;
      try {
        selectsLocalStore("todos", { HASNA_TODOS_LOCAL: "1", [key]: "SUPER-SECRET-VALUE" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ClientResolutionError);
      const error = thrown as ClientResolutionError;
      expect(error.code).toBe("LOCAL_OPT_IN_CONFLICT");
      expect(error.exitCode).toBe(6);
      expect(error.app).toBe("todos");
      expect(error.sources).toEqual(["HASNA_TODOS_LOCAL", key]);
      expect(error.message).toContain(key);
      expect(error.message).not.toContain("SUPER-SECRET-VALUE");
      expect(JSON.stringify(error.toJSON())).not.toContain("SUPER-SECRET-VALUE");
      expect(error.remedy).toContain("HASNA_TODOS_LOCAL");
    }
    // A declared-but-blank hosted key is still a declaration.
    expect(() => selectsLocalStore("todos", { HASNA_TODOS_LOCAL: "1", HASNA_TODOS_API_KEY: "" })).toThrow(/HASNA_TODOS_API_KEY/);
  });

  test("is answered from the env alone: an unsafe credentials file on disk is never opened", () => {
    const root = mkdtempSync(join(tmpdir(), "contracts-local-opt-in-"));
    roots.push(root);
    const file = join(root, ".hasna", "todos", "config", "credentials");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "HASNA_TODOS_API_KEY=disk-key\n", { mode: 0o644 });
    chmodSync(file, 0o644);
    // A world-readable credentials file is a terminal CredentialFileUnsafeError
    // for any reader; the opt-in reads nothing on disk, so it cannot see it.
    expect(selectsLocalStore("todos", { HOME: root, HASNA_TODOS_LOCAL: "1" })).toBe(true);
  });

  test("a hosted client requested under the flag is refused BEFORE the Keychain is consulted", () => {
    const calls: string[][] = [];
    const run: KeychainCommandRunner = (argv) => {
      calls.push([...argv]);
      return { status: 0, stdout: "keychain-key\n", stderr: "" };
    };
    let thrown: unknown;
    try {
      resolveClientTransport(
        "todos",
        { HASNA_TODOS_LOCAL: "1", HASNA_STATION: "s" },
        { credentials: { keychain: { platform: "darwin", hostname: () => "h", run } } },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ClientResolutionError);
    expect((thrown as ClientResolutionError).code).toBe("LOCAL_OPT_IN_CONFLICT");
    expect((thrown as ClientResolutionError).message).toContain("hosted client was requested");
    expect(calls).toEqual([]);
    // Off: the flag is inert and the hosted chain runs as before.
    expect(() => resolveClientTransport("todos", { HASNA_TODOS_LOCAL: "0" })).toThrow(/API_URL/);
  });

  test("the notice is one stderr-shaped line naming the key and the store path", () => {
    expect(localStoreNotice("todos", "/home/u/.hasna/todos/todos.db")).toBe(
      "local mode (HASNA_TODOS_LOCAL=1): on-box store /home/u/.hasna/todos/todos.db; hosted data is NOT visible",
    );
    expect(localStoreNotice("todos", "/x/todos.db")).not.toContain("\n");
  });
});
