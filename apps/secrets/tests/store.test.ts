import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, resetDb } from "../src/db.js";
import {
  setSecret,
  getSecret,
  deleteSecret,
  listSecrets,
  listSecretMetadata,
  searchSecrets,
  searchSecretMetadata,
  setVaultItem,
  getVaultItem,
  deleteVaultItem,
  listVaultItemMetadata,
  searchVaultItemMetadata,
  matchVaultItemsForUrl,
  importSecrets,
  exportSecrets,
  getAuditLog,
  pruneExpired,
  registerUser,
  listUsers,
  deleteUser,
} from "../src/store.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `open-secrets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");
  resetDb();
});

afterEach(() => {
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  rmSync(testDir, { recursive: true, force: true });
});

describe("setSecret / getSecret", () => {
  it("stores and retrieves a secret", () => {
    setSecret("openai/api_key", "sk-test-123", "api_key");
    const entry = getSecret("openai/api_key");
    expect(entry).toBeDefined();
    expect(entry!.value).toBe("sk-test-123");
    expect(entry!.type).toBe("api_key");
  });

  it("stores with label", () => {
    setSecret("gmail/pass", "hunter2", "password", "My Gmail");
    expect(getSecret("gmail/pass")!.label).toBe("My Gmail");
  });

  it("stores with TTL", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    setSecret("token/short", "abc", "token", undefined, future);
    expect(getSecret("token/short")!.expires_at).toBe(future);
  });

  it("updates existing secret preserving created_at", async () => {
    setSecret("foo/bar", "v1", "other");
    const first = getSecret("foo/bar")!;
    await new Promise((r) => setTimeout(r, 10));
    setSecret("foo/bar", "v2", "other");
    const second = getSecret("foo/bar")!;
    expect(second.value).toBe("v2");
    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at).not.toBe(first.updated_at);
  });

  it("returns undefined for missing key", () => {
    expect(getSecret("does/not/exist")).toBeUndefined();
  });
});

describe("deleteSecret", () => {
  it("deletes an existing secret", () => {
    setSecret("to/delete", "bye", "other");
    expect(deleteSecret("to/delete")).toBe(true);
    expect(getSecret("to/delete")).toBeUndefined();
  });

  it("returns false for missing key", () => {
    expect(deleteSecret("not/there")).toBe(false);
  });
});

describe("listSecrets", () => {
  it("lists all secrets", () => {
    setSecret("openai/key", "sk-1", "api_key");
    setSecret("openai/org", "org-1", "other");
    setSecret("stripe/key", "sk-s", "api_key");
    setSecret("toplevel", "val", "other");
    expect(listSecrets().length).toBe(4);
  });

  it("filters by namespace", () => {
    setSecret("openai/key", "sk-1", "api_key");
    setSecret("openai/org", "org-1", "other");
    setSecret("stripe/key", "sk-s", "api_key");
    const openai = listSecrets("openai");
    expect(openai.length).toBe(2);
    expect(openai.every((s) => s.key.startsWith("openai/"))).toBe(true);
  });

  it("returns empty for unknown namespace", () => {
    setSecret("openai/key", "sk-1", "api_key");
    expect(listSecrets("unknown")).toHaveLength(0);
  });
});

describe("listSecretMetadata", () => {
  it("lists metadata without decrypting values", () => {
    setSecret("openai/key", "sk-1", "api_key", "OpenAI production key");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "openai/key");

    const results = listSecretMetadata("openai");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("openai/key");
    expect(results[0].type).toBe("api_key");
    expect("value" in results[0]).toBe(false);
    expect(() => listSecrets("openai")).toThrow("Malformed encrypted value");
  });
});

describe("searchSecrets", () => {
  it("searches by key", () => {
    setSecret("openai/api_key", "sk-1", "api_key", "OpenAI production key");
    setSecret("gmail/password", "pass123", "password");
    expect(searchSecrets("openai")).toHaveLength(1);
  });

  it("searches by label", () => {
    setSecret("openai/api_key", "sk-1", "api_key", "OpenAI production key");
    expect(searchSecrets("production")).toHaveLength(1);
  });

  it("searches by type", () => {
    setSecret("openai/api_key", "sk-1", "api_key");
    setSecret("gmail/password", "pass123", "password");
    expect(searchSecrets("password")).toHaveLength(1);
  });

  it("returns empty for no match", () => {
    setSecret("openai/api_key", "sk-1", "api_key");
    expect(searchSecrets("zzznomatch")).toHaveLength(0);
  });
});

describe("searchSecretMetadata", () => {
  it("searches metadata without decrypting values", () => {
    setSecret("openai/api_key", "sk-1", "api_key", "OpenAI production key");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "openai/api_key");

    const results = searchSecretMetadata("production");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("openai/api_key");
    expect(results[0].label).toBe("OpenAI production key");
    expect("value" in results[0]).toBe(false);
    expect(() => searchSecrets("production")).toThrow("Malformed encrypted value");
  });
});

describe("structured vault items", () => {
  it("stores and retrieves an encrypted login item", () => {
    const item = setVaultItem({
      kind: "login",
      title: "GitHub",
      subtitle: "dev@example.com",
      domains: ["https://github.com/login"],
      tags: ["work"],
      data: { username: "dev@example.com", password: "pass123" },
    });

    const stored = getDb().prepare("SELECT data FROM vault_items WHERE id = ?").get(item.id) as { data: string };
    expect(stored.data.startsWith("enc:v1:")).toBe(true);

    const fetched = getVaultItem(item.id)!;
    expect(fetched.kind).toBe("login");
    expect(fetched.domains).toEqual(["github.com"]);
    expect(fetched.data.password).toBe("pass123");
  });

  it("lists metadata without decrypting item payloads", () => {
    const item = setVaultItem({
      kind: "address",
      title: "Home",
      domains: ["checkout.example.com"],
      data: { addressLine1: "1 Main St", city: "Paris" },
    });
    getDb()
      .prepare("UPDATE vault_items SET data = ? WHERE id = ?")
      .run("enc:v1:malformed", item.id);

    const metadata = listVaultItemMetadata("address");
    expect(metadata).toHaveLength(1);
    expect(metadata[0].title).toBe("Home");
    expect("data" in metadata[0]).toBe(false);
    expect(() => getVaultItem(item.id)).toThrow("Malformed encrypted value");
  });

  it("searches item metadata", () => {
    setVaultItem({
      kind: "login",
      title: "Stripe dashboard",
      domains: ["dashboard.stripe.com"],
      tags: ["billing"],
      data: { username: "billing@example.com", password: "pass123" },
    });

    expect(searchVaultItemMetadata("billing")).toHaveLength(1);
    expect(searchVaultItemMetadata("stripe.com")).toHaveLength(1);
    expect(searchVaultItemMetadata("unknown")).toHaveLength(0);
  });

  it("matches vault items by exact host and subdomain", () => {
    const item = setVaultItem({
      kind: "login",
      title: "GitHub",
      domains: ["github.com"],
      data: { username: "dev@example.com", password: "pass123" },
    });
    setVaultItem({
      kind: "login",
      title: "Other",
      domains: ["example.com"],
      data: { username: "dev@example.com", password: "pass123" },
    });

    const matches = matchVaultItemsForUrl("https://www.github.com/settings/profile");
    expect(matches.map((match) => match.id)).toContain(item.id);
    expect(matchVaultItemsForUrl("https://evilgithub.com")).toHaveLength(0);
  });

  it("deletes vault items", () => {
    const item = setVaultItem({
      kind: "secure_note",
      title: "Note",
      data: { body: "secret note" },
    });

    expect(deleteVaultItem(item.id)).toBe(true);
    expect(getVaultItem(item.id)).toBeUndefined();
    expect(deleteVaultItem(item.id)).toBe(false);
  });
});

describe("importSecrets / exportSecrets", () => {
  it("imports multiple entries", () => {
    const count = importSecrets([
      { key: "a/b", value: "1", type: "api_key" },
      { key: "c/d", value: "2", type: "password" },
    ]);
    expect(count).toBe(2);
    expect(getSecret("a/b")!.value).toBe("1");
  });

  it("exports with values", () => {
    setSecret("key/one", "secret!", "token");
    expect(exportSecrets(false).secrets["key/one"].value).toBe("secret!");
  });

  it("exports redacted by default", () => {
    setSecret("key/one", "secret!", "token");
    const exported = exportSecrets();
    expect(exported.redacted).toBe(true);
    expect(exported.secrets["key/one"].value).toBe("***REDACTED***");
  });

  it("exports redacted", () => {
    setSecret("key/one", "secret!", "token");
    expect(exportSecrets(true).secrets["key/one"].value).toBe("***REDACTED***");
  });

  it("exports redacted metadata without decrypting values", () => {
    setSecret("key/one", "secret!", "token");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "key/one");

    const exported = exportSecrets();
    expect(exported.redacted).toBe(true);
    expect(exported.secrets["key/one"].value).toBe("***REDACTED***");
    expect(() => exportSecrets(false)).toThrow("Malformed encrypted value");
  });
});

describe("audit log", () => {
  it("records set and get actions", () => {
    setSecret("audit/key", "val", "other");
    getSecret("audit/key");
    const log = getAuditLog("audit/key");
    expect(log.some((e) => e.action === "set")).toBe(true);
    expect(log.some((e) => e.action === "get")).toBe(true);
  });

  it("records delete action", () => {
    setSecret("audit/del", "val", "other");
    deleteSecret("audit/del");
    const log = getAuditLog("audit/del");
    expect(log.some((e) => e.action === "delete")).toBe(true);
  });
});

describe("pruneExpired", () => {
  it("removes expired secrets", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    setSecret("expired/key", "old", "other", undefined, past);
    setSecret("valid/key", "new", "other", undefined, future);
    const count = pruneExpired();
    expect(count).toBe(1);
    expect(getSecret("expired/key")).toBeUndefined();
    expect(getSecret("valid/key")).toBeDefined();
  });
});

describe("users", () => {
  it("registers and lists users", () => {
    registerUser("agent-1", "My Agent", "agent");
    registerUser("human-1", "Alice", "human");
    expect(listUsers().length).toBe(2);
    expect(listUsers("agent").length).toBe(1);
    expect(listUsers("human")[0].name).toBe("Alice");
  });

  it("updates on re-register", () => {
    registerUser("agent-1", "Old Name", "agent");
    registerUser("agent-1", "New Name", "agent");
    expect(listUsers().length).toBe(1);
    expect(listUsers()[0].name).toBe("New Name");
  });

  it("deletes a user", () => {
    registerUser("to-del", "Delete Me", "human");
    expect(deleteUser("to-del")).toBe(true);
    expect(listUsers()).toHaveLength(0);
  });

  it("returns false deleting nonexistent user", () => {
    expect(deleteUser("nope")).toBe(false);
  });
});
