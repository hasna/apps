// Hermetic tests for the @hasna/conversations/sdk resolver seam.
//
// The resolver is the @hasna/contracts client chain (hasna/apps#1720): an
// explicit argument, the Keychain, ~/.hasna/conversations/config/credentials,
// or HASNA_CONVERSATIONS_API_KEY, with the fleet gateway as the default
// authority. Every case hands the resolver a CALLER-BUILT env (so the chain's
// ambient Keychain tier is off unless a `security` runner is injected) rooted
// in a scratch HOME, so nothing touches the machine's real Keychain or
// credential files.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationsClient } from "./index.js";
import {
  ConversationsSdkResolutionError,
  createConversationsClient,
  resolveConversationsSdkTransport,
} from "./resolve.js";

type SdkEnv = Record<string, string | undefined>;

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "conversations-sdk-resolver-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function env(home: string, extra: Record<string, string> = {}): SdkEnv {
  return { HOME: home, ...extra };
}

/** Write a disk credential for the resolver's disk tier in a scratch HOME. */
function writeDiskCredential(home: string, body: string): void {
  const dir = join(home, ".hasna", "conversations", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function requestHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/** A fetch double that records the URL and the x-api-key of every request. */
function recordingFetch(seen: Array<{ url: string; apiKey: string | null }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push({ url, apiKey: requestHeaders(init)["x-api-key"] ?? null });
    return new Response(JSON.stringify({ status: "ok", version: "0.0.0-test", app: "conversations", build_sha: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** A `security` runner double: the api-key item answers, the api-url item is absent. */
function keychainRunner(reads: Array<readonly string[]>, key = "keychain-key") {
  return (argv: readonly string[]) => {
    reads.push(argv);
    const args = argv.join(" ");
    if (args.includes("api-url")) return { status: 44, stdout: "", stderr: "" };
    if (args.includes("api-key")) return { status: 0, stdout: key, stderr: "" };
    return { status: 44, stdout: "", stderr: "" };
  };
}

describe("SDK credential resolution through the @hasna/contracts chain", () => {
  test("env tier: HASNA_CONVERSATIONS_API_KEY resolves with the env key named as the source", () => {
    const resolved = resolveConversationsSdkTransport({
      env: env(tempHome(), { HASNA_CONVERSATIONS_API_KEY: "env-key" }),
    });
    expect(resolved.mode).toBe("http");
    expect(resolved.baseUrl).toBe("https://api.hasna.com/conversations");
    expect(resolved.apiKey).toBe("env-key");
    expect(resolved.apiKeySource).toBe("HASNA_CONVERSATIONS_API_KEY");
    // No URL configured anywhere: the fleet gateway applied.
    expect(resolved.apiUrlSource).toBe("default");
  });

  test("disk tier: ~/.hasna/conversations/config/credentials resolves with the file path as the source", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_CONVERSATIONS_API_KEY=disk-key\n");
    const resolved = resolveConversationsSdkTransport({ env: env(home) });
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.apiKeySource).toContain(join(".hasna", "conversations", "config", "credentials"));
    expect(resolved.apiUrlSource).toBe("default");
  });

  test("the credentials file can also pin the authority (no /v1 duplication)", () => {
    const home = tempHome();
    writeDiskCredential(
      home,
      "HASNA_CONVERSATIONS_API_KEY=disk-key\nHASNA_CONVERSATIONS_API_URL=https://conversations.disk.test\n",
    );
    const resolved = resolveConversationsSdkTransport({ env: env(home) });
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.baseUrl).toBe("https://conversations.disk.test");
    expect(resolved.apiUrlSource).toContain("credentials");
  });

  test("HASNA_CONVERSATIONS_API_URL names the authority, reported as its env key", () => {
    const resolved = resolveConversationsSdkTransport({
      env: env(tempHome(), {
        HASNA_CONVERSATIONS_API_KEY: "env-key",
        HASNA_CONVERSATIONS_API_URL: "https://conversations.env.test/",
      }),
    });
    expect(resolved.baseUrl).toBe("https://conversations.env.test");
    expect(resolved.apiUrlSource).toBe("HASNA_CONVERSATIONS_API_URL");
  });

  test("explicit apiKey argument is tier 1 and is reported as such", () => {
    const home = tempHome();
    // An ambient credential exists on disk, but tier 1 wins and reports itself.
    writeDiskCredential(home, "HASNA_CONVERSATIONS_API_KEY=disk-key\n");
    const resolved = resolveConversationsSdkTransport({ env: env(home), apiKey: "explicit-key" });
    expect(resolved.apiKey).toBe("explicit-key");
    expect(resolved.apiKeySource).toBe("explicit apiKey argument");
    expect(resolved.apiUrlSource).toBe("default");
  });

  test("injected security runner: the Keychain tier resolves on a darwin platform, above the env tier", () => {
    const reads: Array<readonly string[]> = [];
    const resolved = resolveConversationsSdkTransport({
      env: env(tempHome(), {
        HASNA_STATION: "test-station",
        USER: "hasna",
        // The env tier is BELOW the Keychain: it must lose.
        HASNA_CONVERSATIONS_API_KEY: "env-key",
      }),
      credentials: { keychain: { platform: "darwin", run: keychainRunner(reads) } },
    });
    expect(resolved.apiKey).toBe("keychain-key");
    expect(resolved.apiKeySource).toContain("keychain:hasna.credentials.conversations.api-key");
    expect(reads.some((argv) => argv.join(" ").includes("api-key"))).toBe(true);
  });

  test("#1788: a declared-but-blank legacy alias is normalised away without turning the Keychain tier off", () => {
    const reads: Array<readonly string[]> = [];
    const resolved = resolveConversationsSdkTransport({
      env: env(tempHome(), {
        HASNA_STATION: "test-station",
        USER: "hasna",
        // Blank means "not configured" to this app; the resolver would refuse
        // it loudly, so the inputs helper removes it — and the removal forces
        // a COPY of the env, which must not disable the ambient tier.
        CONVERSATIONS_API_URL: "",
      }),
      credentials: { keychain: { platform: "darwin", run: keychainRunner(reads) } },
    });
    expect(resolved.apiKey).toBe("keychain-key");
    expect(resolved.baseUrl).toBe("https://api.hasna.com/conversations");
    expect(reads.length).toBeGreaterThan(0);
  });

  test("no credential anywhere: the hosted-only SDK fails loudly, naming every tier and the local opt-in", () => {
    const home = tempHome();
    let caught: unknown;
    try {
      resolveConversationsSdkTransport({ env: env(home) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConversationsSdkResolutionError);
    const failure = caught as ConversationsSdkResolutionError;
    expect(failure.code).toBe("CONVERSATIONS_CREDENTIAL_MISSING");
    expect(failure.message).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(failure.message).toContain("hasna.credentials.conversations.api-key");
    expect(failure.message).toContain("HASNA_CONVERSATIONS_DB_PATH");
    // Never a local fallback: nothing was created under the scratch HOME.
    expect(() => createConversationsClient({ env: env(home) })).toThrow(/CONVERSATIONS_CREDENTIAL_MISSING/);
  });

  test("an unreadable credential file is a loud error, never a silent skip", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_CONVERSATIONS_API_KEY=disk-key\n");
    chmodSync(join(home, ".hasna", "conversations", "config", "credentials"), 0o644);
    expect(() => resolveConversationsSdkTransport({ env: env(home) })).toThrow(/owner-only/);
  });

  test("the explicit local opt-in is refused: an HTTP client cannot serve the on-box store", () => {
    const home = tempHome();
    // A hosted credential is present too; resolving it beside the opt-in would
    // put the SDK on the fleet while the CLI in the same shell is local.
    writeDiskCredential(home, "HASNA_CONVERSATIONS_API_KEY=disk-key\n");
    let caught: unknown;
    try {
      resolveConversationsSdkTransport({
        env: env(home, { HASNA_CONVERSATIONS_DB_PATH: join(home, "store.db") }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConversationsSdkResolutionError);
    expect((caught as ConversationsSdkResolutionError).code).toBe("CONVERSATIONS_LOCAL_STORE_SELECTED");
    expect((caught as Error).message).toContain("getStore()");
  });
});

describe("#1794: an explicit authority never attracts the ambient fleet key", () => {
  test("explicit baseUrl with no apiKey resolves unauthenticated and consults no tier", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_CONVERSATIONS_API_KEY=disk-key\n");
    const reads: Array<readonly string[]> = [];
    const resolved = resolveConversationsSdkTransport({
      env: env(home, { HASNA_STATION: "test-station", USER: "hasna", HASNA_CONVERSATIONS_API_KEY: "env-key" }),
      credentials: { keychain: { platform: "darwin", run: keychainRunner(reads) } },
      baseUrl: "https://staging.example.invalid/v1/",
    });
    expect(resolved.baseUrl).toBe("https://staging.example.invalid");
    expect(resolved.apiKey).toBeNull();
    expect(resolved.apiKeySource).toBeNull();
    expect(resolved.apiUrlSource).toBe("explicit baseUrl argument");
    expect(reads).toEqual([]);
  });

  test("createConversationsClient with an explicit baseUrl sends NO x-api-key", async () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_CONVERSATIONS_API_KEY=disk-key\n");
    const seen: Array<{ url: string; apiKey: string | null }> = [];
    const client = createConversationsClient({
      env: env(home, { HASNA_CONVERSATIONS_API_KEY: "env-key" }),
      baseUrl: "https://staging.example.invalid",
      fetch: recordingFetch(seen),
    });
    expect(client).toBeInstanceOf(ConversationsClient);
    await client.getVersion();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.apiKey).toBeNull();
    expect(seen[0]!.url).toBe("https://staging.example.invalid/version");
  });

  test("an explicit baseUrl with an explicit apiKey sends that key, and only that key", async () => {
    const seen: Array<{ url: string; apiKey: string | null }> = [];
    const client = createConversationsClient({
      env: env(tempHome(), { HASNA_CONVERSATIONS_API_KEY: "env-key" }),
      baseUrl: "https://staging.example.invalid",
      apiKey: "caller-key",
      fetch: recordingFetch(seen),
    });
    await client.getVersion();
    expect(seen[0]!.apiKey).toBe("caller-key");
  });
});

describe("createConversationsClient: the chain behind the generated client", () => {
  test("builds the /v1 client at the resolved authority with the resolved credential", async () => {
    const seen: Array<{ url: string; apiKey: string | null }> = [];
    const client = createConversationsClient({
      env: env(tempHome(), { HASNA_CONVERSATIONS_API_KEY: "env-key" }),
      fetch: recordingFetch(seen),
    });
    await client.getThreadUnread(7, { agent: "probe" });
    expect(seen).toHaveLength(1);
    // Exactly one version segment: the resolver strips the chain's /v1 and the
    // generated client composes its own.
    expect(seen[0]!.url).toBe("https://api.hasna.com/conversations/v1/threads/7/unread?agent=probe");
    expect(seen[0]!.apiKey).toBe("env-key");
  });

  test("the credential is re-resolved on every request, so a rotation heals a long-lived client", async () => {
    const liveEnv = env(tempHome(), { HASNA_CONVERSATIONS_API_KEY: "key-before-rotation" });
    const seen: Array<{ url: string; apiKey: string | null }> = [];
    const client = createConversationsClient({ env: liveEnv, fetch: recordingFetch(seen) });

    await client.getVersion();
    liveEnv.HASNA_CONVERSATIONS_API_KEY = "key-after-rotation";
    await client.getVersion();

    expect(seen.map((r) => r.apiKey)).toEqual(["key-before-rotation", "key-after-rotation"]);
  });

  test("a re-resolution that fails mid-flight keeps the constructed credential", async () => {
    const liveEnv = env(tempHome(), { HASNA_CONVERSATIONS_API_KEY: "constructed-key" });
    const seen: Array<{ url: string; apiKey: string | null }> = [];
    const client = createConversationsClient({ env: liveEnv, fetch: recordingFetch(seen) });

    delete liveEnv.HASNA_CONVERSATIONS_API_KEY;
    await client.getVersion();

    expect(seen[0]!.apiKey).toBe("constructed-key");
  });
});
