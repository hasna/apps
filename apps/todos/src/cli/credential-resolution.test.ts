/**
 * The five credential tiers, exercised through the surfaces that use them.
 *
 * `transport-collapse.test.ts` covers the ENV tier with caller-built
 * dictionaries; this file covers the tiers an env dictionary cannot express —
 * the macOS Keychain and `~/.hasna/todos/config/credentials` — plus the
 * fail-closed arm, where the assertion is not only the exit code but that NO
 * SQLite file was created anywhere under the run's home.
 *
 * Two seams make that possible without touching the machine's real state:
 *
 *   - the Keychain tier takes an INJECTABLE `security` runner, so "the item
 *     exists" and "the item is missing" are both first-class cases and the
 *     login keychain is never opened. Injecting a runner also switches the
 *     tier on for a caller-built env, which is otherwise ambient-only.
 *   - the disk tier is anchored on HOME, so a temporary home is a complete
 *     hermetic filesystem for it.
 *
 * Every credential value here is a fixture string. The resolver never logs a
 * value, and neither does this file: assertions are on the SOURCE (`keychain:…`,
 * an absolute path, an env key NAME) and on observable routing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import {
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
  resolveTodosCliTransport,
} from "./cloud-router.js";
import { TODOS_CREDENTIALS_FILE_SEGMENTS } from "../testing.js";

const KEYCHAIN_KEY = "fixture-keychain-key";
const DISK_KEY = "fixture-disk-key";
const ENV_KEY = "fixture-env-key";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `todos-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

/** Write the credential file the resolver reads, at the mode it demands. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ...TODOS_CREDENTIALS_FILE_SEGMENTS);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, { mode });
  chmodSync(file, mode);
  return file;
}

/**
 * A fake `/usr/bin/security`.
 *
 * `items` maps a service name to its stored value; anything absent answers
 * status 44, which is how the real tool reports item-not-found and how the
 * resolver recognises an absent tier. Calls are recorded so a test can assert
 * the tier was consulted — or, for the isolation cases, that it was not.
 */
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
function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("tier 3 — the macOS Keychain", () => {
  test("an api-key item alone resolves the fleet gateway", () => {
    const keychain = fakeKeychain({ "hasna.credentials.todos.api-key": KEYCHAIN_KEY });
    const resolution = resolveTodosCliTransport({ HOME: tempHome("kc-only") }, keychain.options);

    expect(resolution.transport).toBe("http");
    expect(resolution.authority).toMatchObject({
      baseUrl: "https://api.hasna.com/todos/v1",
      apiUrlSource: "default",
      apiKeyTier: "keychain",
    });
    // The SOURCE is reported, never the value.
    expect(resolution.authority!.apiKeySource).toMatch(/^keychain:hasna\.credentials\.todos\.api-key@/);
    expect(JSON.stringify(resolution)).not.toContain(KEYCHAIN_KEY);
  });

  test("the api-url item beside it selects the authority", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.todos.api-key": KEYCHAIN_KEY,
      "hasna.credentials.todos.api-url": "https://todos.station.example",
    });
    const status = getTodosRemoteAuthorityConfigStatus({ HOME: tempHome("kc-url") }, keychain.options);

    expect(status.ok).toBe(true);
    expect(status.v1_base_url).toBe("https://todos.station.example/v1");
    expect(status.api_url_configured).toBe(true);
    expect(status.api_url_source).toMatch(/^keychain:hasna\.credentials\.todos\.api-url@/);
    expect(status.api_key_tier).toBe("keychain");
  });

  test("the Keychain outranks the environment, because it is re-read per call", () => {
    const home = tempHome("kc-beats-env");
    const keychain = fakeKeychain({ "hasna.credentials.todos.api-key": KEYCHAIN_KEY });
    const resolution = resolveTodosCliTransport(
      { HOME: home, HASNA_TODOS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(resolution.authority!.apiKeyTier).toBe("keychain");
    // Sources that disagree are reported, so a half-finished rotation is
    // visible instead of surfacing later as an unexplained 401.
    expect(resolution.authority!.warning).toMatch(/disagree/);
  });

  test("a missing item is an absent tier, not a failure — the next tier decides", () => {
    const home = tempHome("kc-missing");
    const keychain = fakeKeychain({});
    const resolution = resolveTodosCliTransport(
      { HOME: home, HASNA_TODOS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(resolution.authority!.apiKeyTier).toBe("env");
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("an item that exists but cannot be READ is terminal, never resolved around", () => {
    // The dangerous shape: a locked keychain answering non-zero. Falling
    // through to the environment here would silently act as a different
    // principal than the machine's own item names.
    const home = tempHome("kc-locked");
    const run = (): KeychainCommandResult => ({ status: 51, stdout: "", stderr: "User interaction is not allowed." });
    expect(() =>
      resolveTodosCliTransport(
        { HOME: home, HASNA_TODOS_API_KEY: ENV_KEY },
        { credentials: { keychain: { platform: "darwin", run } } },
      ),
    ).toThrow(/REMOTE_API_CREDENTIAL_INVALID/);
  });

  test("the tier does not exist off darwin", () => {
    const home = tempHome("kc-linux");
    const keychain = fakeKeychain({ "hasna.credentials.todos.api-key": KEYCHAIN_KEY });
    expect(() =>
      resolveTodosCliTransport(
        { HOME: home },
        { credentials: { keychain: { ...keychain.options.credentials.keychain, platform: "linux" } } },
      ),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(keychain.calls).toEqual([]);
  });
});

describe("tier 4 — ~/.hasna/todos/config/credentials", () => {
  test("a credentials file supplies both the key and the authority", () => {
    const home = tempHome("disk");
    const file = writeCredentialsFile(
      home,
      `HASNA_TODOS_API_KEY=${DISK_KEY}\nHASNA_TODOS_API_URL=https://todos.disk.example\n`,
    );
    const status = getTodosRemoteAuthorityConfigStatus({ HOME: home });

    expect(status.ok).toBe(true);
    expect(status.v1_base_url).toBe("https://todos.disk.example/v1");
    expect(status.api_key_tier).toBe("disk");
    expect(status.api_key_source).toBe(file);
  });

  test("HASNA_HOME moves the root, and XDG is never consulted", () => {
    const home = tempHome("disk-home");
    const hasnaHome = tempHome("disk-hasna-home");
    // The credential lives ONLY under HASNA_HOME. A resolver that still read
    // ~/.hasna, or $XDG_CONFIG_HOME/hasna, would find nothing here and fail.
    const file = join(hasnaHome, "todos", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `HASNA_TODOS_API_KEY=${DISK_KEY}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);

    const resolution = resolveTodosCliTransport({
      HOME: home,
      HASNA_HOME: hasnaHome,
      XDG_CONFIG_HOME: join(home, "xdg-must-not-be-read"),
    });
    expect(resolution.authority).toMatchObject({ apiKeyTier: "disk", apiKeySource: file });
  });

  test("disk outranks the environment so a rotation heals an old shell", () => {
    const home = tempHome("disk-beats-env");
    writeCredentialsFile(home, `HASNA_TODOS_API_KEY=${DISK_KEY}\n`);
    const resolution = resolveTodosCliTransport({ HOME: home, HASNA_TODOS_API_KEY: ENV_KEY });
    expect(resolution.authority!.apiKeyTier).toBe("disk");
  });

  test("a world-readable credentials file is refused, not silently skipped", () => {
    const home = tempHome("disk-mode");
    writeCredentialsFile(home, `HASNA_TODOS_API_KEY=${DISK_KEY}\n`, 0o644);
    expect(() => resolveTodosCliTransport({ HOME: home, HASNA_TODOS_API_KEY: ENV_KEY })).toThrow(
      /REMOTE_API_CREDENTIAL_INVALID/,
    );
  });

  test("no file is an absent tier — the environment still decides", () => {
    const home = tempHome("disk-absent");
    const resolution = resolveTodosCliTransport({ HOME: home, HASNA_TODOS_API_KEY: ENV_KEY });
    expect(resolution.authority!.apiKeyTier).toBe("env");
  });
});

describe("tier ordering, end to end", () => {
  test("Keychain beats disk beats env, and each falls through when absent", () => {
    const home = tempHome("ordering");
    writeCredentialsFile(home, `HASNA_TODOS_API_KEY=${DISK_KEY}\n`);
    const env = { HOME: home, HASNA_TODOS_API_KEY: ENV_KEY };

    const withKeychain = fakeKeychain({ "hasna.credentials.todos.api-key": KEYCHAIN_KEY });
    expect(resolveTodosCliTransport(env, withKeychain.options).authority!.apiKeyTier).toBe("keychain");

    const withoutKeychain = fakeKeychain({});
    expect(resolveTodosCliTransport(env, withoutKeychain.options).authority!.apiKeyTier).toBe("disk");

    rmSync(join(home, ...TODOS_CREDENTIALS_FILE_SEGMENTS));
    expect(resolveTodosCliTransport(env, withoutKeychain.options).authority!.apiKeyTier).toBe("env");
  });

  test("an explicit --api-key argument is tier 1 and never falls through", () => {
    const home = tempHome("explicit");
    writeCredentialsFile(home, `HASNA_TODOS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.todos.api-key": KEYCHAIN_KEY });
    const resolution = resolveTodosCliTransport(
      { HOME: home, HASNA_TODOS_API_KEY: ENV_KEY },
      { credentials: { ...keychain.options.credentials, apiKey: "fixture-explicit-key" } },
    );
    expect(resolution.authority!.apiKeyTier).toBe("argument");
  });
});

describe("nothing resolves — fail closed, and leave no store behind", () => {
  test("an empty home throws, builds no client, and creates no database", () => {
    const home = tempHome("fail-closed");
    const keychain = fakeKeychain({});

    expect(() => resolveTodosCliTransport({ HOME: home }, keychain.options)).toThrow(
      /REMOTE_API_CONFIG_MISSING/,
    );
    expect(() => getTodosCloudClient({ HOME: home }, undefined, keychain.options)).toThrow(
      /REMOTE_API_CONFIG_MISSING/,
    );

    // The seam throws before anything can open SQLite: no store file, and no
    // app directory conjured as a side effect of failing.
    expect(sqliteFilesUnder(home)).toEqual([]);
    expect(existsSync(join(home, ".hasna", "todos", "todos.db"))).toBe(false);
    expect(existsSync(join(home, ".todos"))).toBe(false);
  });

  test("the status surface reports the same refusal instead of throwing", () => {
    const home = tempHome("fail-closed-status");
    const status = getTodosRemoteAuthorityConfigStatus({ HOME: home }, fakeKeychain({}).options);
    expect(status.ok).toBe(false);
    expect(status.selected).toBe(true);
    expect(status.v1_base_url).toBeNull();
    expect(status.issues.join(" ")).toContain("REMOTE_API_CONFIG_MISSING");
    expect(sqliteFilesUnder(home)).toEqual([]);
  });

  test("the unhosted opt-in serves sqlite WITHOUT reading the Keychain or disk", () => {
    // The isolation guarantee, asserted rather than assumed: a resolvable
    // credential exists in both stores and neither is touched.
    const home = tempHome("opt-in");
    writeCredentialsFile(home, `HASNA_TODOS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.todos.api-key": KEYCHAIN_KEY });

    const resolution = resolveTodosCliTransport(
      { HOME: home, HASNA_TODOS_LOCAL: "1" },
      keychain.options,
    );
    expect(resolution).toEqual({
      transport: "sqlite",
      selected: false,
      source: "local-opt-in",
      authority: null,
    });
    expect(keychain.calls).toEqual([]);
  });

  test("a configured environment outranks the opt-in", () => {
    const home = tempHome("opt-in-outranked");
    const keychain = fakeKeychain({});
    const resolution = resolveTodosCliTransport(
      { HOME: home, HASNA_TODOS_LOCAL: "1", HASNA_TODOS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(resolution.transport).toBe("http");
    expect(resolution.authority!.apiKeyTier).toBe("env");
  });
});
