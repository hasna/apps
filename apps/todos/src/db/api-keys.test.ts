import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createApiKey, hasActiveApiKeys, listApiKeys, revokeApiKey, verifyApiKey } from "./api-keys.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("API keys", () => {
  it("creates a plaintext key once and stores only a hash/prefix", () => {
    const created = createApiKey({ name: "external app" });
    expect(created.key.startsWith("tdos_")).toBe(true);
    expect(created.record.name).toBe("external app");
    expect(created.record.prefix).toBe(created.key.slice(0, 12));

    const row = getDatabase().query("SELECT key_hash FROM api_keys WHERE id = ?").get(created.record.id) as { key_hash: string };
    expect(row.key_hash).not.toContain(created.key);
    expect(row.key_hash).toHaveLength(64);
  });

  it("verifies active keys and updates last_used_at", () => {
    const created = createApiKey({ name: "mobile app" });
    const verified = verifyApiKey(created.key);
    expect(verified?.id).toBe(created.record.id);
    expect(verifyApiKey("tdos_wrong")).toBeNull();

    const listed = listApiKeys();
    expect(typeof listed[0]!.last_used_at).toBe("string");
  });

  it("tracks whether active generated keys require API auth", () => {
    expect(hasActiveApiKeys()).toBe(false);
    const created = createApiKey({ name: "app" });
    expect(hasActiveApiKeys()).toBe(true);
    revokeApiKey(created.record.id);
    expect(hasActiveApiKeys()).toBe(false);
  });

  it("revokes by prefix without exposing plaintext", () => {
    const created = createApiKey({ name: "desktop app" });
    const revoked = revokeApiKey(created.record.prefix);
    expect(typeof revoked?.revoked_at).toBe("string");
    expect(verifyApiKey(created.key)).toBeNull();
    expect(listApiKeys()).toHaveLength(0);
    expect(listApiKeys({ include_revoked: true })).toHaveLength(1);
  });
});
