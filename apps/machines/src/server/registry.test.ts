import { describe, expect, test } from "bun:test";
import { MachineRegistry, RegistryValidationError } from "./registry.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

type Row = Record<string, unknown>;

/**
 * Minimal in-memory fake of the vendored kit's TypedQueryClient that understands
 * exactly the queries MachineRegistry issues. Keeps the CRUD/validation/mapping
 * logic under test without a live Postgres.
 */
function makeFakeClient(): TypedQueryClient {
  const store = new Map<string, Row>();

  function nowRow(input: Partial<Row>, existing?: Row): Row {
    const created = existing?.created_at ?? new Date().toISOString();
    return { created_at: created, updated_at: new Date().toISOString(), ...input };
  }

  async function run(sql: string, params: readonly unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("INSERT INTO machines")) {
      const [id, friendly, platform, arch, status, labels, metadata] = params as unknown[];
      const existing = store.get(String(id));
      const row = nowRow(
        {
          id: String(id),
          friendly_name: friendly ?? null,
          platform: platform ?? null,
          arch: arch ?? null,
          status: status ?? "unknown",
          labels: String(labels),
          metadata: String(metadata),
        },
        existing,
      );
      store.set(String(id), row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith("SELECT * FROM machines WHERE id")) {
      const row = store.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (s.startsWith("SELECT * FROM machines")) {
      return { rows: [...store.values()], rowCount: store.size };
    }
    if (s.startsWith("UPDATE machines SET")) {
      const id = String(params[params.length - 1]);
      const existing = store.get(id);
      if (!existing) return { rows: [], rowCount: 0 };
      const updated = { ...existing, updated_at: new Date().toISOString() };
      store.set(id, updated);
      return { rows: [updated], rowCount: 1 };
    }
    if (s.startsWith("DELETE FROM machines")) {
      const existed = store.delete(String(params[0]));
      return { rows: [], rowCount: existed ? 1 : 0 };
    }
    if (s.startsWith("SELECT count(*)")) {
      return { rows: [{ c: store.size }], rowCount: 1 };
    }
    if (s.includes("agent_heartbeats")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected SQL in fake: ${s}`);
  }

  const client = {
    async query(sql: string, params?: readonly unknown[]) {
      const r = await run(sql, params);
      return { rows: r.rows, rowCount: r.rowCount };
    },
    async many(sql: string, params?: readonly unknown[]) {
      return (await run(sql, params)).rows;
    },
    async get(sql: string, params?: readonly unknown[]) {
      return (await run(sql, params)).rows[0] ?? null;
    },
    async one(sql: string, params?: readonly unknown[]) {
      const rows = (await run(sql, params)).rows;
      if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
      return rows[0];
    },
    async execute(sql: string, params?: readonly unknown[]) {
      await run(sql, params);
    },
  };
  return client as unknown as TypedQueryClient;
}

describe("MachineRegistry", () => {
  test("upsert then get roundtrips and parses jsonb columns", async () => {
    const reg = new MachineRegistry(makeFakeClient());
    const created = await reg.upsert({
      id: "spark01",
      friendlyName: "Spark One",
      platform: "linux",
      arch: "arm64",
      status: "online",
      labels: { tier: "control-plane" },
      metadata: { region: "us-east-1" },
    });
    expect(created.id).toBe("spark01");
    expect(created.status).toBe("online");
    expect(created.labels).toEqual({ tier: "control-plane" });

    const fetched = await reg.get("spark01");
    expect(fetched?.friendlyName).toBe("Spark One");
    expect(fetched?.metadata).toEqual({ region: "us-east-1" });
  });

  test("list returns registered machines", async () => {
    const reg = new MachineRegistry(makeFakeClient());
    await reg.upsert({ id: "a" });
    await reg.upsert({ id: "b" });
    const all = await reg.list();
    expect(all.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  test("update returns null for unknown machine", async () => {
    const reg = new MachineRegistry(makeFakeClient());
    const result = await reg.update("ghost", { status: "offline" });
    expect(result).toBeNull();
  });

  test("update patches an existing machine", async () => {
    const reg = new MachineRegistry(makeFakeClient());
    await reg.upsert({ id: "m1", status: "online" });
    const updated = await reg.update("m1", { status: "draining" });
    expect(updated?.id).toBe("m1");
  });

  test("remove reports whether a row was deleted", async () => {
    const reg = new MachineRegistry(makeFakeClient());
    await reg.upsert({ id: "gone" });
    expect(await reg.remove("gone")).toBe(true);
    expect(await reg.remove("gone")).toBe(false);
  });

  test("empty id is rejected with a validation error", async () => {
    const reg = new MachineRegistry(makeFakeClient());
    await expect(reg.upsert({ id: "  " })).rejects.toBeInstanceOf(RegistryValidationError);
    await expect(reg.get("")).rejects.toBeInstanceOf(RegistryValidationError);
  });
});
