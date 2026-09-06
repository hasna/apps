// Hermetic credential-resolution coverage for the shared @hasna/contracts chain.
//
// Since the 2026-09-04 adoption (hasna/apps#1720) conversations resolves its
// credential and its service authority through the ONE resolver in
// `@hasna/contracts/client`, fresh on every call. These tests prove the app's
// seam reaches each tier — env, disk (`~/.hasna/conversations/config/credentials`),
// and the macOS Keychain (via an injected `security` runner) — with a fake
// HOME/HASNA_HOME so no machine state can leak in and no request is ever made
// against a real service.
//
// NO VALUE IS REAL. Every key below is a syntactically plausible stub; the only
// assertions about values are "the transport sent this exact header", which is
// the point of the freshness case.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConversationsStoreConfigError,
  getStore,
  resolveConversationsCloud,
} from "./index.js";
import type { KeychainCommandResult } from "@hasna/contracts/client";

const APP = "conversations";
const URL_VAR = "HASNA_CONVERSATIONS_API_URL";
const KEY_VAR = "HASNA_CONVERSATIONS_API_KEY";
const STATION_VAR = "HASNA_STATION";

const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");
const DISK_KEY = "hasna_conversations_disk_tier_key_00000000";
const KEYCHAIN_KEY = "hasna_conversations_keychain_tier_key_00000000";
const API_URL = "https://conversations.hasna.xyz";
const GATEWAY_V1 = "https://api.hasna.com/conversations/v1";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function sandboxHome(): string {
  const root = mkdtempSync(join(tmpdir(), "conversations-credential-resolution-"));
  tempRoots.push(root);
  return root;
}

/** Write `~/.hasna/conversations/config/credentials` (owner-only) in `home`. */
function writeCredentialFile(home: string, key: string): string {
  const dir = join(home, ".hasna", "conversations", "config");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "credentials");
  writeFileSync(path, `HASNA_CONVERSATIONS_API_KEY=${key}\n`);
  chmodSync(path, 0o600);
  return path;
}

/** Write the HASNA_HOME variant: `$HASNA_HOME/conversations/config/credentials`. */
function writeCredentialFileHASNAHome(home: string, key: string): string {
  const dir = join(home, "conversations", "config");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "credentials");
  writeFileSync(path, `HASNA_CONVERSATIONS_API_KEY=${key}\n`);
  chmodSync(path, 0o600);
  return path;
}

/**
 * A `security` runner that answers `find-generic-password … -w` for the
 * credential item, and reports item-not-found (exit 44) for the api-url item.
 */
function keychainRunner(stdout: string): (argv: readonly string[]) => KeychainCommandResult {
  return (argv) => {
    expect(argv[0]).toBe("find-generic-password");
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    expect(service).toMatch(/^hasna\.credentials\.conversations\.(?:api-key|api-url)$/);
    if (service.endsWith(".api-url")) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout, stderr: "" };
  };
}

describe("credential resolution — the shared chain, reached through the app seam", () => {
  test("env tier: URL + HASNA_CONVERSATIONS_API_KEY selects the hosted API", () => {
    const env = { [URL_VAR]: API_URL, [KEY_VAR]: FAKE_KEY };
    const client = resolveConversationsCloud(env);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe(`${API_URL}/v1`);
    expect(getStore(env).transport).toBe("cloud-http");
  });

  test("gateway default: a key alone resolves hosted at https://api.hasna.com/<app>/v1", () => {
    // (Owner directive 2026-09-04, hasna/apps#1720): URLs never need
    // configuring — a key from any tier is enough to reach the fleet.
    const env = { [KEY_VAR]: FAKE_KEY };
    const client = resolveConversationsCloud(env);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe(GATEWAY_V1);
  });

  test("disk tier: a credential file under HOME (the ~/.hasna shape) supplies the key", () => {
    const home = sandboxHome();
    const credentialPath = writeCredentialFile(home, DISK_KEY);
    const env = {
      [URL_VAR]: API_URL,
      HOME: home,
    };
    const client = resolveConversationsCloud(env);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe(`${API_URL}/v1`);
    expect(credentialPath).toContain(".hasna");
  });

  test("disk tier: HASNA_HOME moves the root, and the file is read from there", () => {
    // HASNA_HOME IS the hasna home (no `.hasna` segment is added), so the file
    // lives at `$HASNA_HOME/conversations/config/credentials`.
    const home = sandboxHome();
    const credentialPath = writeCredentialFileHASNAHome(home, DISK_KEY);
    const env = {
      [URL_VAR]: API_URL,
      HASNA_HOME: home,
    };
    const client = resolveConversationsCloud(env);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe(`${API_URL}/v1`);
    // HASNA_HOME IS the hasna home, so the path has no extra `.hasna` segment.
    expect(credentialPath).toBe(join(home, "conversations", "config", "credentials"));
  });

  test("disk tier is refused loudly when the credential file is unsafe (not owner-only)", () => {
    const home = sandboxHome();
    const dir = join(home, ".hasna", "conversations", "config");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "credentials");
    writeFileSync(path, `HASNA_CONVERSATIONS_API_KEY=${DISK_KEY}\n`);
    chmodSync(path, 0o644); // world-readable: refused
    const env = { [URL_VAR]: API_URL, HOME: home };

    expect(() => resolveConversationsCloud(env)).toThrow(ConversationsStoreConfigError);
    expect(() => resolveConversationsCloud(env)).toThrow(/unsafe credential\/config file/i);
    expect(() => resolveConversationsCloud(env)).toThrow(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("Keychain tier: an injected security runner supplies the key", () => {
    const env = {
      [URL_VAR]: API_URL,
      [STATION_VAR]: "test-station",
      USER: "hasna",
    };
    const runner = keychainRunner(KEYCHAIN_KEY);
    const client = resolveConversationsCloud(env, {
      credentials: { keychain: { run: runner, enabled: true, platform: "darwin" } },
    });
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe(`${API_URL}/v1`);
  });

  test("Keychain tier is off for a caller-built env unless explicitly enabled (#1788)", () => {
    // The hermetic seam: a caller-built env is the whole world, and the
    // machine's Keychain is outside it. With `enabled: false` the runner must
    // never fire — no credential resolves, so the resolution refuses (fail
    // loud) rather than reaching for a store the caller did not name.
    const env = { [URL_VAR]: API_URL };
    let invoked = 0;
    const runner = (): KeychainCommandResult => {
      invoked += 1;
      return { status: 0, stdout: KEYCHAIN_KEY, stderr: "" };
    };
    expect(() =>
      resolveConversationsCloud(env, {
        credentials: { keychain: { run: runner, enabled: false, platform: "darwin" } },
      }),
    ).toThrow(ConversationsStoreConfigError);
    expect(invoked).toBe(0);
  });

  test("fail closed: a URL with no credential anywhere refuses instead of reading local", () => {
    const home = sandboxHome();
    const env = { [URL_VAR]: API_URL, HOME: home };
    expect(() => resolveConversationsCloud(env)).toThrow(ConversationsStoreConfigError);
    expect(() => resolveConversationsCloud(env)).toThrow(new RegExp(KEY_VAR));
    // And it never opens a local store (fail-loud has no side effects).
    let transport: string | null = null;
    try {
      transport = getStore(env).transport;
    } catch {
      /* expected */
    }
    expect(transport).not.toBe("local");
  });

  test("the key is re-resolved fresh on every request (a rotation heals a live client)", async () => {
    // The contracts transport takes a per-request credential provider, so a
    // long-lived client picks up a disk rotation without a rebuild. Prove it by
    // capturing the `x-api-key` header a transport sends before and after the
    // file changes.
    const home = sandboxHome();
    const credentialPath = writeCredentialFileHASNAHome(home, DISK_KEY);
    const env = { [URL_VAR]: API_URL, HASNA_HOME: home };

    const sentKeys: string[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sentKeys.push(headers.get("x-api-key") ?? "");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const client = resolveConversationsCloud(env, {
      transport: { fetchImpl, retry: false },
    })!;
    await client.transport.get("/health");
    expect(sentKeys.at(-1)).toBe(DISK_KEY);

    // Rotate the on-disk credential and issue another request on the SAME
    // client: the fresh resolution must pick up the new key.
    writeFileSync(credentialPath, `HASNA_CONVERSATIONS_API_KEY=rotated_after_rotation_key\n`);
    chmodSync(credentialPath, 0o600);
    await client.transport.get("/health");
    expect(sentKeys.at(-1)).toBe("rotated_after_rotation_key");
    expect(sentKeys.length).toBe(2);
  });
});
