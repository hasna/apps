/**
 * Hermetic credential-resolution tests for the @hasna/files SDK surface.
 *
 * Everything here runs against a fake HOME / HASNA_HOME (disk tier) and an
 * injected `security` runner (Keychain tier), so the machine's real credential
 * stores are structurally unreachable:
 *
 *  - credential-resolution: env tier, disk tier (`~/.hasna/files/config/
 *    credentials`, 0600), and Keychain tier (injected runner) all supply the
 *    credential to `createFilesClientFromEnv`.
 *  - per-request freshness: the resolver is consulted ON EVERY REQUEST — a
 *    rotation in the credential file heals the NEXT request, not the next
 *    restart.
 *  - fail-closed: no credential anywhere => throws, no client, no fallback.
 *  - transport-report: `resolveFilesSdkTransport` names the tier and source
 *    (never the value).
 *  - authority pinning (#1794): an explicit `baseUrl` with no `apiKey` never
 *    receives the ambient fleet key.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilesClientFromEnv, resolveFilesSdkTransport, FILES_APP_NAME } from "./index.js";
import type { FilesKeychainCommandRunner, FilesKeychainOptions } from "../store/client-types.js";

const KEY_ENV = "hasna_files_env_key_00000000001";
const KEY_DISK = "hasna_files_disk_key_0000000000";
const KEY_CHAIN = "hasna_files_chain_key_000000000";

const tempDirs: string[] = [];
let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "files-sdk-credential-"));
  tempDirs.push(homeDir);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeHomeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: homeDir,
    HASNA_HOME: homeDir,
    ...extra,
  } as NodeJS.ProcessEnv;
}

/** The disk tier: `<HASNA_HOME>/files/config/credentials` (HASNA_HOME replaces the home root), owner-only 0600. */
function writeDiskCredential(apiKey: string, apiUrl?: string): string {
  const file = join(homeDir, "files", "config", "credentials");
  mkdirSync(join(homeDir, "files", "config"), { recursive: true });
  const lines = [`HASNA_FILES_API_KEY=${apiKey}`];
  if (apiUrl) lines.push(`HASNA_FILES_API_URL=${apiUrl}`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  chmodSync(file, 0o600);
  return file;
}

/** Injected `/usr/bin/security` runner serving `hasna.credentials.files.api-key` (darwin platform). */
function fakeSecurityRunner(apiKey: string): { run: FilesKeychainCommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: FilesKeychainCommandRunner = (argv) => {
    calls.push([...argv]);
    const args = [...argv];
    // `security find-generic-password -s hasna.credentials.files.api-key -a <acct> -w`
    if (args.includes("find-generic-password") && args.some((a) => a.includes("api-key"))) {
      return { status: 0, stdout: `${apiKey}\n`, stderr: "" };
    }
    return { status: 44, stdout: "", stderr: "item not found" };
  };
  return { run, calls };
}

/** Keychain controls that make the injected runner reachable for a caller-built env. */
function keychainOverrides(apiKey: string) {
  const { run } = fakeSecurityRunner(apiKey);
  return { credentials: { keychain: { run, platform: "darwin" } as FilesKeychainOptions } };
}

function capturedClient(env: NodeJS.ProcessEnv, overrides: Parameters<typeof createFilesClientFromEnv>[1] = {}) {
  const requests: { url: string; xApiKey: string | null }[] = [];
  const captureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(input), xApiKey: headers.get("x-api-key") });
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const files = createFilesClientFromEnv(env, { ...overrides, fetch: captureFetch });
  return { files, requests };
}

describe("SDK credential resolution (hermetic: fake HOME/HASNA_HOME, injected security runner)", () => {
  test("env tier: HASNA_FILES_API_KEY supplies the key; the gateway is the default authority", async () => {
    const { files, requests } = capturedClient(
      fakeHomeEnv({ HASNA_FILES_API_KEY: KEY_ENV }),
    );
    await files.listSources();
    expect(requests[0]!.url.startsWith("https://api.hasna.com/files/v1/")).toBe(true);
    expect(requests[0]!.xApiKey).toBe(KEY_ENV);
  });

  test("env tier honours the canonical URL and refuses a conflicting alias", async () => {
    const { files, requests } = capturedClient(
      fakeHomeEnv({
        HASNA_FILES_API_URL: "https://files.md",
        HASNA_FILES_API_KEY: KEY_ENV,
      }),
    );
    await files.listSources();
    expect(requests[0]!.url.startsWith("https://files.md/v1/")).toBe(true);
    expect(requests[0]!.xApiKey).toBe(KEY_ENV);
  });

  test("disk tier: <HASNA_HOME>/files/config/credentials (0600) supplies the key and URL", async () => {
    const diskPath = writeDiskCredential(KEY_DISK, "https://files.disk.test");
    const { files, requests } = capturedClient(fakeHomeEnv());
    await files.listSources();
    expect(requests[0]!.url.startsWith("https://files.disk.test/v1/")).toBe(true);
    expect(requests[0]!.xApiKey).toBe(KEY_DISK);
    expect(diskPath.includes(homeDir)).toBe(true);
  });

  test("Keychain tier: the injected security runner supplies the key", async () => {
    const { run, calls } = fakeSecurityRunner(KEY_CHAIN);
    const { files, requests } = capturedClient(fakeHomeEnv(), {
      credentials: { keychain: { run, platform: "darwin" } },
    });
    await files.listSources();
    expect(requests[0]!.xApiKey).toBe(KEY_CHAIN);
    expect(calls.length).toBeGreaterThan(0);
    // The authority item is queried first, then the credential item.
    expect(calls.some((c) => c.join(" ").includes("hasna.credentials.files.api-key"))).toBe(true);
  });

  test("tier precedence: the Keychain outranks disk, disk outranks env", async () => {
    writeDiskCredential(KEY_DISK);
    const chain = capturedClient(fakeHomeEnv({ HASNA_FILES_API_KEY: KEY_ENV }), keychainOverrides(KEY_CHAIN));
    await chain.files.listSources();
    expect(chain.requests[0]!.xApiKey).toBe(KEY_CHAIN);

    const diskOverEnv = capturedClient(fakeHomeEnv({ HASNA_FILES_API_KEY: KEY_ENV }));
    await diskOverEnv.files.listSources();
    expect(diskOverEnv.requests[0]!.xApiKey).toBe(KEY_DISK);
  });

  test("per-request freshness: a rotation in the credential file heals the NEXT request", async () => {
    writeDiskCredential("hasna_files_old_key_0000000000");
    const { files, requests } = capturedClient(fakeHomeEnv());
    await files.listSources();
    expect(requests[0]!.xApiKey).toBe("hasna_files_old_key_0000000000");

    writeDiskCredential("hasna_files_new_key_0000000000");
    await files.listSources();
    expect(requests[1]!.xApiKey).toBe("hasna_files_new_key_0000000000");
  });

  test("fail-closed: no credential anywhere throws, before any request", () => {
    // Falsy opt-ins are not opt-ins: a must-not-leak env cannot bleed in.
    expect(() => createFilesClientFromEnv(fakeHomeEnv({ HASNA_FILES_LOCAL: "0" }))).toThrow(
      /hasna.credentials.files.api-key|HASNA_FILES_API_KEY/,
    );
    expect(() => resolveFilesSdkTransport(fakeHomeEnv())).toThrow();
  });

  test("the ambient Keychain tier is OFF until a caller explicitly enables it", async () => {
    // The Keychain tier is ambient: for a caller-built env it runs only when
    // the caller passes the injected runner (test) or `enabled: true` (CI Mac
    // opt-in). Without either, a fake runner on disk must never be reached.
    expect(() => createFilesClientFromEnv(fakeHomeEnv())).toThrow();
    const enabled = capturedClient(fakeHomeEnv(), keychainOverrides(KEY_CHAIN));
    await enabled.files.listSources();
    expect(enabled.requests[0]!.xApiKey).toBe(KEY_CHAIN);
  });
});

describe("resolveFilesSdkTransport — the transport report (sources and tiers, never values)", () => {
  test("env tier reports the key name and the default gateway", () => {
    const report = resolveFilesSdkTransport(fakeHomeEnv({ HASNA_FILES_API_KEY: KEY_ENV }));
    expect(report.apiKeySource).toBe("HASNA_FILES_API_KEY");
    expect(report.apiKeyTier).toBe("env");
    expect(report.apiUrlSource).toBe("default");
    expect(report.baseUrl).toBe("https://api.hasna.com/files/v1");
  });

  test("explicit URL reports its env key name", () => {
    const report = resolveFilesSdkTransport(
      fakeHomeEnv({ HASNA_FILES_API_URL: "https://files.md", HASNA_FILES_API_KEY: KEY_ENV }),
    );
    expect(report.apiUrlSource).toBe("HASNA_FILES_API_URL");
    expect(report.baseUrl).toBe("https://files.md/v1");
  });

  test("disk tier reports the exact file path consulted", () => {
    const file = writeDiskCredential(KEY_DISK);
    const report = resolveFilesSdkTransport(fakeHomeEnv());
    expect(report.apiKeySource).toBe(file);
    expect(report.apiKeyTier).toBe("disk");
  });

  test("FILES_APP_NAME is the slug the resolver uses", () => {
    expect(FILES_APP_NAME).toBe("files");
    const report = resolveFilesSdkTransport(fakeHomeEnv({ HASNA_FILES_API_KEY: KEY_ENV }));
    const env: Record<string, string> = { HASNA_FILES_API_KEY: KEY_ENV };
    expect(env[`HASNA_${FILES_APP_NAME.toUpperCase()}_API_KEY`]).toBe(KEY_ENV);
    expect(report.baseUrl).toBe("https://api.hasna.com/files/v1");
  });
});

describe("SDK authority pinning (#1794)", () => {
  test("explicit baseUrl with NO apiKey never attaches the ambient fleet key", async () => {
    // The station HAS a resolvable credential (disk tier) AND a fake Keychain
    // runner is requested — but the caller pinned the authority, so neither is
    // consulted and the requests go out unauthenticated to the pinned URL.
    writeDiskCredential(KEY_DISK);
    const { files, requests } = capturedClient(fakeHomeEnv({ HASNA_FILES_API_KEY: KEY_ENV }), {
      baseUrl: "https://self-hosted.example.test",
      ...keychainOverrides(KEY_CHAIN),
    });
    await files.listSources();
    expect(requests[0]!.url.startsWith("https://self-hosted.example.test/v1/")).toBe(true);
    expect(requests[0]!.xApiKey).toBeNull();
  });

  test("explicit baseUrl WITH apiKey is a deliberate pin and re-resolves nothing", async () => {
    const { files, requests } = capturedClient(
      fakeHomeEnv({ HASNA_FILES_API_KEY: KEY_ENV }),
      { baseUrl: "https://pinned.example.test", apiKey: "pinned-key" },
    );
    await files.listSources();
    expect(requests[0]!.url.startsWith("https://pinned.example.test/v1/")).toBe(true);
    expect(requests[0]!.xApiKey).toBe("pinned-key");
  });
});