import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, resetDb } from "../src/db.js";
import { LocalStore } from "../src/store/index.js";

// Exercise the LocalStore transport directly. Each method re-resolves the db via
// getDb(), so a single instance honours the per-test OPEN_SECRETS_DB + resetDb().
const store = new LocalStore();
const setSecret = store.setSecret.bind(store);
const getSecret = store.getSecret.bind(store);
const deleteSecret = store.deleteSecret.bind(store);
const listSecrets = store.listSecrets.bind(store);
const listSecretMetadata = store.listSecretMetadata.bind(store);
const searchSecrets = store.searchSecrets.bind(store);
const searchSecretMetadata = store.searchSecretMetadata.bind(store);
const setVaultItem = store.setVaultItem.bind(store);
const getVaultItem = store.getVaultItem.bind(store);
const deleteVaultItem = store.deleteVaultItem.bind(store);
const listVaultItemMetadata = store.listVaultItemMetadata.bind(store);
const searchVaultItemMetadata = store.searchVaultItemMetadata.bind(store);
const matchVaultItemsForUrl = store.matchVaultItemsForUrl.bind(store);
const importSecrets = store.importSecrets.bind(store);
const exportSecrets = store.exportSecrets.bind(store);
const getAuditLog = store.getAuditLog.bind(store);
const pruneExpired = store.pruneExpired.bind(store);
const registerUser = store.registerUser.bind(store);
const listUsers = store.listUsers.bind(store);
const deleteUser = store.deleteUser.bind(store);

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `open-secrets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");
  resetDb();
});

afterEach(async () => {
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  rmSync(testDir, { recursive: true, force: true });
});

describe("setSecret / getSecret", () => {
  it("stores and retrieves a secret", async () => {
    await setSecret("openai/api_key", "sk-test-123", "api_key");
    const entry = await getSecret("openai/api_key");
    expect(entry).toBeDefined();
    expect(entry!.value).toBe("sk-test-123");
    expect(entry!.type).toBe("api_key");
  });

  it("stores with label", async () => {
    await setSecret("gmail/pass", "hunter2", "password", "My Gmail");
    expect((await getSecret("gmail/pass"))!.label).toBe("My Gmail");
  });

  it("stores with TTL", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    await setSecret("token/short", "abc", "token", undefined, future);
    expect((await getSecret("token/short"))!.expires_at).toBe(future);
  });

  it("fails closed for expired or malformed TTL records", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await setSecret("token/expired", "must-not-be-read", "token", undefined, past);
    await setSecret("token/malformed", "also-must-not-be-read", "token");
    getDb().prepare("UPDATE secrets SET expires_at = ? WHERE key = ?").run("not-a-date", "token/malformed");

    expect(await getSecret("token/expired")).toBeUndefined();
    expect(await getSecret("token/malformed")).toBeUndefined();
    expect(await listSecrets("token")).toHaveLength(0);
    expect(await searchSecrets("token/")).toHaveLength(0);
    expect((await exportSecrets(false)).secrets).toEqual({});
    expect(await listSecretMetadata("token")).toHaveLength(2);
  });

  it("updates existing secret preserving created_at", async () => {
    await setSecret("foo/bar", "v1", "other");
    const first = await getSecret("foo/bar")!;
    await new Promise((r) => setTimeout(r, 10));
    await setSecret("foo/bar", "v2", "other");
    const second = await getSecret("foo/bar")!;
    expect(second.value).toBe("v2");
    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at).not.toBe(first.updated_at);
  });

  it("returns undefined for missing key", async () => {
    expect(await getSecret("does/not/exist")).toBeUndefined();
  });
});

describe("deleteSecret", () => {
  it("deletes an existing secret", async () => {
    await setSecret("to/delete", "bye", "other");
    expect(await deleteSecret("to/delete")).toBe(true);
    expect(await getSecret("to/delete")).toBeUndefined();
  });

  it("returns false for missing key", async () => {
    expect(await deleteSecret("not/there")).toBe(false);
  });
});

describe("listSecrets", () => {
  it("lists all secrets", async () => {
    await setSecret("openai/key", "sk-1", "api_key");
    await setSecret("openai/org", "org-1", "other");
    await setSecret("stripe/key", "sk-s", "api_key");
    await setSecret("toplevel", "val", "other");
    expect((await listSecrets()).length).toBe(4);
  });

  it("filters by namespace", async () => {
    await setSecret("openai/key", "sk-1", "api_key");
    await setSecret("openai/org", "org-1", "other");
    await setSecret("stripe/key", "sk-s", "api_key");
    const openai = await listSecrets("openai");
    expect(openai.length).toBe(2);
    expect(openai.every((s) => s.key.startsWith("openai/"))).toBe(true);
  });

  it("returns empty for unknown namespace", async () => {
    await setSecret("openai/key", "sk-1", "api_key");
    expect(await listSecrets("unknown")).toHaveLength(0);
  });
});

describe("listSecretMetadata", () => {
  it("lists metadata without decrypting values", async () => {
    await setSecret("openai/key", "sk-1", "api_key", "OpenAI production key");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "openai/key");

    const results = await listSecretMetadata("openai");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("openai/key");
    expect(results[0].type).toBe("api_key");
    expect("value" in results[0]).toBe(false);
    await expect(listSecrets("openai")).rejects.toThrow("Malformed encrypted value");
  });
});

describe("searchSecrets", () => {
  it("searches by key", async () => {
    await setSecret("openai/api_key", "sk-1", "api_key", "OpenAI production key");
    await setSecret("gmail/password", "pass123", "password");
    expect(await searchSecrets("openai")).toHaveLength(1);
  });

  it("searches by label", async () => {
    await setSecret("openai/api_key", "sk-1", "api_key", "OpenAI production key");
    expect(await searchSecrets("production")).toHaveLength(1);
  });

  it("searches by type", async () => {
    await setSecret("openai/api_key", "sk-1", "api_key");
    await setSecret("gmail/password", "pass123", "password");
    expect(await searchSecrets("password")).toHaveLength(1);
  });

  it("returns empty for no match", async () => {
    await setSecret("openai/api_key", "sk-1", "api_key");
    expect(await searchSecrets("zzznomatch")).toHaveLength(0);
  });
});

describe("searchSecretMetadata", () => {
  it("searches metadata without decrypting values", async () => {
    await setSecret("openai/api_key", "sk-1", "api_key", "OpenAI production key");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "openai/api_key");

    const results = await searchSecretMetadata("production");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("openai/api_key");
    expect(results[0].label).toBe("OpenAI production key");
    expect("value" in results[0]).toBe(false);
    await expect(searchSecrets("production")).rejects.toThrow("Malformed encrypted value");
  });
});

describe("structured vault items", () => {
  it("stores and retrieves an encrypted login item", async () => {
    const item = await setVaultItem({
      kind: "login",
      title: "GitHub",
      subtitle: "dev@example.com",
      domains: ["https://github.com/login"],
      tags: ["work"],
      data: { username: "dev@example.com", password: "pass123" },
    });

    const stored = getDb().prepare("SELECT data FROM vault_items WHERE id = ?").get(item.id) as { data: string };
    expect(stored.data.startsWith("enc:v1:")).toBe(true);

    const fetched = await getVaultItem(item.id)!;
    expect(fetched.kind).toBe("login");
    expect(fetched.domains).toEqual(["github.com"]);
    expect(fetched.data.password).toBe("pass123");
  });

  it("lists metadata without decrypting item payloads", async () => {
    const item = await setVaultItem({
      kind: "address",
      title: "Home",
      domains: ["checkout.example.com"],
      data: { addressLine1: "1 Main St", city: "Paris" },
    });
    getDb()
      .prepare("UPDATE vault_items SET data = ? WHERE id = ?")
      .run("enc:v1:malformed", item.id);

    const metadata = await listVaultItemMetadata("address");
    expect(metadata).toHaveLength(1);
    expect(metadata[0].title).toBe("Home");
    expect("data" in metadata[0]).toBe(false);
    await expect(getVaultItem(item.id)).rejects.toThrow("Malformed encrypted value");
  });

  it("searches item metadata", async () => {
    await setVaultItem({
      kind: "login",
      title: "Stripe dashboard",
      domains: ["dashboard.stripe.com"],
      tags: ["billing"],
      data: { username: "billing@example.com", password: "pass123" },
    });

    expect(await searchVaultItemMetadata("billing")).toHaveLength(1);
    expect(await searchVaultItemMetadata("stripe.com")).toHaveLength(1);
    expect(await searchVaultItemMetadata("unknown")).toHaveLength(0);
  });

  it("matches vault items by exact host and subdomain", async () => {
    const item = await setVaultItem({
      kind: "login",
      title: "GitHub",
      domains: ["github.com"],
      data: { username: "dev@example.com", password: "pass123" },
    });
    await setVaultItem({
      kind: "login",
      title: "Other",
      domains: ["example.com"],
      data: { username: "dev@example.com", password: "pass123" },
    });

    const matches = await matchVaultItemsForUrl("https://www.github.com/settings/profile");
    expect(matches.map((match) => match.id)).toContain(item.id);
    expect(await matchVaultItemsForUrl("https://evilgithub.com")).toHaveLength(0);
  });

  it("deletes vault items", async () => {
    const item = await setVaultItem({
      kind: "secure_note",
      title: "Note",
      data: { body: "secret note" },
    });

    expect(await deleteVaultItem(item.id)).toBe(true);
    expect(await getVaultItem(item.id)).toBeUndefined();
    expect(await deleteVaultItem(item.id)).toBe(false);
  });
});

describe("importSecrets / exportSecrets", () => {
  it("imports multiple entries", async () => {
    const count = await importSecrets([
      { key: "a/b", value: "1", type: "api_key" },
      { key: "c/d", value: "2", type: "password" },
    ]);
    expect(count).toBe(2);
    expect((await getSecret("a/b"))!.value).toBe("1");
  });

  it("exports with values", async () => {
    await setSecret("key/one", "secret!", "token");
    expect((await exportSecrets(false)).secrets["key/one"].value).toBe("secret!");
  });

  it("exports redacted by default", async () => {
    await setSecret("key/one", "secret!", "token");
    const exported = await exportSecrets();
    expect(exported.redacted).toBe(true);
    expect(exported.secrets["key/one"].value).toBe("***REDACTED***");
  });

  it("exports redacted", async () => {
    await setSecret("key/one", "secret!", "token");
    expect((await exportSecrets(true)).secrets["key/one"].value).toBe("***REDACTED***");
  });

  it("exports redacted metadata without decrypting values", async () => {
    await setSecret("key/one", "secret!", "token");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "key/one");

    const exported = await exportSecrets();
    expect(exported.redacted).toBe(true);
    expect(exported.secrets["key/one"].value).toBe("***REDACTED***");
    await expect(exportSecrets(false)).rejects.toThrow("Malformed encrypted value");
  });
});

describe("audit log", () => {
  it("records set and get actions", async () => {
    await setSecret("audit/key", "val", "other");
    await getSecret("audit/key");
    const log = await getAuditLog("audit/key");
    expect(log.some((e) => e.action === "set")).toBe(true);
    expect(log.some((e) => e.action === "get")).toBe(true);
  });

  it("records delete action", async () => {
    await setSecret("audit/del", "val", "other");
    await deleteSecret("audit/del");
    const log = await getAuditLog("audit/del");
    expect(log.some((e) => e.action === "delete")).toBe(true);
  });
});

describe("pruneExpired", () => {
  it("removes expired secrets", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    await setSecret("expired/key", "old", "other", undefined, past);
    await setSecret("valid/key", "new", "other", undefined, future);
    const count = await pruneExpired();
    expect(count).toBe(1);
    expect(await getSecret("expired/key")).toBeUndefined();
    expect(await getSecret("valid/key")).toBeDefined();
  });
});

describe("users", () => {
  it("registers and lists users", async () => {
    await registerUser("agent-1", "My Agent", "agent");
    await registerUser("human-1", "Alice", "human");
    expect((await listUsers()).length).toBe(2);
    expect((await listUsers("agent")).length).toBe(1);
    expect((await listUsers("human"))[0].name).toBe("Alice");
  });

  it("updates on re-register", async () => {
    await registerUser("agent-1", "Old Name", "agent");
    await registerUser("agent-1", "New Name", "agent");
    expect((await listUsers()).length).toBe(1);
    expect((await listUsers())[0].name).toBe("New Name");
  });

  it("deletes a user", async () => {
    await registerUser("to-del", "Delete Me", "human");
    expect(await deleteUser("to-del")).toBe(true);
    expect(await listUsers()).toHaveLength(0);
  });

  it("returns false deleting nonexistent user", async () => {
    expect(await deleteUser("nope")).toBe(false);
  });
});
