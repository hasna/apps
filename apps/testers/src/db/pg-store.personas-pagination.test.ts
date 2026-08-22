/**
 * Regression test for todos e920ef6a: the hosted PG path of listPersonas never
 * implemented offset. The pg-store built `... ORDER BY created_at DESC LIMIT n`
 * with no OFFSET clause and its filter type accepted no `offset`, so a client
 * paging at offset >= 100 received the same first 100 rows forever. The local
 * SQLite store (personas.ts) supports limit+offset; the PG path must match.
 *
 * Uses a fake PgExecutor shim (explicitly supported by the vendored storage
 * kit — "tests can substitute a lightweight shim without pulling in a live
 * Postgres") that applies `ORDER BY created_at DESC LIMIT n OFFSET m`
 * semantics from the SQL text and records the SQL it received.
 */
import { describe, expect, test } from "bun:test";

import { wrapExecutor, type PgExecutor } from "../generated/storage-kit/query.js";
import { listPersonas } from "./pg-store.js";

/** Simulate PG semantics for the personas table from the SQL text. */
function personasShim(rows: Record<string, unknown>[]) {
  const sqlLog: string[] = [];
  const sorted = [...rows].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  const executor: PgExecutor = {
    async query<T extends Record<string, unknown>>(
      sql: string,
    ): Promise<{ rows: T[]; rowCount: number | null }> {
      sqlLog.push(sql);
      const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] ?? rows.length);
      const offset = Number(sql.match(/OFFSET (\d+)/)?.[1] ?? 0);
      const slice = sorted.slice(offset, offset + limit);
      return { rows: slice as T[], rowCount: slice.length };
    },
  };
  return { db: wrapExecutor(executor), sqlLog };
}

function personaFixture(i: number) {
  const iso = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 1000).toISOString();
  return {
    id: `persona-${i}`,
    short_id: `P${i}`,
    project_id: null,
    name: `Persona ${i}`,
    description: "",
    role: "user",
    instructions: "",
    traits: "[]",
    goals: "[]",
    behaviors: "[]",
    expertise_level: "intermediate",
    demographics: "{}",
    pain_points: "[]",
    metadata: "{}",
    enabled: true,
    version: 1,
    created_at: iso,
    updated_at: iso,
  };
}

describe("listPersonas (pg path) limit and offset pagination", () => {
  test("offset pages beyond the first 100 rows and reaches the SQL", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => personaFixture(i));
    const { db, sqlLog } = personasShim(rows);

    const page1 = await listPersonas(db, { limit: 100 });
    const page2 = await listPersonas(db, { limit: 100, offset: 100 });

    expect(page1).toHaveLength(100);
    expect(page2).toHaveLength(50);
    const page1Ids = new Set(page1.map((p) => p.id));
    expect(page2.some((p) => page1Ids.has(p.id))).toBe(false);
    // newest first: page1 = persona-149..persona-50, page2 = persona-49..persona-0
    expect(page1[0]!.id).toBe("persona-149");
    expect(page2[0]!.id).toBe("persona-49");
    expect(sqlLog[1]).toContain("OFFSET 100");
  });

  test("offset 0 and omitted offset behave identically", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => personaFixture(i));
    const { db, sqlLog } = personasShim(rows);

    const noOffset = await listPersonas(db, { limit: 100 });
    const offsetZero = await listPersonas(db, { limit: 100, offset: 0 });

    expect(noOffset.map((p) => p.id)).toEqual(offsetZero.map((p) => p.id));
    expect(sqlLog[1]).toContain("OFFSET 0");
  });

  test("negative offset is clamped to 0", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => personaFixture(i));
    const { db, sqlLog } = personasShim(rows);

    const page = await listPersonas(db, { limit: 2, offset: -5 });
    expect(page).toHaveLength(2);
    expect(page[0]!.id).toBe("persona-2");
    expect(sqlLog[0]).toContain("OFFSET 0");
  });
});
