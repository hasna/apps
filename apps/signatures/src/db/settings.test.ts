import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";

// Override the database path to use in-memory for tests
process.env["SIGNATURES_DB_PATH"] = ":memory:";

// Import after setting env
const { getSetting, setSetting, deleteSetting, getAllSettings } = await import("./settings.js");

describe("settings", () => {
  test("setSetting and getSetting roundtrip", () => {
    setSetting("test_key", "test_value");
    expect(getSetting("test_key")).toBe("test_value");
  });

  test("getSetting returns null for missing key", () => {
    expect(getSetting("nonexistent_key_xyz")).toBeNull();
  });

  test("setSetting overwrites existing value", () => {
    setSetting("update_key", "first");
    setSetting("update_key", "second");
    expect(getSetting("update_key")).toBe("second");
  });

  test("deleteSetting removes the key", () => {
    setSetting("delete_me", "value");
    deleteSetting("delete_me");
    expect(getSetting("delete_me")).toBeNull();
  });

  test("getAllSettings returns all keys", () => {
    setSetting("bulk_a", "1");
    setSetting("bulk_b", "2");
    const all = getAllSettings();
    expect(all["bulk_a"]).toBe("1");
    expect(all["bulk_b"]).toBe("2");
  });
});
