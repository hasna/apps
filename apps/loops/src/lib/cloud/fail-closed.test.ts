/**
 * Fail-closed contract for the loops client connection (owner rulings
 * 2026-09-04 and 2026-09-07, hasna/apps#1720).
 *
 *   - hosted with no credential            → non-zero refusal, NO SQLite file
 *     opened, NO `*-local-fallback` event, and (unlike the deprecated notice
 *     era) nothing printed as if a fallback happened
 *   - local mode ONLY by explicit opt-in  → `HASNA_LOOPS_LOCAL=1` (alias
 *     `LOOPS_LOCAL=1`), and it announces itself on stderr as "LOCAL mode"
 *   - the opt-in short-circuits BEFORE the resolver — no Keychain item and no
 *     credential file is read for it — and a configured environment outranks
 *     it
 *
 * All hermetic: fake HOME for the disk tier, injected `security` runner for
 * the Keychain tier.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import {
  LOOPS_LOCAL_OPT_IN_ENV_KEYS,
  noticeLocalLoopsMode,
  resetLocalLoopsModeNotice,
  resolveCloudStorage,
  loopsResolverInputs,
  selectsLoopsLocalStore,
} from "./resolve.js";
import { getStore } from "../store/index.js";
import { resolvedClientRuntimeConfig } from "../runtime-status.js";
import { resolveRuntimeConfig } from "../runtime-config.js";

const [LOCAL_KEY, LOCAL_ALIAS] = LOOPS_LOCAL_OPT_IN_ENV_KEYS;

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  resetLocalLoopsModeNotice();
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `loops-failclosed-${label}-`));
  tempRoots.push(root);
  return root;
}

function fakeKeychain(items: Record<string, string>) {
  const calls: string[][] = [];
  const run = (argv: readonly string[]): KeychainCommandResult => {
    calls.push([...argv]);
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
  return { calls, options: { credentials: { keychain: { platform: "darwin", run } } } as const };
}

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root. */
function sqliteFilesUnder(dir: string, depth = 0): string[] {
  if (depth > 8 || !dir) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full, depth + 1));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("fail closed with no credential", () => {
  test("an empty home throws, builds no client, and creates no database", () => {
    const home = tempHome("empty");
    const keychain = fakeKeychain({});

    expect(() =>
      resolveCloudStorage("loops", { HOME: home }, keychain.options),
    ).toThrow(/no loops client connection is configured/);
    expect(() => getStore({ HOME: home })).toThrow(/no loops client connection is configured/);
    expect(() => resolvedClientRuntimeConfig({ HOME: home })).toThrow(
      /no loops client connection is configured/,
    );

    // The seam throws before anything can open SQLite: no store file, no app
    // directory conjured as a side effect of failing.
    expect(sqliteFilesUnder(home)).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });

  test("the refusal names every tier and the opt-in, never a value", () => {
    const home = tempHome("tiers");
    const keychain = fakeKeychain({});
    let message = "";
    try {
      resolveCloudStorage("loops", { HOME: home }, keychain.options);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("HASNA_LOOPS_API_URL");
    expect(message).toContain("HASNA_LOOPS_API_KEY");
    expect(message).toContain("hasna.credentials.loops.api-key");
    expect(message).toContain("~/.hasna/loops/config/credentials");
    expect(message).toContain(`${LOCAL_KEY}=1`);
    expect(message).toContain(`${LOCAL_ALIAS}=1`);
  });

  test("the refusal is an exception, never a local-fallback event or notice", () => {
    const home = tempHome("no-event");
    const keychain = fakeKeychain({});
    const writes: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => writes.push(String(line));
    try {
      expect(() => resolveCloudStorage("loops", { HOME: home }, keychain.options)).toThrow(
        /no loops client connection is configured/,
      );
    } finally {
      console.error = originalError;
    }
    expect((writes.join("\n").match(/local/gi) ?? []).length).toBe(0);
  });

  test("a scanner's scrubbed environment (declared-but-blank vars) still fails closed", () => {
    const home = tempHome("scrubbed");
    expect(() =>
      getStore({
        HOME: home,
        HASNA_LOOPS_API_URL: "",
        HASNA_LOOPS_API_KEY: "",
        [LOCAL_KEY]: "",
        [LOCAL_ALIAS]: "",
      }),
    ).toThrow(/no loops client connection is configured/);
    expect(sqliteFilesUnder(home)).toEqual([]);
  });
});

describe("explicit local opt-in", () => {
  test("HASNA_LOOPS_LOCAL=1 serves sqlite WITHOUT reading the Keychain or disk", () => {
    const home = tempHome("opt-in");
    // A resolvable credential exists in BOTH stores and neither is touched.
    const file = join(home, ".hasna", "loops", "config", "credentials");
    mkdirSync(join(home, ".hasna", "loops", "config"), { recursive: true });
    writeFileSync(file, "HASNA_LOOPS_API_KEY=fixture\n", { mode: 0o600 });
    const keychain = fakeKeychain({ "hasna.credentials.loops.api-key": "fixture" });
    const statBefore = readdirSync(home);

    const resolution = resolveCloudStorage("loops", { HOME: home, [LOCAL_KEY]: "1" }, keychain.options);
    expect(resolution).toEqual({ transport: "file", client: null });
    expect(keychain.calls).toEqual([]);
    // The disk credential was not consulted either: the file is untouched.
    expect(readdirSync(home)).toEqual(statBefore);
  });

  test("malformed or conflicting local opt-in values refuse instead of opening SQLite", () => {
    for (const env of [
      { [LOCAL_KEY]: "true" },
      { [LOCAL_KEY]: " 1 " },
      { [LOCAL_KEY]: "off" },
      { [LOCAL_KEY]: "0", [LOCAL_ALIAS]: "1" },
      { [LOCAL_KEY]: "1", [LOCAL_ALIAS]: "false" },
    ]) {
      const home = tempHome("invalid-local-opt-in");
      expect(() => resolveCloudStorage("loops", { HOME: home, ...env })).toThrow(/must be exactly 1/);
      expect(sqliteFilesUnder(home)).toEqual([]);
    }
  });

  test("the unprefixed alias LOOPS_LOCAL=1 selects the same route", () => {
    const home = tempHome("alias");
    const keychain = fakeKeychain({ "hasna.credentials.loops.api-key": "fixture" });
    expect(selectsLoopsLocalStore({ HOME: home, [LOCAL_ALIAS]: "1" })).toBe(true);
    expect(resolveCloudStorage("loops", { HOME: home, [LOCAL_ALIAS]: "1" }, keychain.options)).toEqual({
      transport: "file",
      client: null,
    });
    expect(keychain.calls).toEqual([]);
  });

  test("the opt-in prints the LOCAL-mode announcement, once, on stderr", () => {
    const writes: string[] = [];
    noticeLocalLoopsMode((line) => writes.push(line));
    noticeLocalLoopsMode((line) => writes.push(line));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("loops: LOCAL mode");
    expect(writes[0]).toContain("on-box SQLite store");
    expect(writes[0]).toContain(LOCAL_KEY);
    expect(writes[0]).toContain("hasna.credentials.loops.api-key");
    expect(writes[0]).toContain("https://api.hasna.com/loops");
  });

  test("blank deliberate env selectors remain terminal and cannot downgrade to local", () => {
    for (const key of ["HASNA_PROFILE", "HASNA_LOOPS_API_KEY_OVERRIDE", "HASNA_LOOPS_API_KEY_REF"]) {
      const home = tempHome(`blank-${key.toLowerCase()}`);
      expect(() => resolveCloudStorage("loops", { HOME: home, [LOCAL_KEY]: "1", [key]: "" })).toThrow();
      expect(sqliteFilesUnder(home)).toEqual([]);
    }
  });

  test("normalizing blank URL/key aliases preserves the ambient marker used by Secrets bootstrap", () => {
    const ambient = { HASNA_LOOPS_API_URL: "" } as Record<string | symbol, string | boolean | undefined>;
    Object.defineProperty(ambient, Symbol.for("hasna:contracts:ambientClientEnvironment"), { value: true });
    const inputs = loopsResolverInputs(ambient as Record<string, string | undefined>);
    expect(inputs.env).not.toBe(ambient);
    expect((inputs.env as unknown as Record<symbol, unknown>)[Symbol.for("hasna:contracts:ambientClientEnvironment")]).toBe(true);
  });

  test("an explicit credential argument outranks the local opt-in, while a blank deliberate argument refuses", () => {
    const hosted = resolveCloudStorage(
      "loops",
      { HOME: tempHome("explicit-credential"), [LOCAL_KEY]: "1" },
      { credentials: { apiKey: "explicit-test-key" } },
    );
    expect(hosted.transport).toBe("api");
    if (hosted.transport !== "api") throw new Error("unreachable");
    expect(hosted.baseUrl).toBe("https://api.hasna.com/loops/v1");

    expect(() =>
      resolveCloudStorage(
        "loops",
        { HOME: tempHome("blank-explicit-credential"), [LOCAL_KEY]: "1" },
        { credentials: { apiKey: "" } },
      ),
    ).toThrow();
  });

  test("hosted authority does not hide a malformed local selector", () => {
    expect(() => resolveCloudStorage("loops", {
      HOME: tempHome("hosted-invalid-local"),
      HASNA_LOOPS_API_KEY: "env-key",
      [LOCAL_KEY]: " 1 ",
    })).toThrow(/must be exactly 1/);
  });

  test("a configured environment outranks the opt-in and fails loudly when half-configured", () => {
    // Env authority present → hosted path, even with the opt-in set.
    const keychain = fakeKeychain({});
    const resolution = resolveCloudStorage(
      "loops",
      { HOME: tempHome("opt-outranked"), [LOCAL_KEY]: "1", HASNA_LOOPS_API_KEY: "env-key" },
      keychain.options,
    );
    expect(resolution.transport).toBe("api");
    // Half-configured env (URL without a key) with the opt-in set is a refusal,
    // never a silent downgrade to the file store.
    expect(() =>
      resolveCloudStorage("loops", { HOME: tempHome("opt-half"), [LOCAL_KEY]: "1", HASNA_LOOPS_API_URL: "https://loops.example.test" }),
    ).toThrow(/requires both/);
  });


});

describe("report surfaces agree with the refusal", () => {
  test("the CLI status config resolves through the same resolver and refuses identically", () => {
    const home = tempHome("status");
    expect(() => resolvedClientRuntimeConfig({ HOME: home })).toThrow(
      /no loops client connection is configured/,
    );
    // The env-presence report (server surfaces) stays non-throwing; the
    // resolver-based one is the client authority.
    expect(resolveRuntimeConfig({ HOME: home }).connection).toBe("file");
  });

  test("the status config reports the local opt-in as the explicit local connection", () => {
    const config = resolvedClientRuntimeConfig({ [LOCAL_KEY]: "1" });
    expect(config).toMatchObject({ connection: "file", apiKeyPresent: false, databaseUrlPresent: false });
  });
});
