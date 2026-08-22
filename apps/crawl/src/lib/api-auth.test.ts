import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { createHash } from "crypto";

let dbPath: string;

beforeEach(() => {
  dbPath = `/tmp/crawl-apiauth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  Bun.env.CRAWL_DB_PATH = dbPath;
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
});

describe("hashApiKey", () => {
  it("produces the sha256 hex digest of the raw key", async () => {
    const { hashApiKey } = await import("./api-auth.js");
    const raw = "wc_live_testkey";
    expect(hashApiKey(raw)).toBe(createHash("sha256").update(raw).digest("hex"));
  });

  it("is deterministic for the same input", async () => {
    const { hashApiKey } = await import("./api-auth.js");
    expect(hashApiKey("same")).toBe(hashApiKey("same"));
  });
});

describe("validateApiKey", () => {
  it("returns null for an empty raw key", async () => {
    const { validateApiKey } = await import("./api-auth.js");
    expect(validateApiKey("")).toBeNull();
    expect(validateApiKey("   ")).toBeNull();
    expect(validateApiKey(null as unknown as string)).toBeNull();
  });

  it("returns null for an unknown key hash", async () => {
    const { validateApiKey } = await import("./api-auth.js");
    expect(validateApiKey("wc_live_doesnotexist")).toBeNull();
  });

  it("returns null for a revoked (inactive) key even when the hash matches", async () => {
    const { createApiKey, revokeApiKey } = await import("../db/api-keys.js");
    const { validateApiKey } = await import("./api-auth.js");
    const { rawKey, apiKey } = createApiKey({ name: "revoked" });
    expect(revokeApiKey(apiKey.id)).toBe(true);
    expect(validateApiKey(rawKey)).toBeNull();
  });

  it("returns null for an expired key", async () => {
    const { createApiKey } = await import("../db/api-keys.js");
    const { validateApiKey } = await import("./api-auth.js");
    const { rawKey } = createApiKey({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(validateApiKey(rawKey)).toBeNull();
  });

  it("returns the key and touches last_used_at for a valid active key", async () => {
    const { createApiKey, getApiKeyByHash } = await import("../db/api-keys.js");
    const { validateApiKey } = await import("./api-auth.js");
    const { createHash } = await import("crypto");
    const { rawKey, apiKey } = createApiKey({ name: "valid" });
    const hash = createHash("sha256").update(rawKey).digest("hex");

    expect(apiKey.lastUsedAt).toBeNull();
    const validated = validateApiKey(rawKey);
    expect(validated).not.toBeNull();
    expect(validated?.id).toBe(apiKey.id);

    const touched = getApiKeyByHash(hash);
    expect(touched?.lastUsedAt).not.toBeNull();
  });
});

describe("extractBearerToken", () => {
  it("returns the token for a Bearer header", async () => {
    const { extractBearerToken } = await import("./api-auth.js");
    const req = new Request("http://localhost/v1/crawls", {
      headers: { Authorization: "Bearer abc123" },
    });
    expect(extractBearerToken(req)).toBe("abc123");
  });

  it("accepts a lowercase authorization header", async () => {
    const { extractBearerToken } = await import("./api-auth.js");
    const req = new Request("http://localhost/v1/crawls", {
      headers: { authorization: "Bearer lower-token" },
    });
    expect(extractBearerToken(req)).toBe("lower-token");
  });

  it("returns null when no Authorization header is present", async () => {
    const { extractBearerToken } = await import("./api-auth.js");
    expect(extractBearerToken(new Request("http://localhost/"))).toBeNull();
  });

  it("returns null for a non-Bearer scheme", async () => {
    const { extractBearerToken } = await import("./api-auth.js");
    const req = new Request("http://localhost/", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractBearerToken(req)).toBeNull();
  });

  it("returns null when the Bearer value is empty or whitespace-only", async () => {
    const { extractBearerToken } = await import("./api-auth.js");
    const empty = new Request("http://localhost/", {
      headers: { Authorization: "Bearer " },
    });
    const spaces = new Request("http://localhost/", {
      headers: { Authorization: "Bearer    " },
    });
    expect(extractBearerToken(empty)).toBeNull();
    expect(extractBearerToken(spaces)).toBeNull();
  });

  it("trims surrounding whitespace from the token", async () => {
    const { extractBearerToken } = await import("./api-auth.js");
    const req = new Request("http://localhost/", {
      headers: { Authorization: "Bearer  tok  " },
    });
    expect(extractBearerToken(req)).toBe("tok");
  });
});
