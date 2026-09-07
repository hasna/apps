/**
 * @hasna/logs — `@hasna/logs/api` resolver-backed factory.
 *
 * Covers the #1794 authority pin (an explicit `baseUrl` never carries the
 * ambient fleet credential), the per-request refresh over the generated
 * client, and the fail-loud hosted shape. Hermetic: credentials come from a
 * caller-built env dictionary and an injected fake `security` runner; the
 * requests are served by an injected fetch double.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import { createLogsApiClientFromEnv } from "./from-env.ts";
import type { LogsClient } from "./client.ts";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `logs-api-env-${label}-`));
  tempRoots.push(root);
  return root;
}

function fakeKeychain(items: Record<string, string>) {
  const run = (argv: readonly string[]): KeychainCommandResult => {
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
  return { credentials: { keychain: { platform: "darwin", run } } } as const;
}

/** A fetch double capturing every request. */
function captureFetch() {
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input, init });
    return new Response(JSON.stringify({ inserted: 1, events: [] }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe("createLogsApiClientFromEnv", () => {
  test("throws when no credential resolves anywhere (fail loud, no client)", () => {
    const home = tempHome("none");
    expect(() => createLogsApiClientFromEnv({ HOME: home })).toThrow(
      /no API key could be resolved/,
    );
    expect(() =>
      createLogsApiClientFromEnv({ HOME: home, HASNA_LOGS_LOCAL: "1" }),
    ).toThrow(/no API key could be resolved/);
  });

  test("resolves the env tier and refreshes the credential per request", async () => {
    const home = tempHome("env");
    const { requests, fetchImpl } = captureFetch();
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      HASNA_LOGS_API_URL: "https://logs.example.com",
      HASNA_LOGS_API_KEY: "first-key",
    };
    const client: LogsClient = createLogsApiClientFromEnv(env, { fetch: fetchImpl });
    await client.ingestLog({ level: "info", message: "one" });

    expect(requests).toHaveLength(1);
    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("x-api-key")).toBe("first-key");
    // Snapshot the runtime behaviour: the request URL carries the /v1 prefix.
    expect(String(requests[0]!.input)).toMatch(/^https:\/\/logs\.example\.com\/v1\/logs$/);

    // Rotate the key: the next request must carry the new key (fresh-per-call).
    env.HASNA_LOGS_API_KEY = "second-key";
    await client.listLogs();
    const headersAfter = new Headers(requests[1]!.init?.headers);
    expect(headersAfter.get("x-api-key")).toBe("second-key");
  });

  test("resolves the Keychain tier through an injected runner", async () => {
    const home = tempHome("keychain");
    const keychain = fakeKeychain({ "hasna.credentials.logs.api-key": "kc-key" });
    const { requests, fetchImpl } = captureFetch();
    const client = createLogsApiClientFromEnv(
      { HOME: home, HASNA_STATION: "fixture-station" },
      { credentials: keychain.credentials, fetch: fetchImpl },
    );
    await client.listLogs();

    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("x-api-key")).toBe("kc-key");
    // Keychain resolves the fleet gateway default.
    expect(String(requests[0]!.input)).toMatch(/^https:\/\/api\.hasna\.com\/logs\/v1\/logs/);
  });

  test("#1794 pin: an explicit baseUrl never carries the ambient fleet credential", async () => {
    const home = tempHome("pin");
    const { requests, fetchImpl } = captureFetch();
    // The ambient chain holds a resolvable credential...
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      HASNA_LOGS_API_KEY: "ambient-fleet-key",
    };
    // sanity: the same environment DOES resolve for a hosted factory call
    expect(() => createLogsApiClientFromEnv(env, { fetch: fetchImpl })).not.toThrow();

    // ...but a caller naming the authority sends NOTHING of theirs.
    const pinned = createLogsApiClientFromEnv(env, {
      baseUrl: "https://third-party.example",
      fetch: fetchImpl,
    });
    await pinned.ingestLog({ level: "info", message: "pinned" });

    expect(requests).toHaveLength(1);
    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("x-api-key")).toBeNull();
    expect(String(requests[0]!.input)).toMatch(/^https:\/\/third-party\.example\/v1\/logs$/);
  });

  test("#1794 pin: an explicit apiKey still travels to an explicit baseUrl", async () => {
    const home = tempHome("pin-key");
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      HASNA_LOGS_API_KEY: "ambient-fleet-key",
    };
    const { requests, fetchImpl } = captureFetch();
    const pinned = createLogsApiClientFromEnv(env, {
      baseUrl: "https://third-party.example",
      apiKey: "caller-chosen",
      fetch: fetchImpl,
    });
    await pinned.ingestLog({ level: "info", message: "pinned" });

    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("x-api-key")).toBe("caller-chosen");
    expect(headers.get("x-api-key")).not.toBe("ambient-fleet-key");
  });

  test("disk tier: a credential file under the temp home resolves", async () => {
    const home = tempHome("disk");
    const file = join(home, ".hasna", "logs", "config", "credentials");
    const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "HASNA_LOGS_API_KEY=disk-key\n", { mode: 0o600 });
    chmodSync(file, 0o600);

    const { requests, fetchImpl } = captureFetch();
    const client = createLogsApiClientFromEnv({ HOME: home }, { fetch: fetchImpl });
    await client.listProjects();

    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("x-api-key")).toBe("disk-key");
    expect(String(requests[0]!.input)).toMatch(/^https:\/\/api\.hasna\.com\/logs\/v1\/projects$/);
  });
});