import { describe, expect, test } from "bun:test";
import { EstateS3Store, buildObjectUrl } from "./store.js";
import { createMemoryS3 } from "./test/memory-s3.js";

const CREDS = { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" };

describe("EstateS3Store", () => {
  test("composes every key under the configured prefix", () => {
    const store = new EstateS3Store({
      bucket: "hasna-apps-prod-store-789877399345",
      prefix: "skills",
      credentials: CREDS,
    });
    expect(store.objectKey("bundles/abc")).toBe("skills/bundles/abc");
    expect(store.objectKey("index/pdf-generate.json")).toBe("skills/index/pdf-generate.json");
  });

  test("rejects keys that would escape the prefix", () => {
    const store = new EstateS3Store({
      bucket: "b",
      prefix: "skills",
      credentials: CREDS,
    });
    expect(() => store.objectKey("../escape")).toThrow("Invalid estate store key");
    expect(() => store.objectKey("a/../../b")).toThrow("Invalid estate store key");
  });

  test("putObject signs with SigV4 and writes prefix-scoped objects", async () => {
    const { fetch, state } = createMemoryS3();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const wrapped: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return fetch(input, init);
    };
    const store = new EstateS3Store({
      bucket: "hasna-apps-prod-store-789877399345",
      prefix: "skills",
      region: "us-east-1",
      credentials: CREDS,
      fetch: wrapped,
    });
    const result = await store.putObject({ path: "bundles/abc", body: new TextEncoder().encode("data"), contentType: "application/octet-stream" });
    expect(result.key).toBe("skills/bundles/abc");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("hasna-apps-prod-store-789877399345");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("authorization")).toStartWith("AWS4-HMAC-SHA256");
    expect(headers.get("x-amz-content-sha256")).toHaveLength(64);
    expect(state.objects.has("skills/bundles/abc")).toBe(true);
  });

  test("getObject and objectExists round-trip", async () => {
    const { fetch, state } = createMemoryS3();
    const store = new EstateS3Store({
      bucket: "hasna-apps-prod-store-789877399345",
      prefix: "skills",
      credentials: CREDS,
      fetch,
    });
    expect(await store.objectExists("index/missing.json")).toBe(false);
    await store.putObject({ path: "index/foo.json", body: new TextEncoder().encode("{}") });
    expect(await store.objectExists("index/foo.json")).toBe(true);
    const bytes = await store.getObject("index/foo.json");
    expect(new TextDecoder().decode(bytes)).toBe("{}");
  });

  test("buildObjectUrl supports path-style and endpoint URLs", () => {
    expect(
      buildObjectUrl({ bucket: "b", key: "skills/x", region: "us-east-1", forcePathStyle: false }),
    ).toBe("https://b.s3.us-east-1.amazonaws.com/skills/x");
    expect(
      buildObjectUrl({ bucket: "b", key: "skills/x", region: "us-east-1", forcePathStyle: true }),
    ).toBe("https://s3.us-east-1.amazonaws.com/b/skills/x");
    expect(
      buildObjectUrl({ bucket: "b", key: "skills/x", region: "us-east-1", endpoint: "https://minio.local", forcePathStyle: true }),
    ).toBe("https://minio.local/b/skills/x");
  });
});
