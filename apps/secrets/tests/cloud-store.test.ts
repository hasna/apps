import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  APP_NAME,
  DEFAULT_PORT,
  bootstrapCloudEnv,
  resolvePort,
  resolveSigningSecret,
} from "../src/server/cloud-env.js";
import {
  _resetCloudMasterKey,
  decryptValue,
  encryptValue,
  getCloudMasterKey,
  isEncrypted,
  VaultDecryptionError,
} from "../src/server/cloud-crypto.js";
import { CloudSecretsStore } from "../src/server/cloud-store.js";

class FakeDb {
  getResults: unknown[] = [];
  manyResults: unknown[][] = [];
  executed: Array<{ sql: string; params?: readonly unknown[] }> = [];
  getCalls: Array<{ sql: string; params?: readonly unknown[] }> = [];
  manyCalls: Array<{ sql: string; params?: readonly unknown[] }> = [];

  async get<T>(sql: string, params?: readonly unknown[]): Promise<T | null> {
    this.getCalls.push({ sql, params });
    return (this.getResults.shift() ?? null) as T | null;
  }

  async many<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    this.manyCalls.push({ sql, params });
    return (this.manyResults.shift() ?? []) as T[];
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    this.executed.push({ sql, params });
  }
}

const now = "2026-01-02T03:04:05.000Z";
const TEST_TENANT = "11111111-2222-4333-8444-555555555555";

function secretRow(overrides: Record<string, unknown> = {}) {
  return {
    key: "demo/key",
    value: encryptValue("value"),
    type: "api_key",
    label: "Demo",
    expires_at: "2027-01-01T00:00:00.000Z",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function vaultRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    kind: "login",
    title: "Example",
    subtitle: "person@example.test",
    domains: JSON.stringify(["example.test", 3]),
    tags: JSON.stringify(["work", null]),
    favorite: 1,
    data: encryptValue(JSON.stringify({ username: "person", password: "secret" })),
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.HASNA_SECRETS_MASTER_KEY = "cloud-store-test-key";
  _resetCloudMasterKey();
});

afterEach(() => {
  delete process.env.HASNA_SECRETS_MASTER_KEY;
  delete process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS;
  delete process.env.SECRETS_MASTER_KEY;
  delete process.env.SECRETS_PREVIOUS_MASTER_KEYS;
  _resetCloudMasterKey();
});

describe("cloud environment bridge", () => {
  it("maps ECS env without overwriting canonical or alias values — and never synthesises a storage mode", () => {
    expect(APP_NAME).toBe("secrets");
    expect(DEFAULT_PORT).toBe(8080);
    const env = {
      DATABASE_URL: "postgres://ecs",
      API_KEY_SIGNING_SECRET: "ecs-signing",
    } as NodeJS.ProcessEnv;
    bootstrapCloudEnv(env);
    expect(env).toMatchObject({
      HASNA_SECRETS_DATABASE_URL: "postgres://ecs",
      HASNA_SECRETS_API_SIGNING_KEY: "ecs-signing",
    });
    // Deployment modes no longer exist: the bridge must NOT write a retired
    // storage-mode variable into the environment.
    expect(env.HASNA_SECRETS_STORAGE_MODE).toBeUndefined();
    expect(env.SECRETS_STORAGE_MODE).toBeUndefined();

    const configured = {
      DATABASE_URL: "postgres://ignored",
      HASNA_SECRETS_DATABASE_URL: "postgres://canonical",
      SECRETS_STORAGE_MODE: "local",
      HASNA_SECRETS_API_SIGNING_KEY: "canonical-signing",
      API_KEY_SIGNING_SECRET: "ignored",
    } as NodeJS.ProcessEnv;
    bootstrapCloudEnv(configured);
    expect(configured.HASNA_SECRETS_DATABASE_URL).toBe("postgres://canonical");
    // A pre-existing retired variable is left untouched (the kit/db resolver
    // rejects it as a hard error downstream; the bridge never repairs it).
    expect(configured.HASNA_SECRETS_STORAGE_MODE).toBeUndefined();
    expect(configured.SECRETS_STORAGE_MODE).toBe("local");
    expect(configured.HASNA_SECRETS_API_SIGNING_KEY).toBe("canonical-signing");
  });

  it("resolves ports and signing-secret precedence and rejects invalid input", () => {
    expect(resolvePort({})).toBe(8080);
    expect(resolvePort({ PORT: "9000", HASNA_SECRETS_SERVE_PORT: "8000" })).toBe(9000);
    expect(resolvePort({ HASNA_SECRETS_SERVE_PORT: "7000" })).toBe(7000);
    for (const value of ["nope", "0", "65536", "Infinity"]) {
      expect(() => resolvePort({ PORT: value })).toThrow("Invalid PORT");
    }

    expect(resolveSigningSecret({ HASNA_SECRETS_API_SIGNING_KEY: " first ", API_KEY_SIGNING_SECRET: "second" })).toBe("first");
    expect(resolveSigningSecret({ API_KEY_SIGNING_SECRET: " second " })).toBe("second");
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: " legacy " })).toBe("legacy");
    expect(() => resolveSigningSecret({})).toThrow("requires an API-key signing secret");
  });
});

describe("cloud crypto key formats", () => {
  it("accepts base64 and hex keys, caches the result, and handles legacy values", () => {
    const bytes = Buffer.alloc(32, 7);
    const fromBase64 = getCloudMasterKey({ HASNA_SECRETS_MASTER_KEY: bytes.toString("base64") });
    expect(fromBase64).toEqual(bytes);
    expect(getCloudMasterKey({ HASNA_SECRETS_MASTER_KEY: "different" })).toBe(fromBase64);

    _resetCloudMasterKey();
    expect(getCloudMasterKey({ SECRETS_MASTER_KEY: bytes.toString("hex") })).toEqual(bytes);
    expect(decryptValue("legacy plaintext")).toBe("legacy plaintext");
    expect(isEncrypted(42 as unknown as string)).toBe(false);
    // Every failure inside decryptValue is deliberately rethrown as the typed
    // VaultDecryptionError so OpenSSL's low-level authentication text cannot reach
    // a caller. "Malformed encrypted value" is the internal cause and is not
    // observable from outside, so this asserts the boundary error and its stable
    // code rather than a message that the wrapper is designed to hide.
    expect(() => decryptValue("enc:v1:no-separator")).toThrow(VaultDecryptionError);
    try {
      decryptValue("enc:v1:no-separator");
      throw new Error("expected decryptValue to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VaultDecryptionError);
      expect((error as VaultDecryptionError).code).toBe("VAULT_DECRYPTION_FAILED");
    }
  });
});

describe("cloud Postgres store", () => {
  it("sets, reads, lists, searches, and deletes secrets", async () => {
    const db = new FakeDb();
    const store = new CloudSecretsStore(db as any);
    const row = secretRow();
    // Versioned set flow: baseline value read, v1-exists check, current version
    // row (hash differs → creates version 2), existing created_at, then getSecret.
    db.getResults.push(
      { value: encryptValue("value") }, // baseline: the existing secrets row
      null, // baseline: version 1 already present? no → backfill runs
      { version: 1, value_hash: "0".repeat(64), value_blob: encryptValue("old"), value_length: 3, change_kind: "migration", reason: "baseline current value", label: null, source_version: null, batch_id: null, provider_expires_at: null, created_at: now, created_by: "system:migration" },
      { created_at: "2020-01-01" },
      row,
    );
    const saved = await store.setSecret("demo/key", "value", "api_key", "Demo", row.expires_at, "agent-1", TEST_TENANT);
    expect(saved).toMatchObject({ key: "demo/key", value: "value", label: "Demo", expires_at: row.expires_at });
    expect(saved.version).toBe(2);
    expect(saved.unchanged).toBe(false);
    expect(db.executed.some((entry) => entry.sql.includes("ON CONFLICT(key)"))).toBe(true);
    const secretInsert = db.executed.find((entry) => entry.sql.includes("INSERT INTO secrets"))!;
    expect(secretInsert.sql).toContain("tenant_id");
    expect(secretInsert.params?.at(-1)).toBe(TEST_TENANT);
    const versionInsert = [...db.executed].reverse().find((entry) => entry.sql.includes("INSERT INTO secret_versions"))!;
    expect(versionInsert.params?.at(1)).toBe(2);
    expect(versionInsert.params?.at(5)).toBe("set");
    expect(db.executed.filter((entry) => entry.sql.includes("audit_log"))).toHaveLength(2);
    expect(db.executed.filter((entry) => entry.sql.includes("audit_log")).every((entry) => entry.params?.at(-1) === TEST_TENANT)).toBe(true);

    db.getResults.push(null);
    expect(await store.getSecret("missing", "agent-1", TEST_TENANT)).toBeUndefined();

    db.manyResults.push([row, secretRow({ key: "plain", label: null, expires_at: null })]);
    expect(await store.listSecretMetadata()).toEqual([
      expect.objectContaining({ key: "demo/key", label: "Demo" }),
      expect.not.objectContaining({ label: expect.anything() }),
    ]);
    db.manyResults.push([row]);
    expect(await store.listSecretMetadata("demo/")).toHaveLength(1);
    expect(db.manyCalls.at(-1)?.params).toEqual(["demo/%", "demo/"]);
    db.manyResults.push([row]);
    expect(await store.searchSecretMetadata("key")).toHaveLength(1);
    expect(db.manyCalls.at(-1)?.params).toEqual(["%key%"]);

    db.manyResults.push([]);
    expect(await store.deleteSecret("missing", "agent-1", TEST_TENANT)).toBe(false);
    db.manyResults.push([{ key: "demo/key" }]);
    expect(await store.deleteSecret("demo/key", "agent-1", TEST_TENANT)).toBe(true);
  });

  it("reads an x_-prefixed legacy-key row beside an active-key sibling", async () => {
    const activeKey = Buffer.alloc(32, 9).toString("base64");
    const legacyKey = Buffer.alloc(32, 10).toString("base64");

    _resetCloudMasterKey();
    const bareStored = encryptValue("synthetic-bare-value", {
      HASNA_SECRETS_MASTER_KEY: activeKey,
    });
    _resetCloudMasterKey();
    const prefixedStored = encryptValue("synthetic-prefixed-value", {
      SECRETS_MASTER_KEY: legacyKey,
    });

    process.env.HASNA_SECRETS_MASTER_KEY = activeKey;
    process.env.SECRETS_MASTER_KEY = legacyKey;
    _resetCloudMasterKey();

    const db = new FakeDb();
    db.getResults.push(
      {
        key: "synthetic/x/live/bare_name",
        value: bareStored,
        type: "other",
        label: null,
        expires_at: null,
        created_at: now,
        updated_at: now,
      },
      {
        key: "synthetic/x/live/x_prefixed_name",
        value: prefixedStored,
        type: "other",
        label: null,
        expires_at: null,
        created_at: now,
        updated_at: now,
      },
    );
    const store = new CloudSecretsStore(db as any);

    expect(await store.getSecret("synthetic/x/live/bare_name", "synthetic-agent", TEST_TENANT))
      .toMatchObject({ key: "synthetic/x/live/bare_name", value: "synthetic-bare-value" });
    expect(await store.getSecret("synthetic/x/live/x_prefixed_name", "synthetic-agent", TEST_TENANT))
      .toMatchObject({ key: "synthetic/x/live/x_prefixed_name", value: "synthetic-prefixed-value" });
    expect(db.getCalls.map((call) => call.params)).toEqual([
      ["synthetic/x/live/bare_name"],
      ["synthetic/x/live/x_prefixed_name"],
    ]);

    _resetCloudMasterKey();
    const newlyStored = encryptValue("synthetic-new-value", process.env);
    _resetCloudMasterKey();
    expect(decryptValue(newlyStored, { HASNA_SECRETS_MASTER_KEY: activeKey }))
      .toBe("synthetic-new-value");
  });

  it("rewrites a secret read with a previous rotation key", async () => {
    const previousKey = Buffer.alloc(32, 11).toString("base64");
    const activeKey = Buffer.alloc(32, 12).toString("base64");

    _resetCloudMasterKey();
    const stored = encryptValue("synthetic-rotated-value", {
      HASNA_SECRETS_MASTER_KEY: previousKey,
    });
    process.env.HASNA_SECRETS_MASTER_KEY = activeKey;
    process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS = JSON.stringify([previousKey]);
    _resetCloudMasterKey();

    const db = new FakeDb();
    db.getResults.push({
      key: "synthetic/rotation/live/value",
      value: stored,
      type: "other",
      label: null,
      expires_at: null,
      created_at: now,
      updated_at: now,
    });
    const entry = await new CloudSecretsStore(db as any).getSecret(
      "synthetic/rotation/live/value",
      "synthetic-agent",
      TEST_TENANT,
    );

    expect(entry).toMatchObject({
      key: "synthetic/rotation/live/value",
      value: "synthetic-rotated-value",
    });
    const rewrite = db.executed.find((call) => call.sql.includes("UPDATE secrets SET value"));
    expect(rewrite?.params?.[1]).toBe("synthetic/rotation/live/value");
    expect(rewrite?.params?.[2]).toBe(stored);
    expect(typeof rewrite?.params?.[0]).toBe("string");
    _resetCloudMasterKey();
    expect(decryptValue(rewrite?.params?.[0] as string, {
      HASNA_SECRETS_MASTER_KEY: activeKey,
    })).toBe("synthetic-rotated-value");
  });

  it("validates, normalizes, stores, reads, lists, searches, and deletes vault items", async () => {
    const db = new FakeDb();
    const store = new CloudSecretsStore(db as any);
    await expect(store.setVaultItem({ kind: "wrong" as any, title: "x", data: {} }, "actor", TEST_TENANT)).rejects.toThrow(
      "Invalid vault item kind",
    );
    await expect(store.setVaultItem({ kind: "login", title: "  ", data: {} }, "actor", TEST_TENANT)).rejects.toThrow(
      "title is required",
    );

    const row = vaultRow();
    db.getResults.push({ created_at: "2020-01-01" }, row);
    const saved = await store.setVaultItem({
      id: " item-1 ",
      kind: "login",
      title: " Example ",
      subtitle: " person ",
      domains: [" https://www.Example.test/path ", "example.test", "%"],
      tags: [" work ", "work", ""],
      favorite: true,
      data: { username: "person", password: "secret" },
    }, "actor", TEST_TENANT);
    expect(saved.data.password).toBe("secret");
    const insert = db.executed.find((entry) => entry.sql.includes("INSERT INTO vault_items"))!;
    expect(insert.params?.[4]).toBe(JSON.stringify(["example.test", "%"]));
    expect(insert.params?.[5]).toBe(JSON.stringify(["work"]));
    expect(insert.sql).toContain("tenant_id");
    expect(insert.params?.at(-1)).toBe(TEST_TENANT);

    db.getResults.push(null, vaultRow({ data: undefined }));
    expect(await store.getVaultItem("missing", "actor", TEST_TENANT)).toBeUndefined();
    expect(await store.getVaultItem("missing-data", "actor", TEST_TENANT)).toBeUndefined();

    db.manyResults.push([
      row,
      vaultRow({ id: "bad-json", subtitle: null, domains: "not-json", tags: "{}", favorite: false }),
    ]);
    const all = await store.listVaultItemMetadata();
    expect(all[0]).toMatchObject({ subtitle: "person@example.test", domains: ["example.test"], tags: ["work"], favorite: true });
    expect(all[1]).toMatchObject({ domains: [], tags: [], favorite: false });
    db.manyResults.push([row]);
    expect(await store.listVaultItemMetadata("login")).toHaveLength(1);
    db.manyResults.push([row]);
    expect(await store.searchVaultItemMetadata("example")).toHaveLength(1);

    db.manyResults.push([]);
    expect(await store.deleteVaultItem("missing", "actor", TEST_TENANT)).toBe(false);
    db.manyResults.push([{ id: "item-1" }]);
    expect(await store.deleteVaultItem("item-1", "actor", TEST_TENANT)).toBe(true);

    db.getResults.push(null, vaultRow({ id: "generated" }));
    const generated = await store.setVaultItem({ kind: "custom", title: "Generated" }, "actor", TEST_TENANT);
    expect(generated.id).toBe("generated");
  });

  it("supports users, audit queries, and feedback", async () => {
    const db = new FakeDb();
    const store = new CloudSecretsStore(db as any);
    const user = { id: "u1", name: "User", type: "agent", registered_at: now, last_seen: now };
    db.getResults.push(user);
    expect(await store.registerUser("u1", "User", "agent", TEST_TENANT)).toEqual(user);
    const userInsert = db.executed.find((entry) => entry.sql.includes("INSERT INTO users"))!;
    expect(userInsert.sql).toContain("tenant_id");
    expect(userInsert.params?.at(-1)).toBe(TEST_TENANT);

    db.manyResults.push([user], [user], [], [{ id: "u1" }]);
    expect(await store.listUsers("agent")).toEqual([user]);
    expect(await store.listUsers()).toEqual([user]);
    expect(await store.deleteUser("none")).toBe(false);
    expect(await store.deleteUser("u1")).toBe(true);

    const audit = { id: 1, action: "get", key: "demo/key", agent: "u1", timestamp: now };
    db.manyResults.push([audit], [audit]);
    expect(await store.getAuditLog("demo/key", 2)).toEqual([audit]);
    expect(await store.getAuditLog(undefined)).toEqual([audit]);

    await store.addFeedback("message", undefined, "general", "1.0.0", TEST_TENANT);
    expect(db.executed.at(-1)?.sql).toContain("tenant_id");
    expect(db.executed.at(-1)?.params?.at(-1)).toBe(TEST_TENANT);
    expect(db.executed.at(-1)?.params?.[2]).toBeNull();
  });

  it("rejects tenant-bearing writes before database mutation when tenant context is absent", async () => {
    const db = new FakeDb();
    const store = new CloudSecretsStore(db as any);

    await expect((store.addFeedback as any)("message", undefined, "general", "1.0.0", ""))
      .rejects.toThrow("Tenant context is required");

    expect(db.executed).toHaveLength(0);
  });
});
