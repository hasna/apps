// Hermetic tests for the @hasna/shortlinks/sdk resolver seam.
//
// The resolver is the @hasna/contracts client chain (hasna/apps#1720): an
// explicit argument, the Keychain, ~/.hasna/shortlinks/config/credentials, or
// HASNA_SHORTLINKS_API_KEY, with the fleet gateway as the default authority.
// These tests fake HOME/HASNA_HOME and inject the security runner so nothing
// touches the machine's real Keychain or credential files.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShortlinksApiClient } from "./generated.js";
import { createShortlinksApiClient, resolveShortlinksSdkTransport } from "./resolve.js";
import type { ShortlinksSdkTransport } from "./resolve.js";

type SdkEnv = Record<string, string | undefined>;

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "shortlinks-sdk-resolver-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function env(home: string, extra: Record<string, string> = {}): SdkEnv {
  return { HOME: home, SHORTLINKS_HOME: home, ...extra };
}

/** Write a disk credential for the resolver's disk tier in a scratch HOME. */
function writeDiskCredential(home: string, body: string): void {
  const dir = join(home, ".hasna", "shortlinks", "config");
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

/** A fetch double that records the x-api-key of every request. */
function keyRecordingFetch(seen: Array<string | null>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(requestHeaders(init)["x-api-key"] ?? null);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("SDK credential resolution through the @hasna/contracts chain", () => {
  test("env tier: HASNA_SHORTLINKS_API_KEY resolves with the env key named as the source", () => {
    const resolved = resolveShortlinksSdkTransport({
      env: { HASNA_SHORTLINKS_API_KEY: "env-key" },
    });
    expect(resolved.mode).toBe("http");
    expect(resolved.baseUrl).toBe("https://api.hasna.com/shortlinks");
    expect(resolved.apiKey).toBe("env-key");
    expect(resolved.apiKeySource).toBe("HASNA_SHORTLINKS_API_KEY");
    // No URL configured anywhere: the fleet gateway applied.
    expect(resolved.apiUrlSource).toBe("default");
  });

  test("disk tier: ~/.hasna/shortlinks/config/credentials resolves with the file path as the source", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=disk-key\n");
    const resolved = resolveShortlinksSdkTransport({ env: env(home) });
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.apiKeySource).toContain(join(".hasna", "shortlinks", "config", "credentials"));
    expect(resolved.apiUrlSource).toBe("default");
  });

  test("the credentials file can also pin the authority", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=disk-key\nHASNA_SHORTLINKS_API_URL=https://shortlinks.disk.test\n");
    const resolved = resolveShortlinksSdkTransport({ env: env(home) });
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.baseUrl).toBe("https://shortlinks.disk.test");
    expect(resolved.apiUrlSource).toContain("credentials");
  });

  test("explicit apiKey argument is tier 1 and is reported as such", () => {
    const home = tempHome();
    // An ambient credential exists on disk, but tier 1 wins and reports itself.
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=disk-key\n");
    const resolved = resolveShortlinksSdkTransport({
      env: env(home),
      apiKey: "explicit-key",
    });
    expect(resolved.apiKey).toBe("explicit-key");
    expect(resolved.apiKeySource).toBe("explicit apiKey argument");
    expect(resolved.apiUrlSource).toBe("default");
  });

  test("injected security runner: the Keychain tier resolves on a darwin platform", () => {
    const home = tempHome();
    const reads: Array<readonly string[]> = [];
    const resolved = resolveShortlinksSdkTransport({
      env: env(home, { HASNA_STATION: "test-station", USER: "hasna" }),
      credentials: {
        keychain: {
          platform: "darwin",
          run: (argv) => {
            reads.push(argv);
            const args = argv.join(" ");
            if (args.includes("api-url")) return { status: 44, stdout: "", stderr: "" };
            if (args.includes("api-key")) return { status: 0, stdout: "keychain-key", stderr: "" };
            return { status: 44, stdout: "", stderr: "" };
          },
        },
      },
    });
    expect(resolved.apiKey).toBe("keychain-key");
    expect(resolved.apiKeySource).toContain("keychain:hasna.credentials.shortlinks.api-key");
    expect(reads.some((argv) => argv.join(" ").includes("api-key"))).toBe(true);
  });

  test("no credential anywhere: the hosted-only SDK fails loudly", () => {
    const home = tempHome();
    expect(() => resolveShortlinksSdkTransport({ env: env(home) })).toThrow(
      /SHORTLINKS_CREDENTIAL_MISSING/,
    );
    expect(() => resolveShortlinksSdkTransport({ env: env(home) })).toThrow(
      /HASNA_SHORTLINKS_API_KEY/,
    );
  });

  test("an unreadable credential file is a loud error, never a silent skip", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=disk-key\n");
    chmodSync(join(home, ".hasna", "shortlinks", "config", "credentials"), 0o644);
    expect(() => resolveShortlinksSdkTransport({ env: env(home) })).toThrow(/owner-only/);
  });
});

describe("#1794: an explicit authority never attracts the ambient fleet key", () => {
  test("explicit baseUrl with no apiKey resolves with NO key, even with a credential on disk", () => {
    const home = tempHome();
    // The ambient chain holds a fleet credential; the caller pointed the SDK
    // at an authority of their choosing. The fleet key must NOT follow.
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=ambient-fleet-key\n");
    const resolved = resolveShortlinksSdkTransport({
      baseUrl: "https://someone-elses.example.test",
      env: env(home),
    });
    expect(resolved.mode).toBe("http");
    expect(resolved.baseUrl).toBe("https://someone-elses.example.test");
    expect(resolved.apiKey).toBeNull();
    expect(resolved.apiKeySource).toBeNull();
    expect(resolved.apiUrlSource).toBe("explicit baseUrl argument");
  });

  test("explicit baseUrl with no apiKey also ignores an env key", () => {
    const resolved = resolveShortlinksSdkTransport({
      baseUrl: "https://staging.example.test",
      env: { HASNA_SHORTLINKS_API_KEY: "staging-would-be-key" },
    });
    expect(resolved.apiKey).toBeNull();
  });

  test("the raw generated client never attaches a key it was not given", () => {
    const seen: Array<string | null> = [];
    const client = new ShortlinksApiClient({
      baseUrl: "https://someone-elses.example.test",
      fetch: keyRecordingFetch(seen),
    });
    void client.listLinks();
    expect(seen).toEqual([null]);
  });
});

describe("the hosted /v1 client builds through the resolver, fresh per request", () => {
  test("createShortlinksApiClient throws when no credential resolves", () => {
    const home = tempHome();
    expect(() => createShortlinksApiClient({ env: env(home) })).toThrow(
      /SHORTLINKS_CREDENTIAL_MISSING/,
    );
  });

  test("the credential is re-resolved per request (rotation heals mid-flight)", async () => {
    const sdkEnv: SdkEnv = { HASNA_SHORTLINKS_API_KEY: "initial-key" };
    const seen: Array<string | null> = [];
    const client = createShortlinksApiClient({
      env: sdkEnv,
      fetch: keyRecordingFetch(seen),
    });
    await client.listLinks();
    // The key rotates in the environment (the Keychain/disk analog); a
    // long-lived client must pick it up without a rebuild.
    sdkEnv.HASNA_SHORTLINKS_API_KEY = "rotated-key";
    await client.listLinks();
    expect(seen).toEqual(["initial-key", "rotated-key"]);
  });

  test("an explicit baseUrl + apiKey builds a pinned client", async () => {
    const seen: Array<string | null> = [];
    const client = createShortlinksApiClient({
      baseUrl: "https://pinned.example.test",
      apiKey: "pinned-key",
      fetch: keyRecordingFetch(seen),
    });
    await client.listLinks();
    expect(seen).toEqual(["pinned-key"]);
  });

  test("transport report: the resolved transport names authority and credential sources", () => {
    const resolved: ShortlinksSdkTransport = resolveShortlinksSdkTransport({
      env: {
        HASNA_SHORTLINKS_API_URL: "https://shortlinks.report.test",
        HASNA_SHORTLINKS_API_KEY: "report-key",
      },
    });
    expect(resolved.baseUrl).toBe("https://shortlinks.report.test");
    expect(resolved.apiUrlSource).toBe("HASNA_SHORTLINKS_API_URL");
    expect(resolved.apiKeySource).toBe("HASNA_SHORTLINKS_API_KEY");
    expect(resolved.mode).toBe("http");
  });
});