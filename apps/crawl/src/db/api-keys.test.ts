import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";

let dbPath: string;

beforeEach(() => {
  dbPath = `/tmp/crawl-apikeys-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  Bun.env.CRAWL_DB_PATH = dbPath;
});

afterEach(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
});

describe("createApiKey", () => {
  it("generates a wc_live_ raw key with a 12-char prefix and 40-char total", async () => {
    const { createApiKey } = await import("./api-keys.js");
    const { rawKey, apiKey } = createApiKey({});
    expect(rawKey.startsWith("wc_live_")).toBe(true);
    expect(rawKey).toHaveLength(40);
    expect(apiKey.keyPrefix).toBe(rawKey.slice(0, 12));
    expect(apiKey.active).toBe(true);
    expect(apiKey.lastUsedAt).toBeNull();
    expect(apiKey.expiresAt).toBeNull();
  });

  it("stores the sha256 hash of the raw key, never the raw key", async () => {
    const { createApiKey, listApiKeys } = await import("./api-keys.js");
    const { rawKey } = createApiKey({ name: "hashed" });
    const { createHash } = await import("crypto");
    const stored = listApiKeys()[0]!;
    expect(stored.keyHash).toBe(createHash("sha256").update(rawKey).digest("hex"));
    expect(stored.keyHash).not.toContain(rawKey);
  });

  it("persists name and expiresAt when given", async () => {
    const { createApiKey } = await import("./api-keys.js");
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const { apiKey } = createApiKey({ name: "nightly", expiresAt });
    expect(apiKey.name).toBe("nightly");
    expect(apiKey.expiresAt).toBe(expiresAt);
  });
});

describe("getApiKeyByHash", () => {
  it("finds a key by its hash and returns null for an unknown hash", async () => {
    const { createApiKey, getApiKeyByHash } = await import("./api-keys.js");
    const { apiKey, rawKey } = createApiKey({});
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(rawKey).digest("hex");

    expect(getApiKeyByHash(hash)?.id).toBe(apiKey.id);
    expect(getApiKeyByHash("deadbeef")).toBeNull();
  });
});

describe("revokeApiKey", () => {
  it("deactivates the key and reports the change", async () => {
    const { createApiKey, getApiKeyByHash, revokeApiKey } = await import("./api-keys.js");
    const { apiKey, rawKey } = createApiKey({});
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(rawKey).digest("hex");

    expect(revokeApiKey(apiKey.id)).toBe(true);
    expect(getApiKeyByHash(hash)?.active).toBe(false);
  });

  it("returns false for an unknown id", async () => {
    const { revokeApiKey } = await import("./api-keys.js");
    expect(revokeApiKey("missing")).toBe(false);
  });
});

describe("touchApiKey", () => {
  it("sets last_used_at on the key", async () => {
    const { createApiKey, getApiKeyByHash, touchApiKey } = await import("./api-keys.js");
    const { apiKey, rawKey } = createApiKey({});
    expect(apiKey.lastUsedAt).toBeNull();
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(rawKey).digest("hex");

    touchApiKey(apiKey.id);
    const touched = getApiKeyByHash(hash);
    expect(touched?.lastUsedAt).not.toBeNull();
    expect(new Date(touched!.lastUsedAt!).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("listApiKeys", () => {
  it("lists keys newest-first", async () => {
    const { createApiKey, listApiKeys } = await import("./api-keys.js");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const first = createApiKey({}).apiKey;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = createApiKey({}).apiKey;

    const keys = listApiKeys();
    expect(keys.map((k) => k.id)).toEqual([second.id, first.id]);
  });
});
