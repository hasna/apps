/**
 * The shared credential tiers, exercised through the loops resolver.
 *
 * `@hasna/contracts` 1.0.2 owns the ladder — the macOS Keychain
 * (`hasna.credentials.loops.api-key` / `.api-url`), the credential file
 * `~/.hasna/loops/config/credentials`, `HASNA_LOOPS_API_KEY` in the
 * environment, and the fleet gateway default — and the loops resolver is a
 * thin reader of it. This file proves the tiers through the loops surface
 * (`resolveCloudStorage` / `getStore`), with two hermetic seams:
 *
 *   - the Keychain tier takes an INJECTABLE `security` runner
 *     (`credentials.keychain.run`), so "the item exists", "the item is
 *     missing" and "the item is unreadable" are first-class cases and the
 *     login keychain is never opened;
 *   - the disk tier is anchored on HOME and HASNA_HOME, so a temporary home is
 *     a complete hermetic filesystem for it. XDG paths are never consulted.
 *
 * Every credential value here is a fixture string. The resolver never logs a
 * value, and neither does this file: assertions are on the SOURCE
 * (`keychain:…`, an absolute path, an env key NAME) and on observable routing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import { resolveCloudStorage, type CloudStorageOptions } from "./resolve.js";
import { ApiStore, getStore } from "../store/index.js";

const KEYCHAIN_KEY = "fixture-keychain-key";
const DISK_KEY = "fixture-disk-key";
const ENV_KEY = "fixture-env-key";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `loops-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

/** Write the credential file the resolver reads, at the mode it demands. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ".hasna", "loops", "config", "credentials");
  mkdirSync(join(home, ".hasna", "loops", "config"), { recursive: true });
  writeFileSync(file, body, { mode });
  chmodSync(file, mode);
  return file;
}

/**
 * A fake `/usr/bin/security`. `items` maps a service name to its stored value;
 * anything absent answers status 44, which is how the real tool reports
 * item-not-found and how the resolver recognises an absent tier.
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

function hosted(resolution: { transport: string; client?: unknown; baseUrl?: string }) {
  if (resolution.transport !== "api") return null;
  return { ...resolution, transport: "api" as const };
}

describe("tier — the macOS Keychain", () => {
  test("an api-key item alone resolves the fleet gateway", () => {
    const keychain = fakeKeychain({ "hasna.credentials.loops.api-key": KEYCHAIN_KEY });
    const resolution = resolveCloudStorage("loops", { HOME: tempHome("kc-only") }, keychain.options);

    const api = hosted(resolution);
    expect(api).not.toBeNull();
    expect(api!.baseUrl).toBe("https://api.hasna.com/loops/v1");
    expect(JSON.stringify(resolution)).not.toContain(KEYCHAIN_KEY);
  });

  test("the api-url item beside it selects the authority", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.loops.api-key": KEYCHAIN_KEY,
      "hasna.credentials.loops.api-url": "https://loops.station.example",
    });
    const resolution = resolveCloudStorage("loops", { HOME: tempHome("kc-url") }, keychain.options);
    expect(hosted(resolution)!.baseUrl).toBe("https://loops.station.example/v1");
  });

  test("the Keychain is re-read per resolution — a rotation heals without a restart", () => {
    const home = tempHome("kc-rotation");
    const items = { "hasna.credentials.loops.api-key": "first-key" };
    const keychain = fakeKeychain(items);
    expect(
      resolveCloudStorage("loops", { HOME: home }, keychain.options),
    ).toMatchObject({ transport: "api" });

    items["hasna.credentials.loops.api-key"] = "rotated-key";
    // The long-lived MCP/SDK pattern: the same resolver inputs resolve again
    // on the next call, so a rotation is picked up without a restart.
    const resolution = resolveCloudStorage("loops", { HOME: home }, keychain.options);
    const transport = (resolution as { client: { transport: { baseUrl: string } } }).client.transport;
    expect(transport.baseUrl).toBe("https://api.hasna.com/loops/v1");
  });

  test("declared-but-blank env variables do not switch the credential off the machine's Keychain (hasna/apps#1788)", () => {
    // The regression shape: a scrubbed/partial environment carries
    // HASNA_LOOPS_API_URL="" / HASNA_LOOPS_API_KEY="" while the machine's
    // Keychain holds the identity. Blank must mean unset at the loops seam,
    // and the ambient Keychain tier must survive the normalisation.
    const keychain = fakeKeychain({ "hasna.credentials.loops.api-key": KEYCHAIN_KEY });
    const resolution = resolveCloudStorage(
      "loops",
      { HOME: tempHome("kc-blank-scrub"), HASNA_LOOPS_API_URL: "", HASNA_LOOPS_API_KEY: "" },
      keychain.options,
    );
    expect(hosted(resolution)).not.toBeNull();
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("a missing item is an absent tier, not a failure — the next tier decides", () => {
    const home = tempHome("kc-missing");
    const keychain = fakeKeychain({});
    const resolution = resolveCloudStorage(
      "loops",
      { HOME: home, HASNA_LOOPS_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(hosted(resolution)).not.toBeNull();
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("an item that exists but cannot be READ is terminal, never resolved around", () => {
    const home = tempHome("kc-locked");
    const run = (): KeychainCommandResult => ({ status: 51, stdout: "", stderr: "User interaction is not allowed." });
    expect(() =>
      resolveCloudStorage(
        "loops",
        { HOME: home, HASNA_LOOPS_API_KEY: ENV_KEY },
        { credentials: { keychain: { platform: "darwin", run } } },
      ),
    ).toThrow(/Keychain/);
  });

  test("the tier does not exist off darwin", () => {
    const home = tempHome("kc-linux");
    const keychain = fakeKeychain({ "hasna.credentials.loops.api-key": KEYCHAIN_KEY });
    expect(() =>
      resolveCloudStorage(
        "loops",
        { HOME: home },
        { credentials: { keychain: { ...keychain.options.credentials.keychain, platform: "linux" } } },
      ),
    ).toThrow(/no loops client connection is configured/);
    expect(keychain.calls).toEqual([]);
  });
});

describe("tier — ~/.hasna/loops/config/credentials", () => {
  test("a credentials file supplies both the key and the authority", () => {
    const home = tempHome("disk");
    writeCredentialsFile(
      home,
      `HASNA_LOOPS_API_KEY=${DISK_KEY}\nHASNA_LOOPS_API_URL=https://loops.disk.example\n`,
    );
    const resolution = resolveCloudStorage("loops", { HOME: home });
    expect(hosted(resolution)!.baseUrl).toBe("https://loops.disk.example/v1");
    expect(JSON.stringify(resolution)).not.toContain(DISK_KEY);
  });

  test("HASNA_HOME moves the root, and XDG is never consulted", () => {
    const home = tempHome("disk-home");
    const hasnaHome = tempHome("disk-hasna-home");
    // The credential lives ONLY under HASNA_HOME. A resolver that still read
    // ~/.hasna or $XDG_CONFIG_HOME/hasna would find nothing here and fail.
    const file = join(hasnaHome, "loops", "config", "credentials");
    mkdirSync(join(hasnaHome, "loops", "config"), { recursive: true });
    writeFileSync(file, `HASNA_LOOPS_API_KEY=${DISK_KEY}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);

    const resolution = resolveCloudStorage("loops", {
      HOME: home,
      HASNA_HOME: hasnaHome,
      XDG_CONFIG_HOME: join(home, "xdg-must-not-be-read"),
    });
    expect(hosted(resolution)).not.toBeNull();
  });

  test("disk outranks the environment so a rotation heals an old shell", () => {
    const home = tempHome("disk-beats-env");
    writeCredentialsFile(home, `HASNA_LOOPS_API_KEY=${DISK_KEY}\n`);
    const resolution = resolveCloudStorage("loops", { HOME: home, HASNA_LOOPS_API_KEY: ENV_KEY });
    expect(hosted(resolution)).not.toBeNull();
  });

  test("a world-readable credentials file is refused by the resolver, not silently skipped", () => {
    const home = tempHome("disk-mode");
    writeCredentialsFile(home, `HASNA_LOOPS_API_KEY=${DISK_KEY}\n`, 0o644);
    expect(() => resolveCloudStorage("loops", { HOME: home })).toThrow();
  });

  test("no file is an absent tier — the environment still decides", () => {
    const home = tempHome("disk-absent");
    const resolution = resolveCloudStorage("loops", { HOME: home, HASNA_LOOPS_API_KEY: ENV_KEY });
    expect(hosted(resolution)).not.toBeNull();
  });
});

describe("env tier", () => {
  test("HASNA_LOOPS_API_KEY alone resolves the fleet gateway (no URL required)", () => {
    const resolution = resolveCloudStorage("loops", { HASNA_LOOPS_API_KEY: ENV_KEY });
    expect(hosted(resolution)!.baseUrl).toBe("https://api.hasna.com/loops/v1");
  });

  test("HASNA_LOOPS_API_URL + HASNA_LOOPS_API_KEY select the explicit authority", () => {
    const resolution = resolveCloudStorage("loops", {
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: ENV_KEY,
    });
    expect(hosted(resolution)!.baseUrl).toBe("https://loops.example.test/v1");
  });
});

describe("tier ordering, end to end", () => {
  test("Keychain beats disk beats env, and each falls through when absent", () => {
    const home = tempHome("ordering");
    writeCredentialsFile(home, `HASNA_LOOPS_API_KEY=${DISK_KEY}\n`);
    const env = { HOME: home, HASNA_LOOPS_API_KEY: ENV_KEY };

    const withKeychain = fakeKeychain({ "hasna.credentials.loops.api-key": KEYCHAIN_KEY });
    expect(hosted(resolveCloudStorage("loops", env, withKeychain.options))).not.toBeNull();
    expect(withKeychain.calls.length).toBeGreaterThan(0);

    const withoutKeychain = fakeKeychain({});
    expect(hosted(resolveCloudStorage("loops", env, withoutKeychain.options))).not.toBeNull();

    rmSync(join(home, ".hasna", "loops", "config", "credentials"), { force: true });
    rmSync(join(home, ".hasna"), { recursive: true, force: true });
    expect(hosted(resolveCloudStorage("loops", env, withoutKeychain.options))).not.toBeNull();
  });
});

describe("rule checks through the client-facing surfaces", () => {
  test("getStore resolves the Keychain credential to an ApiStore", () => {
    const home = tempHome("store-kc");
    const keychain = fakeKeychain({ "hasna.credentials.loops.api-key": KEYCHAIN_KEY });
    const store = getStoreFor(home, keychain.options);
    expect(store.transport).toBe("api");
    store.close();
  });

  test("the empty home leaves no store, no database and no app directory behind", () => {
    const home = tempHome("fail-closed");
    expect(() => getStore({ HOME: home })).toThrow(/no loops client connection is configured/);
    // The seam throws before anything can open SQLite: no store file, and no
    // app directory conjured as a side effect of failing.
    expect(readdirSync(home)).toEqual([]);
    expect(existsSync(join(home, ".hasna"))).toBe(false);
  });
});

/** getStore is env-only; this helper threads the credential options into the resolver. */
function getStoreFor(home: string, options: CloudStorageOptions): ReturnType<typeof getStore> {
  const resolution = resolveCloudStorage("loops", { HOME: home }, options);
  if (resolution.transport !== "api") throw new Error("expected a hosted resolution");
  return new ApiStore(resolution.client, resolution.baseUrl);
}