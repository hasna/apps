import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createAttachmentsApiClient, resolveAttachmentsSdkTransport } from "./resolve";

let scratch: string;
const SDK_TEST_KEYS = { rotated: "rotated-key", different: "different-key", second: "second-key" };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "attachments-sdk-resolve-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("resolveAttachmentsSdkTransport — ./sdk surface", () => {
  test("explicit baseUrl with no apiKey returns apiKey null and never attaches an ambient key", () => {
    const resolved = resolveAttachmentsSdkTransport({ baseUrl: "https://explicit.example.test" });
    expect(resolved.mode).toBe("http");
    expect(resolved.baseUrl).toBe("https://explicit.example.test");
    expect(resolved.apiKey).toBeNull();
    expect(resolved.apiKeySource).toBeNull();
    expect(resolved.apiUrlSource).toBe("explicit baseUrl argument");
  });

  test("explicit baseUrl + apiKey is used verbatim (tier 1)", () => {
    const resolved = resolveAttachmentsSdkTransport({
      baseUrl: "https://explicit.example.test/v1",
      apiKey: "explicit-key",
    });
    expect(resolved.baseUrl).toBe("https://explicit.example.test");
    expect(resolved.apiKey).toBe("explicit-key");
    expect(resolved.apiKeySource).toBe("explicit apiKey argument");
    expect(resolved.apiKeyTier).toBe("argument");
  });

  test("chain resolves the env pair when no arguments are given", () => {
    const resolved = resolveAttachmentsSdkTransport({
      env: {
        HASNA_ATTACHMENTS_API_URL: "https://chain.example.test",
        HASNA_ATTACHMENTS_API_KEY: "chain-key",
      },
    });
    expect(resolved.apiKey).toBe("chain-key");
    expect(resolved.apiKeySource).toBe("HASNA_ATTACHMENTS_API_KEY");
    expect(resolved.apiKeyTier).toBe("env");
    expect(resolved.baseUrl).toBe("https://chain.example.test");
  });

  test("a half-configured chain throws — the SDK is hosted-only", () => {
    expect(() =>
      resolveAttachmentsSdkTransport({ env: { HASNA_ATTACHMENTS_API_URL: "https://half.example.test" } }),
    ).toThrow(/no API key could be resolved/);
  });
});

describe("createAttachmentsApiClient — ./sdk factory", () => {
  test("explicit baseUrl without apiKey throws; it never borrows the ambient fleet key", () => {
    expect(() => createAttachmentsApiClient({ baseUrl: "https://explicit.example.test" })).toThrow(
      /ATTACHMENTS_CREDENTIAL_MISSING/,
    );
  });

  test("a working client re-resolves the credential on every request", async () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://rotate.example.test",
      HASNA_ATTACHMENTS_API_KEY: "first-key",
    };
    const keys: string[] = [];
    const client = createAttachmentsApiClient({
      env,
      fetch: (async (_url, init) => {
        keys.push(new Headers(init?.headers).get("x-api-key")!);
        return Response.json([]);
      }) as typeof fetch,
    });
    await client.listAttachments();
    env.HASNA_ATTACHMENTS_API_KEY = SDK_TEST_KEYS.rotated;
    await client.listAttachments();
    expect(keys).toEqual(["first-key", "rotated-key"]);
    expect(JSON.stringify(client)).not.toContain("rotated-key");
  });

  for (const refusal of ["missing", "blank", "conflicting", "blank-pointer"] as const) {
    test(`a ${refusal} credential refuses the next request without reusing the initial key`, async () => {
      const env: Record<string, string | undefined> = {
        HOME: scratch,
        HASNA_ATTACHMENTS_API_URL: "https://rotate.example.test",
        HASNA_ATTACHMENTS_API_KEY: "first-key",
      };
      const sentKeys: string[] = [];
      const client = createAttachmentsApiClient({
        env,
        fetch: (async (_url, init) => {
          sentKeys.push(new Headers(init?.headers).get("x-api-key")!);
          return Response.json([]);
        }) as typeof fetch,
      });
      await client.listAttachments();

      if (refusal === "missing") delete env.HASNA_ATTACHMENTS_API_KEY;
      if (refusal === "blank") env.HASNA_ATTACHMENTS_API_KEY = " ";
      if (refusal === "conflicting") env.ATTACHMENTS_API_KEY = SDK_TEST_KEYS.different;
      if (refusal === "blank-pointer") env.HASNA_ATTACHMENTS_API_KEY_REF = " ";

      await expect(client.listAttachments()).rejects.toThrow();
      expect(sentKeys).toEqual(["first-key"]);
    });
  }

  test("an authority change never sends the new authority's key to the original URL", async () => {
    const env = {
      HOME: scratch,
      HASNA_ATTACHMENTS_API_URL: "https://first.example.test",
      HASNA_ATTACHMENTS_API_KEY: "first-key",
    };
    const sent: Array<{ url: string; key: string | null }> = [];
    const client = createAttachmentsApiClient({
      env,
      fetch: (async (url, init) => {
        sent.push({ url: String(url), key: new Headers(init?.headers).get("x-api-key") });
        return Response.json([]);
      }) as typeof fetch,
    });
    await client.listAttachments();
    env.HASNA_ATTACHMENTS_API_URL = "https://second.example.test";
    env.HASNA_ATTACHMENTS_API_KEY = SDK_TEST_KEYS.second;

    await expect(client.listAttachments()).rejects.toThrow(/authority changed/i);
    expect(sent).toEqual([{ url: "https://first.example.test/v1/attachments", key: "first-key" }]);
  });
});
