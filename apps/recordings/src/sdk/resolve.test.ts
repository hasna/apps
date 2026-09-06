/**
 * The `@hasna/recordings/sdk` resolution surface: tier-1 authority pinning
 * (#1794 — an explicit `baseUrl` with no `apiKey` must never attract the
 * ambient fleet key), per-request credential refresh for a client that
 * resolved its own authority, the local-serve opt-in, and fail-closed
 * refusals.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import {
  RECORDINGS_LOCAL_SERVE_URL,
  __resetRecordingsSdkLocalNotice,
  createRecordingsV1Client,
  resolveRecordingsSdkTransport,
} from "./resolve.js";
import { RecordingsV1Client } from "./v1.generated.js";
import type { RecordsKeychainTierOptions } from "../http/client.js";

const KEYCHAIN_KEY = "fixture-sdk-keychain-key";
const DISK_KEY = "fixture-sdk-disk-key";
const ENV_KEY = "fixture-sdk-env-key";

const tempRoots: string[] = [];
afterEach(() => {
  __resetRecordingsSdkLocalNotice();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `recordings-sdk-${label}-`));
  tempRoots.push(root);
  return root;
}

function writeDiskCredential(home: string, body: string): string {
  const file = join(home, ".hasna", "recordings", "config", "credentials");
  mkdirSync(join(home, ".hasna", "recordings", "config"), { recursive: true });
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
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
  return {
    calls,
    options: { credentials: { keychain: { platform: "darwin", run } } as RecordsKeychainTierOptions },
  } as const;
}

describe("tier 1 — an explicit baseUrl pins the authority and never attracts the ambient key (#1794)", () => {
  test("baseUrl without apiKey sends NO credential — the ambient chain is not consulted", async () => {
    // The dangerous shape: an explicit authority with no key, while the
    // machine's Keychain and disk both hold a resolvable fleet credential.
    // The transport must send NOTHING, and must not even look at the stores.
    const home = tempHome("pin-no-key");
    writeDiskCredential(home, `HASNA_RECORDINGS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.recordings.api-key": KEYCHAIN_KEY });

    const transport = resolveRecordingsSdkTransport({
      baseUrl: "https://recordings.elsewhere.example",
      env: { HOME: home },
      ...keychain.options,
    });
    expect(transport.mode).toBe("http");
    expect(transport.baseUrl).toBe("https://recordings.elsewhere.example");
    expect(transport.apiKey).toBeNull();
    expect(transport.apiKeySource).toBeNull();
    expect(keychain.calls).toEqual([]);

    // And the pinned constructor (the generated client, documented for
    // explicit authorities) sends no x-api-key header on that baseUrl, with a
    // resolvable ambient credential sitting right there.
    let sentHeaders: Record<string, string> | null = null;
    const client = new RecordingsV1Client({
      baseUrl: "https://recordings.elsewhere.example",
      fetch: async (_input, init) => {
        sentHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify({ recordings: [], count: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await client.listRecordings({});
    expect(sentHeaders).not.toBeNull();
    expect(sentHeaders!["x-api-key"]).toBeUndefined();
    expect(sentHeaders!["Authorization"]).toBeUndefined();
  });

  test("baseUrl WITH apiKey sends exactly that key, every request", async () => {
    const home = tempHome("pin-with-key");
    writeDiskCredential(home, `HASNA_RECORDINGS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.recordings.api-key": KEYCHAIN_KEY });

    const seen: Array<string | undefined> = [];
    const client = createRecordingsV1Client({
      baseUrl: "https://recordings.elsewhere.example",
      apiKey: "fixture-explicit-sdk-key",
      env: { HOME: home },
      ...keychain.options,
      fetch: async (_input, init) => {
        seen.push((init?.headers as Record<string, string> | undefined)?.["x-api-key"]);
        return new Response(JSON.stringify({ recordings: [], count: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await client.listRecordings({});
    await client.listRecordings({});
    expect(seen).toEqual(["fixture-explicit-sdk-key", "fixture-explicit-sdk-key"]);
    // The stores were never consulted either at construction or per request.
    expect(keychain.calls).toEqual([]);
  });
});

describe("a client that resolved its own authority re-resolves the credential per request", () => {
  test("a rotation heals without rebuilding the client (#1720 freshness)", async () => {
    const home = tempHome("rotate");
    const file = writeDiskCredential(home, `HASNA_RECORDINGS_API_KEY=${DISK_KEY}\n`);

    const seen: Array<string | undefined> = [];
    const client = createRecordingsV1Client({
      env: { HOME: home },
      fetch: async (_input, init) => {
        seen.push((init?.headers as Record<string, string> | undefined)?.["x-api-key"]);
        return new Response(JSON.stringify({ recordings: [], count: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    // No URL configured: a key alone resolved the fleet gateway, and the
    // client reports the origin WITHOUT a /v1 suffix.
    expect(client.baseUrl).toBe("https://api.hasna.com/recordings");

    await client.listRecordings({});
    // Rotate the credential on disk: the NEXT request must carry the new key.
    writeDiskCredential(home, `HASNA_RECORDINGS_API_KEY=fixture-rotated-key\n`);
    await client.listRecordings({});

    expect(seen[0]).toBe(DISK_KEY);
    expect(seen[1]).toBe("fixture-rotated-key");
    expect(file).toBeTruthy();
  });
});

describe("env tier and the fleet gateway", () => {
  test("HASNA_RECORDINGS_API_KEY alone resolves the fleet gateway", () => {
    const transport = resolveRecordingsSdkTransport({
      env: { HOME: tempHome("env-gateway"), HASNA_RECORDINGS_API_KEY: ENV_KEY },
    });
    expect(transport.mode).toBe("http");
    expect(transport.baseUrl).toBe("https://api.hasna.com/recordings");
    expect(transport.apiKeySource).toBe("HASNA_RECORDINGS_API_KEY");
  });

  test("HASNA_RECORDINGS_API_URL + key resolve the configured authority", () => {
    const transport = resolveRecordingsSdkTransport({
      env: {
        HOME: tempHome("env-url"),
        HASNA_RECORDINGS_API_URL: "https://recordings.configured.example",
        HASNA_RECORDINGS_API_KEY: ENV_KEY,
      },
    });
    expect(transport.baseUrl).toBe("https://recordings.configured.example");
    expect(transport.apiUrlSource).toBe("HASNA_RECORDINGS_API_URL");
  });

  test("the OpenAI transcription key is carved out: never a Hasna credential", () => {
    const home = tempHome("env-carve");
    // RECORDINGS_API_KEY is this package's OpenAI override; an env carrying it
    // plus a real disk credential must still resolve the disk credential, not
    // the mis-spelled one, and an env carrying ONLY it fails closed.
    const diskFile = writeDiskCredential(home, `HASNA_RECORDINGS_API_KEY=${DISK_KEY}\n`);
    const transport = resolveRecordingsSdkTransport({
      env: { HOME: home, RECORDINGS_API_KEY: "sk-fixture-openai" },
    });
    expect(transport.apiKeySource).toBe(diskFile);

    expect(() =>
      resolveRecordingsSdkTransport({ env: { HOME: tempHome("env-carve-none"), RECORDINGS_API_KEY: "sk-fixture-openai" } }),
    ).toThrow(/RECORDINGS_CREDENTIAL_MISSING/);
  });
});

describe("local mode and fail-closed", () => {
  test("the unhosted opt-in serves the local recordings-serve and says 'local' on stderr", () => {
    const home = tempHome("local-opt-in");
    const keychain = fakeKeychain({ "hasna.credentials.recordings.api-key": KEYCHAIN_KEY });
    const lines: string[] = [];

    const transport = resolveRecordingsSdkTransport({
      env: { HOME: home, HASNA_RECORDINGS_LOCAL: "1" },
      ...keychain.options,
      notice: (line) => lines.push(line),
    });
    expect(transport.mode).toBe("local-serve");
    expect(transport.baseUrl).toBe(RECORDINGS_LOCAL_SERVE_URL);
    expect(transport.apiKey).toBeNull();
    expect(lines.join("\n")).toContain("LOCAL mode");
    expect(lines.join("\n")).toContain(RECORDINGS_LOCAL_SERVE_URL);
    // The isolation guarantee: the stores were never consulted.
    expect(keychain.calls).toEqual([]);
  });

  test("no credential, no opt-in -> fail closed (no silent local fallback)", () => {
    const home = tempHome("sdk-fail-closed");
    expect(() =>
      resolveRecordingsSdkTransport({ env: { HOME: home }, ...fakeKeychain({}).options }),
    ).toThrow(/RECORDINGS_CREDENTIAL_MISSING/);
    expect(() =>
      createRecordingsV1Client({ env: { HOME: home }, ...fakeKeychain({}).options }),
    ).toThrow(/RECORDINGS_CREDENTIAL_MISSING/);
  });

  test("createRecordingsV1Client refuses the local opt-in: hosted-only client", () => {
    const home = tempHome("sdk-local-refused");
    expect(() =>
      createRecordingsV1Client({ env: { HOME: home, HASNA_RECORDINGS_LOCAL: "1" } }),
    ).toThrow(/RECORDINGS_CREDENTIAL_MISSING/);
  });
});

describe("credential source reporting", () => {
  test("reports the TRUE tier, never 'explicit apiKey argument' for a chained key", () => {
    const home = tempHome("source-true-tier");
    const diskFile = writeDiskCredential(home, `HASNA_RECORDINGS_API_KEY=${DISK_KEY}\n`);
    const transport = resolveRecordingsSdkTransport({ env: { HOME: home } });
    expect(transport.apiKeySource).toBe(diskFile);
  });
});