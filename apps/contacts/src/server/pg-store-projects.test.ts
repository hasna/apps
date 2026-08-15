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
  const states = new Map<string, { contact_id: string; project_id: string; linked: boolean; revision: number }>();
  const memberships = new Set(["contact-1:project-a", "contact-1:project-b"]);
  const key = (contactId: unknown, projectId: unknown) => `${String(contactId)}:${String(projectId)}`;

  const record = (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params: [...params], transaction: inTransaction });
  };

  const typed: TypedQueryClient = {
    async query<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      const membershipKey = key(params?.[0], params?.[1]);
      const rowCount = sql.includes("DELETE FROM contact_projects") && memberships.delete(membershipKey) ? 1 : 0;
      return { rows: [] as T[], rowCount };
    },
    async many<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("SELECT project_id")) {
        if (!sql.includes("ORDER BY")) {
          const prefix = `${String(params?.[0])}:`;
          return [...memberships]
            .filter((membership) => membership.startsWith(prefix))
            .map((membership) => ({ project_id: membership.slice(prefix.length) })) as T[];
        }
        return [{ project_id: "project-a" }, { project_id: "project-b" }] as T[];
      }
      if (sql.includes("SELECT contact_id")) {
        return [{ contact_id: "contact-1" }, { contact_id: "contact-2" }] as T[];
      }
      return [] as T[];
    },
    async get<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("FROM contact_project_membership_states")) {
        return (states.get(key(params?.[0], params?.[1])) ?? null) as T | null;
      }
      if (sql.includes("SELECT 1 AS present FROM contact_projects")) {
        return (memberships.has(key(params?.[0], params?.[1])) ? { present: 1 } : null) as T | null;
      }
      return null as T | null;
    },
    async one<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      throw new Error("not used");
    },
    async execute(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      const membershipKey = key(params?.[0], params?.[1]);
      if (sql.includes("INSERT INTO contact_project_membership_states")) {
        if (!states.has(membershipKey)) {
          states.set(membershipKey, {
            contact_id: String(params?.[0]),
            project_id: String(params?.[1]),
            linked: Boolean(params?.[2]),
            revision: 0,
          });
        }
      } else if (sql.includes("UPDATE contact_project_membership_states")) {
        states.set(membershipKey, {
          contact_id: String(params?.[0]),
          project_id: String(params?.[1]),
          linked: Boolean(params?.[2]),
          revision: Number(params?.[3]),
        });
      } else if (sql.includes("INSERT INTO contact_projects")) {
        memberships.add(membershipKey);
      } else if (sql.includes("DELETE FROM contact_projects")) {
        memberships.delete(membershipKey);
      }
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
    const { client, calls, transactionCount } = projectShim();
    const store = new ContactsPgStore(client);

    await store.linkContactToProject("contact-1", "project-a");
    expect(await store.unlinkContactFromProject("contact-1", "project-a")).toBe(true);

    expect(transactionCount()).toBe(2);
    expect(calls.some((call) => (
      call.transaction
      && call.sql.includes("UPDATE contact_project_membership_states")
      && call.params[2] === true
    ))).toBe(true);
    expect(calls.some((call) => (
      call.transaction
      && call.sql.includes("UPDATE contact_project_membership_states")
      && call.params[2] === false
    ))).toBe(true);
    expect(calls.some((call) => call.sql.includes("ON CONFLICT (contact_id, project_id) DO NOTHING"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("DELETE FROM contact_projects WHERE contact_id = $1 AND project_id = $2"))).toBe(true);
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
    expect(calls[0]).toEqual({
      sql: expect.stringContaining("SELECT project_id FROM contact_projects"),
      params: ["contact-1"],
      transaction: true,
    });
    expect(calls.filter((call) => call.sql.includes("UPDATE contact_project_membership_states")))
      .toHaveLength(2);
    expect(calls.every((call) => call.transaction)).toBe(true);
  });
});
