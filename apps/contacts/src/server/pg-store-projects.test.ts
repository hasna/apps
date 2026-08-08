import { describe, expect, test } from "bun:test";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { ContactsPgStore } from "./pg-store.js";

type Call = { sql: string; params: unknown[]; transaction: boolean };

function projectShim(): {
  client: PoolQueryClient;
  calls: Call[];
  transactionCount: () => number;
} {
  const calls: Call[] = [];
  let transactions = 0;
  let inTransaction = false;

  const record = (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params: [...params], transaction: inTransaction });
  };

  const typed: TypedQueryClient = {
    async query<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      const rowCount = sql.includes("DELETE FROM contact_projects") ? 1 : 0;
      return { rows: [] as T[], rowCount };
    },
    async many<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("SELECT project_id")) {
        return [{ project_id: "project-a" }, { project_id: "project-b" }] as T[];
      }
      if (sql.includes("SELECT contact_id")) {
        return [{ contact_id: "contact-1" }, { contact_id: "contact-2" }] as T[];
      }
      return [] as T[];
    },
    async get<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      return null as T | null;
    },
    async one<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      throw new Error("not used");
    },
    async execute(sql: string, params?: readonly unknown[]) {
      record(sql, params);
    },
  };

  const client = {
    ...typed,
    pool: {} as never,
    async transaction<T>(fn: (client: TypedQueryClient) => Promise<T>) {
      transactions++;
      inTransaction = true;
      try {
        return await fn(typed);
      } finally {
        inTransaction = false;
      }
    },
    async close() {},
  } as PoolQueryClient;

  return { client, calls, transactionCount: () => transactions };
}

describe("ContactsPgStore contact project parity", () => {
  test("attaches idempotently and detaches with parameterized SQL", async () => {
    const { client, calls } = projectShim();
    const store = new ContactsPgStore(client);

    await store.linkContactToProject("contact-1", "project-a");
    expect(await store.unlinkContactFromProject("contact-1", "project-a")).toBe(true);

    expect(calls[0]).toEqual({
      sql: expect.stringContaining("ON CONFLICT (contact_id, project_id) DO NOTHING"),
      params: ["contact-1", "project-a"],
      transaction: false,
    });
    expect(calls[1]).toEqual({
      sql: expect.stringContaining("DELETE FROM contact_projects WHERE contact_id = $1 AND project_id = $2"),
      params: ["contact-1", "project-a"],
      transaction: false,
    });
  });

  test("lists both directions in deterministic order", async () => {
    const { client, calls } = projectShim();
    const store = new ContactsPgStore(client);

    expect(await store.getContactProjectIds("contact-1")).toEqual(["project-a", "project-b"]);
    expect(await store.listContactIdsByProject("project-a")).toEqual(["contact-1", "contact-2"]);

    expect(calls[0]?.sql).toContain("ORDER BY project_id ASC");
    expect(calls[0]?.params).toEqual(["contact-1"]);
    expect(calls[1]?.sql).toContain("ORDER BY contact_id ASC");
    expect(calls[1]?.params).toEqual(["project-a"]);
  });

  test("replaces memberships atomically and deduplicates repeated project ids", async () => {
    const { client, calls, transactionCount } = projectShim();
    const store = new ContactsPgStore(client);

    await store.setContactProjects("contact-1", ["project-b", "project-a", "project-b"]);

    expect(transactionCount()).toBe(1);
    expect(calls).toEqual([
      {
        sql: expect.stringContaining("DELETE FROM contact_projects WHERE contact_id = $1"),
        params: ["contact-1"],
        transaction: true,
      },
      {
        sql: expect.stringContaining("ON CONFLICT (contact_id, project_id) DO NOTHING"),
        params: ["contact-1", ["project-b", "project-a"]],
        transaction: true,
      },
    ]);
  });
});
