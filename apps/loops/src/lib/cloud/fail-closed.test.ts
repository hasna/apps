/**
 * Fail-closed contract for the loops client connection (owner ruling
 * 2026-09-04, hasna/apps#1720).
 *
 *   - hosted with no credential            → non-zero refusal, NO SQLite file
 *     opened, NO `*-local-fallback` event, and (unlike the deprecated notice
 *     era) nothing printed as if a fallback happened
 *   - local mode ONLY by explicit opt-in  → `HASNA_LOOPS_CONNECTION=file`, and
 *     it announces itself on stderr with the word "local"
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
  LOOPS_CONNECTION_ENV_KEY,
  noticeLocalLoopsMode,
  resetLocalLoopsModeNotice,
  resolveCloudStorage,
} from "./resolve.js";
import { getStore } from "../store/index.js";
import { resolvedClientRuntimeConfig } from "../runtime-status.js";
import { resolveRuntimeConfig } from "../runtime-config.js";

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
      getStore({ HOME: home, HASNA_LOOPS_API_URL: "", HASNA_LOOPS_API_KEY: "", [LOOPS_CONNECTION_ENV_KEY]: "" }),
    ).toThrow(/no loops client connection is configured/);
    expect(sqliteFilesUnder(home)).toEqual([]);
  });
});

describe("explicit local opt-in", () => {
  test("HASNA_LOOPS_CONNECTION=file serves sqlite WITHOUT reading the Keychain or disk", () => {
    const home = tempHome("opt-in");
    // A resolvable credential exists in BOTH stores and neither is touched.
    const file = join(home, ".hasna", "loops", "config", "credentials");
    mkdirSync(join(home, ".hasna", "loops", "config"), { recursive: true });
    writeFileSync(file, "HASNA_LOOPS_API_KEY=fixture\n", { mode: 0o600 });
    const keychain = fakeKeychain({ "hasna.credentials.loops.api-key": "fixture" });
    const statBefore = readdirSync(home);

    const resolution = resolveCloudStorage("loops", { HOME: home, [LOOPS_CONNECTION_ENV_KEY]: "file" }, keychain.options);
    expect(resolution).toEqual({ transport: "file", client: null });
    expect(keychain.calls).toEqual([]);
    // The disk credential was not consulted either: the file is untouched.
    expect(readdirSync(home)).toEqual(statBefore);
  });

  test("the opt-in prints the local-mode announcement, once, on stderr", () => {
    const writes: string[] = [];
    noticeLocalLoopsMode((line) => writes.push(line));
    noticeLocalLoopsMode((line) => writes.push(line));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("loops: local mode");
    expect(writes[0]).toContain("local file store");
    expect(writes[0]).toContain(LOOPS_CONNECTION_ENV_KEY);
  });

  test("a configured environment outranks the opt-in and fails loudly when half-configured", () => {
    // Env authority present → hosted path, even with the opt-in set.
    const keychain = fakeKeychain({});
    const resolution = resolveCloudStorage(
      "loops",
      { HOME: tempHome("opt-outranked"), [LOOPS_CONNECTION_ENV_KEY]: "file", HASNA_LOOPS_API_KEY: "env-key" },
      keychain.options,
    );
    expect(resolution.transport).toBe("api");
    // Half-configured env (URL without a key) with the opt-in set is a refusal,
    // never a silent downgrade to the file store.
    expect(() =>
      resolveCloudStorage("loops", { HOME: tempHome("opt-half"), [LOOPS_CONNECTION_ENV_KEY]: "file", HASNA_LOOPS_API_URL: "https://loops.example.test" }),
    ).toThrow(/requires both/);
  });

  test("the retired connection values are hard errors", () => {
    expect(() => getStore({ [LOOPS_CONNECTION_ENV_KEY]: "api" })).toThrow(/is retired/);
    expect(() => getStore({ [LOOPS_CONNECTION_ENV_KEY]: "sqlite" })).toThrow(
      `${LOOPS_CONNECTION_ENV_KEY} must be 'file'; got "sqlite".`,
    );
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

  test("the status config reports the file opt-in as the explicit local connection", () => {
    const config = resolvedClientRuntimeConfig({ [LOOPS_CONNECTION_ENV_KEY]: "file" });
    expect(config).toMatchObject({ connection: "file", apiKeyPresent: false, databaseUrlPresent: false });
  });
});