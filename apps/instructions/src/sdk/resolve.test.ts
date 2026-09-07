// The SDK resolver surface, hermetically: every case builds from a
// CALLER-BUILT env (or an injected Keychain runner / temp HOME), so none of
// them can touch the machine's real credential stores.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import { createInstructionsV1ClientFromEnv, resolveInstructionsSdkTransport } from "./resolve.js";

const ENV_KEY = "fixture-env-key";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `inst-sdk-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ".hasna", "instructions", "config", "credentials");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, { mode });
  chmodSync(file, mode);
  return file;
}

function fakeKeychain(items: Record<string, string>) {
  const calls: string[][] = [];
  const keychain = {
    platform: "darwin",
    run: (argv: readonly string[]): KeychainCommandResult => {
      calls.push([...argv]);
      const service = argv[argv.indexOf("-s") + 1] ?? "";
      const value = items[service];
      if (value === undefined) return { status: 44, stdout: "", stderr: "" };
      return { status: 0, stdout: `${value}\n`, stderr: "" };
    },
  };
  return { calls, keychain };
}

function captureFetch() {
  const calls: Array<{ url: string; apiKey: string | null }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), apiKey: headers.get("x-api-key") });
    return new Response(JSON.stringify({ configs: [], count: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("createInstructionsV1ClientFromEnv — explicit baseUrl (#1794)", () => {
  test("an explicit baseUrl + apiKey pair is a pin and wins over every ambient tier", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createInstructionsV1ClientFromEnv({
      baseUrl: "https://instructions.explicit.test",
      apiKey: "explicit-key",
      env: { HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
      fetch: fetchImpl,
    });
    await client.listConfigs();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://instructions.explicit.test/v1/configs");
    expect(calls[0]!.apiKey).toBe("explicit-key");
  });

  test("an explicit baseUrl WITHOUT an apiKey NEVER attaches the ambient fleet key", async () => {
    const { fetchImpl } = captureFetch();
    // A fleet credential exists in the environment — and it must not be
    // attached to an authority the caller chose itself.
    expect(() =>
      createInstructionsV1ClientFromEnv({
        baseUrl: "https://instructions.explicit.test",
        env: { HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
        fetch: fetchImpl,
      }),
    ).toThrow(/never attaches the machine's fleet credential/);
  });

  test("the explicit report names the pin sources", () => {
    const report = resolveInstructionsSdkTransport({
      baseUrl: "https://instructions.explicit.test/v1",
      apiKey: "explicit-key",
    });
    expect(report.mode).toBe("explicit");
    expect(report.baseUrl).toBe("https://instructions.explicit.test");
    expect(report.apiKeySource).toBe("explicit apiKey argument");
    expect(report.apiUrlSource).toBe("explicit baseUrl argument");
  });
});

describe("createInstructionsV1ClientFromEnv — the resolver chain", () => {
  test("the canonical env key reaches the default fleet gateway", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createInstructionsV1ClientFromEnv({
      env: { HASNA_INSTRUCTIONS_API_KEY: ENV_KEY },
      fetch: fetchImpl,
    });
    await client.listConfigs();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.hasna.com/instructions/v1/configs");
    expect(calls[0]!.apiKey).toBe(ENV_KEY);
  });

  test("the Keychain tier supplies both the key and the authority", async () => {
    const { calls, fetchImpl } = captureFetch();
    const keychain = fakeKeychain({
      "hasna.credentials.instructions.api-key": "fixture-keychain-key",
      "hasna.credentials.instructions.api-url": "https://instructions.keychain.test",
    });
    const client = createInstructionsV1ClientFromEnv({
      env: { HOME: tempHome("kc"), HASNA_STATION: "station-fixture" },
      credentials: { keychain: keychain.keychain },
      fetch: fetchImpl,
    });
    await client.listConfigs();
    expect(calls[0]!.url).toBe("https://instructions.keychain.test/v1/configs");
    expect(calls[0]!.apiKey).toBe("fixture-keychain-key");
    const report = resolveInstructionsSdkTransport({
      env: { HOME: tempHome("kc2"), HASNA_STATION: "station-fixture" },
      credentials: { keychain: keychain.keychain },
    });
    expect(report.mode).toBe("http");
    expect(report.apiUrlSource).toMatch(/^keychain:/);
    expect(JSON.stringify(report)).not.toContain("fixture-keychain-key");
  });

  test("the disk tier supplies both the key and the authority under a fake HOME", async () => {
    const { calls, fetchImpl } = captureFetch();
    const home = tempHome("disk");
    writeCredentialsFile(
      home,
      "HASNA_INSTRUCTIONS_API_URL=https://instructions.disk.test\nHASNA_INSTRUCTIONS_API_KEY=fixture-disk-key\n",
    );
    const client = createInstructionsV1ClientFromEnv({ env: { HOME: home }, fetch: fetchImpl });
    await client.listConfigs();
    expect(calls[0]!.url).toBe("https://instructions.disk.test/v1/configs");
    expect(calls[0]!.apiKey).toBe("fixture-disk-key");
  });

  test("no credential in any tier throws, never an anonymous client", async () => {
    const { fetchImpl } = captureFetch();
    expect(() =>
      createInstructionsV1ClientFromEnv({ env: { HOME: tempHome("none") }, fetch: fetchImpl }),
    ).toThrow(/HASNA_INSTRUCTIONS_API_KEY/);
  });
});

describe("per-request freshness", () => {
  test("a rotation in the environment heals the next request without rebuilding the client", async () => {
    const { calls, fetchImpl } = captureFetch();
    const env = { HASNA_INSTRUCTIONS_API_KEY: "key-before-rotation" };
    const client = createInstructionsV1ClientFromEnv({ env, fetch: fetchImpl });

    await client.listConfigs();
    expect(calls[0]!.apiKey).toBe("key-before-rotation");

    // Rotate the key in the SAME env object; the next request must carry the
    // new key — the credential is resolved fresh per request, never cached in
    // the client.
    env.HASNA_INSTRUCTIONS_API_KEY = "key-after-rotation";
    await client.getConfig("demo");
    expect(calls[1]!.apiKey).toBe("key-after-rotation");
  });
});