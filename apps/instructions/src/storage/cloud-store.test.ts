import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { createConfig, resolveProfileForMachineRead, updateConfig } from "./cloud-store.js";

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

function profileClient(profileRows: Array<typeof PROFILE_ROW>): TypedQueryClient {
  const client = {
    async get(sql: string) {
      if (sql.includes("COUNT(*) AS total FROM profiles")) return { total: profileRows.length };
      throw new Error(`Unexpected get query: ${sql}`);
    },
    async many(sql: string) {
      if (sql.includes("SELECT * FROM profiles ORDER BY name LIMIT")) return profileRows;
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
