import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { IdempotencyConflictError, addAssetToProfile, createConfig, executeIdempotentRequest, getProfileAssetBindingsPage, getProfileConfigBindingsPage, listConfigIdentitiesPage, listConfigsPage, listMachinesPage, listProfilesPage, listSnapshotsPage, resolveProfileForMachineRead, setProfileAssetBinding, setProfileConfigBinding, updateConfig } from "./cloud-store.js";

interface ExecutedStatement {
  sql: string;
  params: readonly unknown[];
}

const CONFIG_ROW = {
  id: "config-id",
  name: "Demo",
  slug: "demo",
  kind: "file",
  category: "rules",
  agent: "global",
  target_path: null,
  outputs: [],
  format: "text",
  content: "hello",
  description: null,
  tags: [],
  is_template: false,
  version: 1,
  created_at: new Date("2026-07-29T00:00:00Z"),
  updated_at: new Date("2026-07-29T00:00:00Z"),
  synced_at: null,
};

function recordingClient(configRows: Array<typeof CONFIG_ROW>): {
  client: TypedQueryClient;
  executed: ExecutedStatement[];
} {
  const executed: ExecutedStatement[] = [];
  let configRead = 0;
  const client = {
    async get(sql: string) {
      if (sql.includes("SELECT id FROM configs WHERE slug")) return null;
      if (sql.includes("SELECT * FROM configs")) {
        return configRows[Math.min(configRead++, configRows.length - 1)] ?? null;
      }
      throw new Error(`Unexpected get query: ${sql}`);
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      executed.push({ sql, params });
    },
  } as unknown as TypedQueryClient;
  return { client, executed };
}

const PROFILE_ROW = {
  id: "macos-profile",
  name: "macos-profile",
  slug: "macos-profile",
  description: null,
  selectors: { os: ["macos"] },
  variables: {},
  created_at: "2026-07-29T00:00:00Z",
  updated_at: "2026-07-29T00:00:00Z",
};

type ProfileRowFixture = Omit<typeof PROFILE_ROW, "selectors"> & {
  selectors: { os?: string[]; arch?: string[]; hostnames?: string[] };
};

function profileClient(profileRows: ProfileRowFixture[]): TypedQueryClient {
  const client = {
    async get(sql: string) {
      if (sql.includes("COUNT(*) AS total FROM profiles")) return { total: profileRows.length };
      throw new Error(`Unexpected get query: ${sql}`);
    },
    async many(sql: string) {
      if (sql.includes("SELECT * FROM profiles ORDER BY id LIMIT")) return profileRows;
      throw new Error(`Unexpected many query: ${sql}`);
    },
    async query() {
      throw new Error("Unexpected query call");
    },
    async one() {
      throw new Error("Unexpected one call");
    },
    async execute() {
      throw new Error("Unexpected execute call");
    },
  } as unknown as TypedQueryClient;
  return client;
}

function profilePageClient(
  pages: Array<{ total: number; cursor: number; rows: ProfileRowFixture[] }>,
): { client: TypedQueryClient; countReads: () => number } {
  let pageIndex = 0;
  let pending: { total: number; cursor: number; rows: ProfileRowFixture[] } | null = null;
  const client = {
    async get(sql: string) {
      if (!sql.includes("COUNT(*) AS total FROM profiles")) throw new Error(`Unexpected get query: ${sql}`);
      pending = pages[pageIndex] ?? pages.at(-1) ?? null;
      if (!pending) throw new Error("No profile page fixture remains");
      pageIndex += 1;
      return { total: pending.total };
    },
    async many(sql: string, params: readonly unknown[] = []) {
      if (!sql.includes("SELECT * FROM profiles ORDER BY id LIMIT")) throw new Error(`Unexpected many query: ${sql}`);
      if (!pending) throw new Error("Profile rows were read without a count");
      expect(params[1]).toBe(pending.cursor);
      const rows = pending.rows;
      pending = null;
      return rows;
    },
  } as unknown as TypedQueryClient;
  return { client, countReads: () => pageIndex };
}

describe("cloud profile resolution paging consistency", () => {
  const hostnameProfile = {
    ...PROFILE_ROW,
    id: "profile-a",
    name: "hostname-specific",
    slug: "hostname-specific",
    selectors: { hostnames: ["station06"] },
  };
  const osProfile = {
    ...PROFILE_ROW,
    id: "profile-b",
    name: "os-specific",
    slug: "os-specific",
    selectors: { os: ["macos"] },
  };

  test("uses one repeatable-read snapshot so same-count replacement cannot return a deleted profile", async () => {
    const insertedProfile = {
      ...PROFILE_ROW,
      id: "profile-c",
      name: "inserted-arch-profile",
      slug: "inserted-arch-profile",
      selectors: {},
    };
    const transactionEvents: string[] = [];
    let baseReads = 0;
    let transactionCalls = 0;
    const staleBaseClient = {
      async get(sql: string) {
        baseReads += 1;
        if (sql.includes("COUNT(*) AS total FROM profiles")) return { total: 2 };
        throw new Error(`Unexpected base get query: ${sql}`);
      },
      async many(sql: string, params: readonly unknown[] = []) {
        baseReads += 1;
        if (!sql.includes("SELECT * FROM profiles ORDER BY id LIMIT")) {
          throw new Error(`Unexpected base many query: ${sql}`);
        }
        return Number(params[1]) === 0 ? [hostnameProfile] : [insertedProfile];
      },
      async transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        const snapshotRows = [osProfile, insertedProfile];
        const snapshotClient = {
          async execute(sql: string) {
            transactionEvents.push(sql);
          },
          async get(sql: string) {
            transactionEvents.push(sql);
            if (sql.includes("COUNT(*) AS total FROM profiles")) return { total: snapshotRows.length };
            throw new Error(`Unexpected snapshot get query: ${sql}`);
          },
          async many(sql: string, params: readonly unknown[] = []) {
            transactionEvents.push(sql);
            if (!sql.includes("SELECT * FROM profiles ORDER BY id LIMIT")) {
              throw new Error(`Unexpected snapshot many query: ${sql}`);
            }
            const limit = Number(params[0]);
            const cursor = Number(params[1]);
            return snapshotRows.slice(cursor, cursor + limit);
          },
        } as unknown as TypedQueryClient;
        return fn(snapshotClient);
      },
    } as unknown as TypedQueryClient;

    const resolution = await resolveProfileForMachineRead(
      staleBaseClient,
      { hostname: "station06", os: "Darwin", arch: "arm64" },
      { limit: 1 },
    );

    expect(transactionCalls).toBe(1);
    expect(baseReads).toBe(0);
    expect(transactionEvents[0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(resolution.profile?.id).toBe("profile-b");
    expect(resolution.profile?.id).not.toBe("profile-a");
    expect(resolution).toMatchObject({
      scanned: 2,
      total: 2,
      batch_limit: 1,
      source_bounded: true,
      complete: true,
      truncated: false,
    });
  });

  test("retries the whole scan after total drift and never returns a profile deleted between pages", async () => {
    const { client, countReads } = profilePageClient([
      { total: 2, cursor: 0, rows: [hostnameProfile] },
      { total: 1, cursor: 1, rows: [] },
      { total: 1, cursor: 0, rows: [osProfile] },
    ]);

    const resolution = await resolveProfileForMachineRead(
      client,
      { hostname: "station06", os: "Darwin", arch: "arm64" },
      { limit: 1 },
    );

    expect(resolution.profile?.id).toBe("profile-b");
    expect(resolution).toMatchObject({
      scanned: 1,
      total: 1,
      batch_limit: 1,
      source_bounded: true,
      complete: true,
      truncated: false,
    });
    expect(countReads()).toBe(3);
  });

  test("retries an omitted page once and fails closed when the scan remains incomplete", async () => {
    const { client, countReads } = profilePageClient([
      { total: 2, cursor: 0, rows: [hostnameProfile] },
      { total: 2, cursor: 1, rows: [] },
      { total: 2, cursor: 0, rows: [hostnameProfile] },
      { total: 2, cursor: 1, rows: [] },
    ]);

    await expect(resolveProfileForMachineRead(
      client,
      { hostname: "station06", os: "Darwin", arch: "arm64" },
      { limit: 1 },
    )).rejects.toThrow(/changed while paging|did not advance/);
    expect(countReads()).toBe(4);
  });

  test("retries duplicate pages once and fails closed when immutable id ordering does not stabilize", async () => {
    const { client, countReads } = profilePageClient([
      { total: 2, cursor: 0, rows: [hostnameProfile] },
      { total: 2, cursor: 1, rows: [hostnameProfile] },
      { total: 2, cursor: 0, rows: [hostnameProfile] },
      { total: 2, cursor: 1, rows: [hostnameProfile] },
    ]);

    await expect(resolveProfileForMachineRead(
      client,
      { hostname: "station06", os: "Darwin", arch: "arm64" },
      { limit: 1 },
    )).rejects.toThrow(/duplicate identity profile-a/);
    expect(countReads()).toBe(4);
  });

  test("preserves selector specificity and bounded metadata after a stable immutable-id scan", async () => {
    const { client } = profilePageClient([
      { total: 2, cursor: 0, rows: [hostnameProfile] },
      { total: 2, cursor: 1, rows: [osProfile] },
    ]);

    const resolution = await resolveProfileForMachineRead(
      client,
      { hostname: "station06", os: "Darwin", arch: "arm64" },
      { limit: 1 },
    );

    expect(resolution.profile?.id).toBe("profile-a");
    expect(resolution).toMatchObject({ scanned: 2, total: 2, batch_limit: 1, complete: true, truncated: false });
  });
});

describe("cloud profile resolution (os-family aliasing)", () => {
  test("selector os:[\"macos\"] resolves a machine reporting os=\"Darwin\"", async () => {
    const client = profileClient([PROFILE_ROW]);
    const resolution = await resolveProfileForMachineRead(client, {
      hostname: "mbp-station01",
      os: "Darwin",
      arch: "arm64",
    });
    expect(resolution.profile?.id).toBe("macos-profile");
  });

  test("selector os:[\"windows\"] does not resolve a machine reporting os=\"Darwin\"", async () => {
    const client = profileClient([{ ...PROFILE_ROW, id: "windows-profile", name: "windows-profile", slug: "windows-profile", selectors: { os: ["windows"] } }]);
    const resolution = await resolveProfileForMachineRead(client, {
      hostname: "mbp-station01",
      os: "Darwin",
      arch: "arm64",
    });
    expect(resolution.profile).toBeNull();
  });
});

describe("cloud config snapshots", () => {
  test("creates a config and its version 1 snapshot in one statement", async () => {
    const { client, executed } = recordingClient([CONFIG_ROW]);

    await createConfig(client, { name: "Demo", category: "rules", content: "hello" });

    expect(executed).toHaveLength(1);
    expect(executed[0]!.sql).toContain("WITH inserted_config AS");
    expect(executed[0]!.sql).toContain("INSERT INTO config_snapshots");
    expect(executed[0]!.params[9]).toBe("hello");
    expect(executed[0]!.params[13]).toBeString();
  });

  test("updates a config and snapshots the resulting version in one statement", async () => {
    const updatedRow = { ...CONFIG_ROW, content: "updated", version: 2 };
    const { client, executed } = recordingClient([CONFIG_ROW, updatedRow]);

    const updated = await updateConfig(client, CONFIG_ROW.id, { content: "updated" });

    expect(updated).toMatchObject({ content: "updated", version: 2 });
    expect(executed).toHaveLength(1);
    expect(executed[0]!.sql).toContain("WITH updated_config AS");
    expect(executed[0]!.sql).toContain("INSERT INTO config_snapshots");
    expect(executed[0]!.sql).toContain("RETURNING id, content, version");
  });
});


describe("cloud idempotency receipts", () => {
  interface Receipt {
    request_sha256: string;
    response_status: number | null;
    response_body: unknown;
  }

  function receiptClient() {
    const receipts = new Map<string, Receipt>();
    const tx = {
      async query(sql: string, params: readonly unknown[] = []) {
        if (!sql.includes("INSERT INTO instruction_idempotency_receipts")) {
          throw new Error(`Unexpected query: ${sql}`);
        }
        const identity = params.slice(0, 3).join("|");
        if (receipts.has(identity)) return { rows: [], rowCount: 0 };
        receipts.set(identity, {
          request_sha256: String(params[3]),
          response_status: null,
          response_body: null,
        });
        return { rows: [{ inserted: true }], rowCount: 1 };
      },
      async get(sql: string, params: readonly unknown[] = []) {
        if (!sql.includes("FROM instruction_idempotency_receipts")) {
          throw new Error(`Unexpected get: ${sql}`);
        }
        return receipts.get(params.slice(0, 3).join("|")) ?? null;
      },
      async execute(sql: string, params: readonly unknown[] = []) {
        if (sql.includes("CREATE TABLE") || sql.includes("CREATE INDEX")) return;
        if (!sql.includes("UPDATE instruction_idempotency_receipts")) {
          throw new Error(`Unexpected execute: ${sql}`);
        }
        const identity = params.slice(0, 3).join("|");
        const receipt = receipts.get(identity)!;
        receipt.response_status = Number(params[4]);
        receipt.response_body = JSON.parse(String(params[5]));
      },
    };
    const client = {
      ...tx,
      async transaction<T>(fn: (transaction: typeof tx) => Promise<T>): Promise<T> {
        return fn(tx);
      },
    } as unknown as TypedQueryClient & { transaction<T>(fn: (transaction: TypedQueryClient) => Promise<T>): Promise<T> };
    return { client, receipts };
  }

  test("replays one durable response for a duplicate retry without executing the write twice", async () => {
    const { client } = receiptClient();
    let writes = 0;
    const input = {
      principal: "instructions|tenant:-|agent:codex|kid:writer-key",
      operation: "POST /v1/configs",
      key: "retry-key-1",
      body: { category: "rules", content: "same", name: "Demo" },
    };

    const first = await executeIdempotentRequest(client, input, async () => {
      writes += 1;
      return { status: 201, body: { config: { id: "config-1" } } };
    });
    const retry = await executeIdempotentRequest(client, input, async () => {
      writes += 1;
      return { status: 201, body: { config: { id: "config-2" } } };
    });

    expect(writes).toBe(1);
    expect(first).toEqual({ status: 201, body: { config: { id: "config-1" } }, replayed: false });
    expect(retry).toEqual({ status: 201, body: { config: { id: "config-1" } }, replayed: true });
  });

  test("rejects reuse of one principal/operation/key for a different JSON body", async () => {
    const { client } = receiptClient();
    const common = {
      principal: "instructions|tenant:-|agent:codex|kid:writer-key",
      operation: "POST /v1/profiles",
      key: "retry-key-2",
    };
    await executeIdempotentRequest(client, { ...common, body: { name: "One" } }, async () => ({
      status: 201,
      body: { profile: { id: "profile-1" } },
    }));

    await expect(executeIdempotentRequest(client, { ...common, body: { name: "Two" } }, async () => ({
      status: 201,
      body: { profile: { id: "profile-2" } },
    }))).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});

describe("cloud collection reads are source bounded", () => {
  test("config, snapshot, and machine pages issue LIMIT/OFFSET and exact count queries", async () => {
    const calls: Array<{ kind: "get" | "many"; sql: string; params: readonly unknown[] }> = [];
    const client = {
      async get(sql: string, params: readonly unknown[] = []) {
        calls.push({ kind: "get", sql, params });
        if (sql.includes("SELECT * FROM configs WHERE")) return CONFIG_ROW;
        return { total: 5 };
      },
      async many(sql: string, params: readonly unknown[] = []) {
        calls.push({ kind: "many", sql, params });
        if (sql.includes("config_snapshots")) return [{
          id: "snapshot-1", config_id: CONFIG_ROW.id, content: "hello", version: 1,
          created_at: new Date("2026-07-29T00:00:00Z"),
        }];
        if (sql.includes("machines")) return [{
          id: "machine-1", hostname: "station06", os: "darwin", arch: "arm64",
          last_applied_at: null, created_at: new Date("2026-07-29T00:00:00Z"),
        }];
        return [CONFIG_ROW];
      },
    } as unknown as TypedQueryClient;

    expect(await listConfigsPage(client, {}, { limit: 2, cursor: 4 })).toMatchObject({ total: 5, limit: 2, cursor: 4 });
    expect(await listSnapshotsPage(client, CONFIG_ROW.id, { limit: 2, cursor: 4 })).toMatchObject({ total: 5, limit: 2, cursor: 4 });
    expect(await listMachinesPage(client, { limit: 2, cursor: 4 })).toMatchObject({ total: 5, limit: 2, cursor: 4 });

    const boundedReads = calls.filter((call) => call.kind === "many");
    expect(boundedReads).toHaveLength(3);
    for (const call of boundedReads) {
      expect(call.sql).toContain("LIMIT");
      expect(call.sql).toContain("OFFSET");
      expect(call.params.slice(-2)).toEqual([2, 4]);
    }
  });
});

describe("cloud metadata-only identity pages", () => {
  test("selects only allowlisted identity columns for configs, profiles, and machines", async () => {
    const selects: string[] = [];
    const client = {
      async get(sql: string) {
        if (sql.includes("COUNT")) return { total: 0 };
        throw new Error(`Unexpected get: ${sql}`);
      },
      async many(sql: string) {
        selects.push(sql);
        return [];
      },
    } as unknown as TypedQueryClient;

    const module = await import("./cloud-store.js");
    await module.listConfigIdentitiesPage(client, { limit: 10, cursor: 0 });
    await module.listProfileIdentitiesPage(client, { limit: 10, cursor: 0 });
    await module.listMachineIdentitiesPage(client, { limit: 10, cursor: 0 });

    expect(selects).toHaveLength(3);
    expect(selects[0]).not.toContain("content");
    expect(selects[0]).not.toContain("target_path");
    expect(selects[0]).not.toContain("outputs");
    expect(selects[0]).not.toContain("description");
    expect(selects[1]).not.toContain("selectors");
    expect(selects[1]).not.toContain("variables");
    for (const sql of selects) {
      expect(sql).not.toContain("SELECT *");
      expect(sql).toContain("LIMIT");
      expect(sql).toContain("OFFSET");
    }
  });
});


describe("cloud bounded-read correctness", () => {
  test("config identity pages apply the same filters as full config pages", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const client = {
      async get(sql: string, params: readonly unknown[] = []) {
        calls.push({ sql, params });
        return { total: 0 };
      },
      async many(sql: string, params: readonly unknown[] = []) {
        calls.push({ sql, params });
        return [];
      },
    } as unknown as TypedQueryClient;

    await listConfigIdentitiesPage(
      client,
      { category: "rules", agent: "codex", kind: "file", search: "needle" } as never,
      { limit: 7, cursor: 9 },
    );

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).toContain("category = $1");
      expect(call.sql).toContain("agent = $2");
      expect(call.sql).toContain("kind = $3");
      expect(call.sql).toContain("name ILIKE $4");
      expect(call.params.slice(0, 4)).toEqual(["rules", "codex", "file", "%needle%"]);
    }
    expect(calls[1]!.params.slice(-2)).toEqual([7, 9]);
  });

  test("full config, profile, and machine pages order only by immutable ids", async () => {
    const selects: string[] = [];
    const client = {
      async get() { return { total: 0 }; },
      async many(sql: string) { selects.push(sql); return []; },
    } as unknown as TypedQueryClient;

    await listConfigsPage(client);
    await listProfilesPage(client);
    await listMachinesPage(client);

    expect(selects).toHaveLength(3);
    for (const sql of selects) expect(sql).toMatch(/ORDER BY (?:c\.)?id LIMIT/);
    expect(selects.join("\n")).not.toContain("ORDER BY category");
    expect(selects.join("\n")).not.toContain("ORDER BY name");
    expect(selects.join("\n")).not.toContain("ORDER BY last_applied_at");
  });

  test("profile binding pages are bounded and mutation reads fetch only the changed row", async () => {
    const calls: Array<{ kind: string; sql: string; params: readonly unknown[] }> = [];
    const profile = { ...PROFILE_ROW, selectors: {}, variables: {} };
    const binding = {
      schema: "hasna.instructions.profile-config-binding/v1",
      activation: { mode: "always" }, required: true, fallback: "fail",
    };
    const asset = {
      schema: "hasna.instructions.profile-asset-binding/v1",
      assetKey: "review-skill", kind: "skill", enabled: true, required: true,
      selector: { provider: "codex", versionRange: ">=0.147.0", surface: "cli", scope: "session" },
      source: { kind: "skill", locator: "config://config-id@1", digest: `sha256:${"0".repeat(64)}`, immutable: true, allowed: true },
      destination: { strategy: "emit-file", root: "target-home", relativePath: "skills/review/SKILL.md" },
      uninstall: "remove-managed", rollback: "snapshot",
    };
    const client = {
      async get(sql: string, params: readonly unknown[] = []) {
        calls.push({ kind: "get", sql, params });
        if (sql.includes("FROM profiles")) return profile;
        if (sql.includes("COUNT(*)")) return { total: 1 };
        if (sql.includes("FROM profile_configs")) return { profile_id: profile.id, config_id: CONFIG_ROW.id, sort_order: 0, binding };
        if (sql.includes("FROM profile_assets")) return { profile_id: profile.id, source_config_id: CONFIG_ROW.id, sort_order: 0, binding: asset };
        if (sql.includes("FROM configs")) return CONFIG_ROW;
        throw new Error(`Unexpected get: ${sql}`);
      },
      async many(sql: string, params: readonly unknown[] = []) {
        calls.push({ kind: "many", sql, params });
        return [];
      },
      async query(sql: string, params: readonly unknown[] = []) {
        calls.push({ kind: "query", sql, params });
        return { rows: [], rowCount: 1 };
      },
      async execute(sql: string, params: readonly unknown[] = []) {
        calls.push({ kind: "execute", sql, params });
      },
    } as unknown as TypedQueryClient;

    await getProfileConfigBindingsPage(client, profile.id, { limit: 3, cursor: 4 });
    await getProfileAssetBindingsPage(client, profile.id, { limit: 5, cursor: 6 });
    await setProfileConfigBinding(client, profile.id, CONFIG_ROW.id, binding as never);
    await addAssetToProfile(client, profile.id, CONFIG_ROW.id, asset as never);
    await setProfileAssetBinding(client, profile.id, asset.assetKey, asset as never);

    const pageReads = calls.filter((call) => call.kind === "many");
    expect(pageReads).toHaveLength(2);
    expect(pageReads[0]!.sql).toContain("LIMIT $2 OFFSET $3");
    expect(pageReads[0]!.params.slice(-2)).toEqual([3, 4]);
    expect(pageReads[1]!.sql).toContain("LIMIT $2 OFFSET $3");
    expect(pageReads[1]!.params.slice(-2)).toEqual([5, 6]);

    const directConfigReads = calls.filter((call) => call.kind === "get" && call.sql.includes("FROM profile_configs") && !call.sql.includes("COUNT(*)"));
    const directAssetReads = calls.filter((call) => call.kind === "get" && call.sql.includes("FROM profile_assets") && !call.sql.includes("COUNT(*)") && !call.sql.includes("MAX(sort_order)"));
    expect(directConfigReads).toHaveLength(1);
    expect(directConfigReads[0]!.sql).toContain("config_id = $2");
    expect(directAssetReads).toHaveLength(2);
    for (const call of directAssetReads) expect(call.sql).toContain("asset_key = $2");
  });
});
