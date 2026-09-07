/**
 * The five credential tiers, exercised through the hooks transport seam, plus
 * the strict-pair and fail-closed arms the 2026-09-04 adoption ruling
 * (hasna/apps#1720) binds.
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
 * Every credential value here is a fixture string. The seam never logs a
 * value, and neither does this file: assertions are on the SOURCE (an
 * env key NAME, a Keychain reference, a path) and on observable routing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import type { CredentialChainOptions } from "@hasna/contracts/client";
import type { HooksCredentialOptions } from "./resolver-types.js";
import {
  __resetHooksLocalNotice,
  hooksRegistryOrigin,
  resolveHooksServePublishKey,
  resolveHooksTransport,
} from "./transport.js";
import { syncHooks } from "./sync.js";
import { closeDb, getDb } from "../db/index.js";
import { getHookRecord, readLock } from "./store.js";

// Compile-time conformance (hasna/apps#1782): the locally-spelled published
// types must stay structurally interchangeable with the resolver's own, both
// directions — the hooks seam hands a HooksCredentialOptions to
// resolveClientTransport and surfaces the resolver's resolution back out.
const conformanceResolverToHooks: HooksCredentialOptions = {} as CredentialChainOptions;
const conformanceHooksToResolver: CredentialChainOptions = {} as HooksCredentialOptions;
void conformanceResolverToHooks;
void conformanceHooksToResolver;

const KEYCHAIN_KEY = "fixture-keychain-key";
const DISK_KEY = "fixture-disk-key";
const ENV_KEY = "fixture-env-key";

/** The credential file the resolver reads: `~/.hasna/hooks/config/credentials`. */
const CREDENTIALS_FILE_SEGMENTS = [".hasna", "hooks", "config", "credentials"] as const;

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  __resetHooksLocalNotice();
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `hooks-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

/** Write the credential file the resolver reads, at the mode it demands. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ...CREDENTIALS_FILE_SEGMENTS);
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
  test("an api-key item alone resolves the default fleet gateway", () => {
    const keychain = fakeKeychain({ "hasna.credentials.hooks.api-key": KEYCHAIN_KEY });
    const resolution = resolveHooksTransport({ HOME: tempHome("kc-only") }, keychain.options);

    expect(resolution.mode).toBe("remote");
    expect(resolution.authority).toMatchObject({
      origin: "https://api.hasna.com/hooks",
      v1BaseUrl: "https://api.hasna.com/hooks/v1",
      apiKeyTier: "keychain",
    });
    // The SOURCE is reported, never the value: the key value appears nowhere
    // in the transport report's source fields.
    expect(resolution.authority!.apiKeySource).toMatch(/^keychain:hasna\.credentials\.hooks\.api-key@/);
    expect(resolution.source).toContain("keychain");
    const reportJson = {
      ...resolution,
      authority: { ...resolution.authority, apiKey: undefined },
    };
    expect(JSON.stringify(reportJson)).not.toContain(KEYCHAIN_KEY);
  });

  test("the api-url item beside it selects the authority", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.hooks.api-key": KEYCHAIN_KEY,
      "hasna.credentials.hooks.api-url": "https://hooks.station.example",
    });
    const resolution = resolveHooksTransport({ HOME: tempHome("kc-url") }, keychain.options);

    expect(resolution.mode).toBe("remote");
    expect(resolution.authority).toMatchObject({
      origin: "https://hooks.station.example",
    });
    expect(resolution.authority!.apiUrlSource).toMatch(/^keychain:hasna\.credentials\.hooks\.api-url@/);
    expect(resolution.authority!.apiKeyTier).toBe("keychain");
  });

  test("a missing item is an absent tier, not a failure — the next tier decides", () => {
    const home = tempHome("kc-missing");
    const keychain = fakeKeychain({});
    const resolution = resolveHooksTransport(
      { HOME: home, HASNA_HOOKS_API_KEY: ENV_KEY },
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
      resolveHooksTransport(
        { HOME: home, HASNA_HOOKS_API_KEY: ENV_KEY },
        { credentials: { keychain: { platform: "darwin", run } } },
      ),
    ).toThrow(/REMOTE_API_CREDENTIAL_INVALID/);
  });

  test("the tier does not exist off darwin", () => {
    const home = tempHome("kc-linux");
    const keychain = fakeKeychain({ "hasna.credentials.hooks.api-key": KEYCHAIN_KEY });
    expect(() =>
      resolveHooksTransport(
        { HOME: home },
        { credentials: { keychain: { ...keychain.options.credentials.keychain, platform: "linux" } } },
      ),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(keychain.calls).toEqual([]);
  });
});

describe("tier 4 — ~/.hasna/hooks/config/credentials", () => {
  test("a credentials file supplies both the key and the authority", () => {
    const home = tempHome("disk");
    const file = writeCredentialsFile(
      home,
      `HASNA_HOOKS_API_KEY=${DISK_KEY}\nHASNA_HOOKS_API_URL=https://hooks.disk.example\n`,
    );
    const resolution = resolveHooksTransport({ HOME: home });

    expect(resolution.mode).toBe("remote");
    expect(resolution.authority).toMatchObject({
      origin: "https://hooks.disk.example",
      apiKeyTier: "disk",
      apiKeySource: file,
    });
  });

  test("HASNA_HOME moves the root, and XDG is never consulted", () => {
    const home = tempHome("disk-home");
    const hasnaHome = tempHome("disk-hasna-home");
    // The credential lives ONLY under HASNA_HOME. A resolver that still read
    // ~/.hasna, or $XDG_CONFIG_HOME/hasna, would find nothing here and fail.
    const file = join(hasnaHome, "hooks", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `HASNA_HOOKS_API_KEY=${DISK_KEY}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);

    const resolution = resolveHooksTransport({
      HOME: home,
      HASNA_HOME: hasnaHome,
      XDG_CONFIG_HOME: join(home, "xdg-must-not-be-read"),
    });
    expect(resolution.authority).toMatchObject({ apiKeyTier: "disk", apiKeySource: file });
  });

  test("disk outranks the environment so a rotation heals an old shell", () => {
    const home = tempHome("disk-beats-env");
    writeCredentialsFile(home, `HASNA_HOOKS_API_KEY=${DISK_KEY}\n`);
    const resolution = resolveHooksTransport({ HOME: home, HASNA_HOOKS_API_KEY: ENV_KEY });
    expect(resolution.authority!.apiKeyTier).toBe("disk");
  });

  test("a world-readable credentials file is refused, not silently skipped", () => {
    const home = tempHome("disk-mode");
    writeCredentialsFile(home, `HASNA_HOOKS_API_KEY=${DISK_KEY}\n`, 0o644);
    expect(() => resolveHooksTransport({ HOME: home, HASNA_HOOKS_API_KEY: ENV_KEY })).toThrow(
      /REMOTE_API_CREDENTIAL_INVALID/,
    );
  });

  test("no file is an absent tier — the environment still decides", () => {
    const home = tempHome("disk-absent");
    const resolution = resolveHooksTransport({ HOME: home, HASNA_HOOKS_API_KEY: ENV_KEY });
    expect(resolution.authority!.apiKeyTier).toBe("env");
  });
});

describe("tier ordering, end to end", () => {
  test("Keychain beats disk beats env, and each falls through when absent", () => {
    const home = tempHome("ordering");
    writeCredentialsFile(home, `HASNA_HOOKS_API_KEY=${DISK_KEY}\n`);
    const env = { HOME: home, HASNA_HOOKS_API_KEY: ENV_KEY };

    const withKeychain = fakeKeychain({ "hasna.credentials.hooks.api-key": KEYCHAIN_KEY });
    expect(resolveHooksTransport(env, withKeychain.options).authority!.apiKeyTier).toBe("keychain");

    const withoutKeychain = fakeKeychain({});
    expect(resolveHooksTransport(env, withoutKeychain.options).authority!.apiKeyTier).toBe("disk");

    rmSync(join(home, ...CREDENTIALS_FILE_SEGMENTS));
    expect(resolveHooksTransport(env, withoutKeychain.options).authority!.apiKeyTier).toBe("env");
  });

  test("an explicit apiKey argument is tier 1 and never falls through", () => {
    const home = tempHome("explicit");
    writeCredentialsFile(home, `HASNA_HOOKS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.hooks.api-key": KEYCHAIN_KEY });
    const resolution = resolveHooksTransport(
      { HOME: home, HASNA_HOOKS_API_KEY: ENV_KEY },
      {
        credentials: {
          ...keychain.options.credentials,
          apiKey: "fixture-explicit-key",
        },
      },
    );
    expect(resolution.authority!.apiKeyTier).toBe("argument");
  });
});

describe("strict pair — a URL without a credential is a refusal", () => {
  test("HASNA_HOOKS_API_URL alone (no key anywhere) throws REMOTE_API_KEY_MISSING", () => {
    const home = tempHome("url-only");
    const keychain = fakeKeychain({});
    expect(() =>
      resolveHooksTransport({ HOME: home, HASNA_HOOKS_API_URL: "https://registry.example.com" }, keychain.options),
    ).toThrow(/REMOTE_API_KEY_MISSING/);
    // No SQLite file, no data dir, no local fallback of any shape.
    expect(sqliteFilesUnder(home)).toEqual([]);
    expect(existsSync(join(home, ".hasna", "hooks"))).toBe(false);
  });

  test("a blank HASNA_HOOKS_API_URL is normalised to absent (blank means unset) and fails closed", () => {
    const home = tempHome("url-blank");
    // At the hooks seam a declared-but-blank variable means "not configured"
    // (the normaliser removes it before the resolver sees it), so a blank URL
    // is the same refusal as no URL at all — never a half-open run.
    expect(() => resolveHooksTransport({ HOME: home, HASNA_HOOKS_API_URL: "" })).toThrow(
      /REMOTE_API_CONFIG_MISSING/,
    );
  });

  test("the legacy registry spellings no longer configure anything", () => {
    const home = tempHome("legacy-names");
    // HASNA_HOOKS_REGISTRY_URL / HOOKS_REGISTRY_URL and config.json api_url
    // used to select the remote registry; the resolver does not read them, so
    // they configure nothing and the run fails closed like any unconfigured
    // environment.
    expect(() =>
      resolveHooksTransport({ HOME: home, HASNA_HOOKS_REGISTRY_URL: "https://registry.example.com" }),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() =>
      resolveHooksTransport({ HOME: home, HOOKS_REGISTRY_URL: "https://registry.example.com" }),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
  });
});

describe("nothing resolves — fail closed, and leave no store behind", () => {
  test("an empty home throws and creates no database", () => {
    const home = tempHome("fail-closed");
    const keychain = fakeKeychain({});

    expect(() => resolveHooksTransport({ HOME: home }, keychain.options)).toThrow(
      /REMOTE_API_CONFIG_MISSING/,
    );
    expect(resolveHooksServePublishKey({ HOME: home }, keychain.options)).toBeUndefined();

    // The seam throws before anything can open SQLite: no store file, and no
    // app directory conjured as a side effect of failing.
    expect(sqliteFilesUnder(home)).toEqual([]);
    expect(existsSync(join(home, ".hasna", "hooks", "hooks.db"))).toBe(false);
    expect(existsSync(join(home, ".hooks"))).toBe(false);
  });

  test("syncHooks with no credential fails closed before any store access", async () => {
    const home = tempHome("sync-fail-closed");
    process.env.HASNA_HOOKS_DATA_DIR = join(home, "data");
    process.env.HASNA_HOOKS_DB_PATH = ":memory:";
    try {
      await expect(syncHooks({ env: { HOME: home, HASNA_HOOKS_API_URL: "https://registry.example.com" } }))
        .rejects.toThrow(/REMOTE_API_KEY_MISSING/);
      expect(sqliteFilesUnder(home)).toEqual([]);
      expect(existsSync(join(home, "data"))).toBe(false);
    } finally {
      delete process.env.HASNA_HOOKS_DATA_DIR;
      delete process.env.HASNA_HOOKS_DB_PATH;
      closeDb();
    }
  });

  test("the unhosted opt-in serves local WITHOUT reading the Keychain or disk", () => {
    // The isolation guarantee, asserted rather than assumed: a resolvable
    // credential exists in both stores and neither is touched.
    const home = tempHome("opt-in");
    writeCredentialsFile(home, `HASNA_HOOKS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.hooks.api-key": KEYCHAIN_KEY });

    const notices: string[] = [];
    const resolution = resolveHooksTransport(
      { HOME: home, HASNA_HOOKS_LOCAL: "1" },
      { ...keychain.options, notice: (line) => notices.push(line) },
    );
    expect(resolution).toEqual({ mode: "local", source: "local-opt-in", authority: null });
    expect(keychain.calls).toEqual([]);
    // Local mode SAYS so, on stderr, exactly once per process.
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/LOCAL mode/);
  });

  test("a configured environment outranks the opt-in", () => {
    const home = tempHome("opt-in-outranked");
    const keychain = fakeKeychain({});
    const resolution = resolveHooksTransport(
      { HOME: home, HASNA_HOOKS_LOCAL: "1", HASNA_HOOKS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(resolution.mode).toBe("remote");
    expect(resolution.authority!.apiKeyTier).toBe("env");
  });
});

describe("transport report", () => {
  test("the report names the sources, never the values, and maps /v1 to the registry origin", () => {
    const home = tempHome("report");
    const resolution = resolveHooksTransport({
      HOME: home,
      HASNA_HOOKS_API_URL: "https://registry.example.com",
      HASNA_HOOKS_API_KEY: ENV_KEY,
    });
    expect(resolution.mode).toBe("remote");
    expect(resolution.source).toBe("HASNA_HOOKS_API_KEY+HASNA_HOOKS_API_URL");
    expect(resolution.authority).toMatchObject({
      origin: "https://registry.example.com",
      v1BaseUrl: "https://registry.example.com/v1",
      apiUrlSource: "HASNA_HOOKS_API_URL",
      apiKeySource: "HASNA_HOOKS_API_KEY",
      apiKeyTier: "env",
    });
    expect(hooksRegistryOrigin("https://registry.example.com/v1")).toBe("https://registry.example.com");
    expect(hooksRegistryOrigin("https://registry.example.com/api/v1")).toBe("https://registry.example.com/api");
    const { apiKey, ...report } = resolution.authority!;
    expect(JSON.stringify(report)).not.toContain(ENV_KEY);
  });

  test("syncHooks sends the resolved key to the registry it resolved with (pin to authority)", async () => {
    const home = tempHome("report-sync");
    process.env.HASNA_HOOKS_DATA_DIR = join(home, "data");
    process.env.HASNA_HOOKS_DB_PATH = ":memory:";
    const sha = createHash("sha256").update("console.log('x');\n").digest("hex");
    let sawKey: string | null = null;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        sawKey = req.headers.get("x-api-key");
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "pair-demo", version: "1.0.0", sha256: sha }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({ hooks: { "pair-demo": { version: "1.0.0", sha256: sha, source: "remote" } } });
        }
        if (url.pathname === "/api/v1/hooks/pair-demo/1.0.0") {
          return Response.json({
            manifest: { name: "pair-demo", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" },
            script: "console.log('x');\n",
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const plan = await syncHooks({
        env: {
          HOME: home,
          HASNA_HOOKS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_HOOKS_API_KEY: ENV_KEY,
        },
      });
      expect(plan.apiUrl).toBe(`http://127.0.0.1:${server.port}`);
      expect(plan.diff.added).toContain("pair-demo");
      expect(readLock().hooks["pair-demo"]?.version).toBe("1.0.0");
      expect(sawKey === ENV_KEY).toBe(true);
      // The DB record carries the authority it was resolved with.
      expect(getHookRecord(getDb(), "pair-demo")?.source_ref).toBe(`http://127.0.0.1:${server.port}`);
      // The artifact was written into the pinned data root (DB is :memory:).
      expect(existsSync(join(home, "data", "hooks", "pair-demo", "script.ts"))).toBe(true);
    } finally {
      server.stop(true);
      delete process.env.HASNA_HOOKS_DATA_DIR;
      delete process.env.HASNA_HOOKS_DB_PATH;
      closeDb();
    }
  });
});