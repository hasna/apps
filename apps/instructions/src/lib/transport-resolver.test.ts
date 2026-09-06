/**
 * The credential tiers, exercised through the instructions resolver seam.
 *
 * `config-store.test.ts` covers the ENV tier with caller-built dictionaries;
 * this file covers the tiers an env dictionary cannot express — the macOS
 * Keychain and `~/.hasna/instructions/config/credentials` — plus the
 * fail-closed arm, where the assertion is not only the error but that NO SQLite
 * file was created anywhere under the run's home.
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
import { getInstructionsTransportStatus, resolveInstructionsClientTransport, type InstructionsResolverOptions } from "./transport-resolver.js";
import { resolveConfigStore } from "../data/config-store.js";
import { instructionsResolverInputs } from "./local-opt-in.js";
import type { InstructionsClientEnv } from "./client-types.js";

const KEYCHAIN_KEY = "fixture-keychain-key";
const DISK_KEY = "fixture-disk-key";
const ENV_KEY = "fixture-env-key";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `inst-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

/** Write the credential file the resolver reads, at the mode it demands. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ".hasna", "instructions", "config", "credentials");
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
  const credentials = {
    keychain: {
      platform: "darwin",
      run: (argv: readonly string[]): KeychainCommandResult => {
        calls.push([...argv]);
        const service = argv[argv.indexOf("-s") + 1] ?? "";
        const value = items[service];
        if (value === undefined) return { status: 44, stdout: "", stderr: "" };
        return { status: 0, stdout: `${value}\n`, stderr: "" };
      },
    },
  };
  return { calls, options: { credentials } as InstructionsResolverOptions };
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

/** Empty-env helper is unused now; the tests build envs inline. */

describe("tier 3 — the macOS Keychain", () => {
  test("an api-key item alone resolves the fleet gateway", () => {
    const keychain = fakeKeychain({ "hasna.credentials.instructions.api-key": KEYCHAIN_KEY });
    const resolution = resolveInstructionsClientTransport({ HOME: tempHome("kc-only") }, keychain.options);

    expect(resolution.baseUrl).toBe("https://api.hasna.com/instructions/v1");
    expect(resolution.apiUrlSource).toBe("default");
    expect(resolution.apiKeyTier).toBe("keychain");
    // The SOURCE is reported, never the value.
    expect(resolution.apiKeySource).toMatch(/^keychain:hasna\.credentials\.instructions\.api-key@/);
    expect(JSON.stringify(resolution)).not.toContain(KEYCHAIN_KEY);
  });

  test("the api-url item beside it selects the authority", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.instructions.api-key": KEYCHAIN_KEY,
      "hasna.credentials.instructions.api-url": "https://instructions.station.example",
    });
    const status = getInstructionsTransportStatus({ HOME: tempHome("kc-url") }, keychain.options);

    expect(status.ok).toBe(true);
    expect(status.v1_base_url).toBe("https://instructions.station.example/v1");
    expect(status.api_url_configured).toBe(true);
    expect(status.api_url_source).toMatch(/^keychain:hasna\.credentials\.instructions\.api-url@/);
    expect(status.api_key_tier).toBe("keychain");
    expect(status.local_fallback).toBe(false);
  });

  test("the Keychain outranks the environment, because it is re-read per call", () => {
    const keychain = fakeKeychain({ "hasna.credentials.instructions.api-key": KEYCHAIN_KEY });
    const resolution = resolveInstructionsClientTransport(
      { HOME: tempHome("kc-beats-env"), HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(resolution.apiKeyTier).toBe("keychain");
    // Sources that disagree are reported, so a half-finished rotation is
    // visible instead of surfacing later as an unexplained 401.
    expect(resolution.warning).toMatch(/disagree/);
  });

  test("a missing item is an absent tier, not a failure — the next tier decides", () => {
    const keychain = fakeKeychain({});
    const resolution = resolveInstructionsClientTransport(
      { HOME: tempHome("kc-missing"), HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(resolution.apiKeyTier).toBe("env");
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("an item that exists but cannot be READ is terminal, never resolved around", () => {
    // The dangerous shape: a locked keychain answering non-zero. Falling
    // through to the environment here would silently act as a different
    // principal than the machine's own item names.
    const run = (): KeychainCommandResult => ({ status: 51, stdout: "", stderr: "User interaction is not allowed." });
    expect(() =>
      resolveInstructionsClientTransport(
        { HOME: tempHome("kc-locked"), HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
        { credentials: { keychain: { platform: "darwin", run } } },
      ),
    ).toThrow(/REMOTE_API_CREDENTIAL_INVALID/);
  });

  test("the tier does not exist off darwin", () => {
    const keychain = fakeKeychain({ "hasna.credentials.instructions.api-key": KEYCHAIN_KEY });
    const credentials = keychain.options.credentials!;
    expect(() =>
      resolveInstructionsClientTransport(
        { HOME: tempHome("kc-linux") },
        { credentials: { ...credentials, keychain: { ...credentials.keychain, platform: "linux" } } },
      ),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(keychain.calls).toEqual([]);
  });
});

describe("tier 4 — ~/.hasna/instructions/config/credentials", () => {
  test("a credentials file supplies both the key and the authority", () => {
    const home = tempHome("disk");
    const file = writeCredentialsFile(
      home,
      `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\nHASNA_INSTRUCTIONS_API_URL=https://instructions.disk.example\n`,
    );
    const status = getInstructionsTransportStatus({ HOME: home });

    expect(status.ok).toBe(true);
    expect(status.v1_base_url).toBe("https://instructions.disk.example/v1");
    expect(status.api_key_tier).toBe("disk");
    expect(status.api_key_source).toBe(file);
    expect(status.api_url_configured).toBe(true);
  });

  test("HASNA_HOME moves the root, and XDG is never consulted", () => {
    const home = tempHome("disk-home");
    const hasnaHome = tempHome("disk-hasna-home");
    // The credential lives ONLY under HASNA_HOME. A resolver that still read
    // ~/.hasna, or $XDG_CONFIG_HOME/hasna, would find nothing here and fail.
    const file = join(hasnaHome, "instructions", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);

    const resolution = resolveInstructionsClientTransport({
      HOME: home,
      HASNA_HOME: hasnaHome,
      XDG_CONFIG_HOME: join(home, "xdg-must-not-be-read"),
    });
    expect(resolution.apiKeyTier).toBe("disk");
    expect(resolution.apiKeySource).toBe(file);
  });

  test("disk outranks the environment so a rotation heals an old shell", () => {
    const home = tempHome("disk-beats-env");
    writeCredentialsFile(home, `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\n`);
    const resolution = resolveInstructionsClientTransport({ HOME: home, HASNA_INSTRUCTIONS_API_KEY: ENV_KEY });
    expect(resolution.apiKeyTier).toBe("disk");
  });

  test("a world-readable credentials file is refused, not silently skipped", () => {
    const home = tempHome("disk-mode");
    writeCredentialsFile(home, `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\n`, 0o644);
    expect(() => resolveInstructionsClientTransport({ HOME: home, HASNA_INSTRUCTIONS_API_KEY: ENV_KEY })).toThrow(
      /REMOTE_API_CREDENTIAL_INVALID/,
    );
  });

  test("no file is an absent tier — the environment still decides", () => {
    const resolution = resolveInstructionsClientTransport({ HOME: tempHome("disk-absent"), HASNA_INSTRUCTIONS_API_KEY: ENV_KEY });
    expect(resolution.apiKeyTier).toBe("env");
  });
});

describe("tier 5 — the environment", () => {
  test("the canonical key reaches the fleet gateway", () => {
    const resolution = resolveInstructionsClientTransport({ HOME: tempHome("env-can"), HASNA_INSTRUCTIONS_API_KEY: ENV_KEY });
    expect(resolution.apiKeyTier).toBe("env");
    expect(resolution.baseUrl).toBe("https://api.hasna.com/instructions/v1");
    expect(resolution.apiKeySource).toBe("HASNA_INSTRUCTIONS_API_KEY");
  });

  test("the unprefixed alias still resolves, and the canonical name wins when both are set", () => {
    const aliased = resolveInstructionsClientTransport({ HOME: tempHome("env-alias"), INSTRUCTIONS_API_KEY: ENV_KEY });
    expect(aliased.apiKeyTier).toBe("env");
    expect(aliased.apiKeySource).toBe("INSTRUCTIONS_API_KEY");

    const both = resolveInstructionsClientTransport({
      HOME: tempHome("env-both"),
      HASNA_INSTRUCTIONS_API_KEY: ENV_KEY,
      INSTRUCTIONS_API_KEY: ENV_KEY,
    });
    expect(both.apiKeySource).toBe("HASNA_INSTRUCTIONS_API_KEY");
  });

  test("a configured URL with no key fails loud (never an unauthenticated client)", () => {
    expect(() =>
      resolveInstructionsClientTransport({ HOME: tempHome("env-url"), HASNA_INSTRUCTIONS_API_URL: "https://x" }),
    ).toThrow(/REMOTE_API_KEY_MISSING/);
  });
});

describe("tier ordering, end to end", () => {
  test("Keychain beats disk beats env, and each falls through when absent", () => {
    const home = tempHome("ordering");
    writeCredentialsFile(home, `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\n`);
    const env = { HOME: home, HASNA_INSTRUCTIONS_API_KEY: ENV_KEY };

    const withKeychain = fakeKeychain({ "hasna.credentials.instructions.api-key": KEYCHAIN_KEY });
    expect(resolveInstructionsClientTransport(env, withKeychain.options).apiKeyTier).toBe("keychain");

    const withoutKeychain = fakeKeychain({});
    expect(resolveInstructionsClientTransport(env, withoutKeychain.options).apiKeyTier).toBe("disk");

    rmSync(join(home, ".hasna", "instructions", "config", "credentials"));
    expect(resolveInstructionsClientTransport(env, withoutKeychain.options).apiKeyTier).toBe("env");
  });

  test("an explicit credentials.apiKey argument is tier 1 and never falls through", () => {
    const home = tempHome("explicit");
    writeCredentialsFile(home, `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.instructions.api-key": KEYCHAIN_KEY });
    const resolution = resolveInstructionsClientTransport(
      { HOME: home, HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
      { credentials: { ...keychain.options.credentials, apiKey: "fixture-explicit-key" } },
    );
    expect(resolution.apiKeyTier).toBe("argument");
  });
});

describe("normalising blanks never loses the ambient Keychain gate (#1788)", () => {
  test("declared-but-blank authority variables are removed, not refused", () => {
    const env = {
      HOME: tempHome("blanks"),
      HASNA_INSTRUCTIONS_API_KEY: ENV_KEY,
      INSTRUCTIONS_API_URL: "",
    };
    const resolution = resolveInstructionsClientTransport(env);
    expect(resolution.apiKeyTier).toBe("env");
    expect(resolution.baseUrl).toBe("https://api.hasna.com/instructions/v1");
  });

  test("no blanks: the env object passes through by identity", () => {
    const env = { HOME: tempHome("identity"), HASNA_INSTRUCTIONS_API_KEY: ENV_KEY };
    const inputs = instructionsResolverInputs(env);
    expect(inputs.env).toBe(env);
    expect(inputs.credentials.keychain?.enabled).toBeUndefined();
  });

  test("blanks removed from an ambient-marked env carry the Keychain gate across the copy", () => {
    const env: InstructionsClientEnv = {
      HOME: tempHome("gate"),
      HASNA_INSTRUCTIONS_API_KEY: ENV_KEY,
      INSTRUCTIONS_API_URL: "",
    };
    // The same registry symbol @hasna/contracts stamps on its own snapshot of
    // the live process environment.
    (env as unknown as Record<symbol, unknown>)[Symbol.for("hasna:contracts:ambientClientEnvironment")] = true;
    const inputs = instructionsResolverInputs(env);
    expect(inputs.env).not.toBe(env); // a copy was necessary
    expect(inputs.credentials.keychain?.enabled).toBe(true); // the gate travelled
    // And the copy actually resolves the Keychain.
    const keychain = fakeKeychain({ "hasna.credentials.instructions.api-key": KEYCHAIN_KEY });
    const credentials = keychain.options.credentials!;
    const resolution = resolveInstructionsClientTransport(
      inputs.env,
      { credentials: { ...credentials, keychain: { ...credentials.keychain, enabled: true } } },
    );
    expect(resolution.apiKeyTier).toBe("keychain");
  });
});

describe("retired locations and switches are never inputs", () => {
  test("XDG_CONFIG_HOME, fleet-env and cloud dirs are not read", () => {
    const home = tempHome("retired");
    mkdirSync(join(home, ".config", "hasna", "instructions"), { recursive: true });
    mkdirSync(join(home, ".hasna", "fleet-env"), { recursive: true });
    mkdirSync(join(home, ".hasna", "cloud"), { recursive: true });
    writeFileSync(join(home, ".config", "hasna", "credentials"), `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\n`);
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
    expect(() => resolveInstructionsClientTransport(env)).toThrow(/REMOTE_API_CONFIG_MISSING/);
  });

  test("a ~/.instructions/config.json key store is not read either", () => {
    const home = tempHome("config-json");
    mkdirSync(join(home, ".instructions"), { recursive: true });
    writeFileSync(join(home, ".instructions", "config.json"), `{"apiKey":"${DISK_KEY}"}\n`);
    expect(() => resolveInstructionsClientTransport({ HOME: home })).toThrow(/REMOTE_API_CONFIG_MISSING/);
  });

  test("*_MODE / *_STORAGE_MODE switches are ignored (the transport is what RESOLVES)", () => {
    const resolution = resolveInstructionsClientTransport({
      HOME: tempHome("mode"),
      HASNA_INSTRUCTIONS_API_KEY: ENV_KEY,
      HASNA_INSTRUCTIONS_STORAGE_MODE: "cloud",
      INSTRUCTIONS_MODE: "cloud",
    });
    expect(resolution.apiKeyTier).toBe("env");
  });
});

describe("transport report", () => {
  test("the unhosted opt-in is reported as local with no fallback event", () => {
    const status = getInstructionsTransportStatus({ HOME: tempHome("report-local"), HASNA_INSTRUCTIONS_LOCAL: "1" });
    expect(status).toEqual({
      selected: false,
      ok: true,
      transport: "local",
      api_url_configured: false,
      api_key_configured: false,
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
      v1_base_url: null,
      issues: [],
      local_fallback: false,
    });
  });

  test("a hosted resolution reports every source, never a value", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.instructions.api-key": KEYCHAIN_KEY,
      "hasna.credentials.instructions.api-url": "https://instructions.report.example",
    });
    const status = getInstructionsTransportStatus({ HOME: tempHome("report-http") }, keychain.options);
    expect(status.transport).toBe("http");
    expect(status.ok).toBe(true);
    expect(status.v1_base_url).toBe("https://instructions.report.example/v1");
    expect(status.api_key_tier).toBe("keychain");
    expect(JSON.stringify(status)).not.toContain(KEYCHAIN_KEY);
    expect(status.local_fallback).toBe(false);
  });

  test("a refused configuration is reported as data, and still has no fallback", () => {
    const status = getInstructionsTransportStatus({ HOME: tempHome("report-invalid"), HASNA_INSTRUCTIONS_API_URL: "https://x" });
    expect(status.ok).toBe(false);
    expect(status.selected).toBe(true);
    expect(status.transport).toBe("invalid");
    expect(status.api_url_configured).toBe(true);
    expect(status.api_key_configured).toBe(false);
    expect(status.v1_base_url).toBeNull();
    expect(status.issues.join(" ")).toContain("REMOTE_API_KEY_MISSING");
    expect(status.local_fallback).toBe(false);
  });
});

describe("nothing resolves — fail closed, and leave no store behind", () => {
  test("an empty home throws, builds no client, and creates no database", () => {
    const home = tempHome("fail-closed");
    const keychain = fakeKeychain({});

    expect(() => resolveInstructionsClientTransport({ HOME: home }, keychain.options)).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() => resolveConfigStore({ HOME: home }, keychain.options)).toThrow(/REMOTE_API_CONFIG_MISSING/);

    // The seam throws before anything can open SQLite: no store file, no app
    // directory conjured as a side effect of failing, and no ~/.instructions
    // config.json key store either.
    expect(sqliteFilesUnder(home)).toEqual([]);
    expect(existsSync(join(home, ".hasna", "instructions", "instructions.db"))).toBe(false);
    expect(existsSync(join(home, ".instructions"))).toBe(false);
  });

  test("the status surface reports the same refusal instead of throwing", () => {
    const status = getInstructionsTransportStatus({ HOME: tempHome("fail-closed-status") }, fakeKeychain({}).options);
    expect(status.ok).toBe(false);
    expect(status.selected).toBe(true);
    expect(status.v1_base_url).toBeNull();
    expect(status.issues.join(" ")).toContain("REMOTE_API_CONFIG_MISSING");
    expect(status.local_fallback).toBe(false);
  });

  test("the unhosted opt-in serves sqlite WITHOUT reading the Keychain or disk", () => {
    // The isolation guarantee, asserted rather than assumed: a resolvable
    // credential exists on disk and in the Keychain, and neither is touched —
    // the opt-in is answered from the env dictionary alone, before the
    // resolver runs.
    const home = tempHome("opt-in");
    writeCredentialsFile(home, `HASNA_INSTRUCTIONS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.instructions.api-key": KEYCHAIN_KEY });

    const store = resolveConfigStore({ HOME: home, HASNA_INSTRUCTIONS_LOCAL: "1" }, keychain.options);
    expect(store.mode).toBe("local");
    expect(keychain.calls).toEqual([]);
  });

  test("a configured environment outranks the opt-in", () => {
    const home = tempHome("opt-in-outranked");
    const keychain = fakeKeychain({});
    const store = resolveConfigStore(
      { HOME: home, HASNA_INSTRUCTIONS_LOCAL: "1", HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(store.mode).toBe("api");
    expect((store as { v1BaseUrl: string }).v1BaseUrl).toBe("https://api.hasna.com/instructions/v1");
  });
});