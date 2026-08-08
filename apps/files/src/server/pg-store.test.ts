/**
 * Regression coverage for the server-side page cap.
 *
 * `GET /v1/files` returns a bare JSON array with no `total`, no `has_more` and
 * no `next_cursor`, so a caller has exactly one signal about coverage: the row
 * count it asked for. Clamping that count server-side and answering 200 makes
 * "the source has 500 files" and "the source has 18,212 files and you were
 * handed the first 500" print identically. Measured on the live store: a
 * `--limit 25000` read of one source returned 500 rows while the same source
 * reported 18,212 in `files stats` — 17,712 ids invisible behind rc=0.
 *
 * `pg-store` takes an injectable `TypedQueryClient`, so the emitted SQL is
 * assertable without a live Postgres (the vendored kit documents the shim as a
 * supported test seam). Every case below pins the LIMIT that actually reaches
 * SQL, because that is the number the clamp used to rewrite silently.
 */
import { describe, expect, test } from "bun:test";
import { wrapExecutor, type PgExecutor } from "../generated/storage-kit/query.js";
import {
  getAgentActivity,
  getFileHistory,
  getSessionActivity,
  listConflicts,
  listFiles,
  MAX_PAGE_SIZE,
} from "./pg-store.js";

/** A `TypedQueryClient` shim that records SQL and answers with synthetic rows. */
function recordingClient(rowCount = 0) {
  const sql: string[] = [];
  const params: readonly unknown[][] = [];
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    id: `f_${i}`,
    source_id: "src_1",
    machine_id: "m_1",
    path: `/p/${i}`,
    name: `n${i}`,
    ext: "pdf",
    size: 1,
    mime: "application/pdf",
    status: "active",
    indexed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  }));
  const executor: PgExecutor = {
    async query(text: string, values: readonly unknown[] = []) {
      sql.push(text);
      params.push(values);
      // Tag lookups and every non-row-returning statement answer empty; only the
      // primary SELECT hands back the synthetic page.
      if (/^SELECT \* FROM (files|agent_activity)/i.test(text.trim())) {
        return { rows: rows as never[], rowCount: rows.length };
      }
      return { rows: [] as never[], rowCount: 0 };
    },
  };
  return { client: wrapExecutor(executor), sql, params };
}

/** The LIMIT clause that actually reached SQL, or null when none did. */
function emittedLimit(sql: string[]): number | null {
  for (const text of sql) {
    const m = /\bLIMIT\s+(\d+)\b/.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

describe("pg-store page cap — a bounded read must never masquerade as a complete one", () => {
  // ── must fire ────────────────────────────────────────────────────────────
  // These describe the defect. Before the fix `listFiles` resolved happily and
  // rewrote the caller's 25000 to 500 on the way to SQL.

  test("listFiles refuses a limit above the cap instead of silently truncating", async () => {
    const { client, sql } = recordingClient(500);

    await expect(listFiles(client, { limit: 25_000 })).rejects.toThrow(/limit/i);
    // The refusal must precede the query: a rejected read runs no SQL at all,
    // so there is no truncated page for a caller to mistake for a population.
    expect(emittedLimit(sql)).toBeNull();
  });

  test("the refusal names the cap and the requested value so a caller can paginate", async () => {
    const { client } = recordingClient();

    const error = await listFiles(client, { limit: 25_000 }).then(
      () => null,
      (e: unknown) => e as Error & { max_limit?: number; requested_limit?: number },
    );

    expect(error).not.toBeNull();
    expect(error!.message).toContain(String(MAX_PAGE_SIZE));
    expect(error!.message).toContain("25000");
    expect(error!.message).toMatch(/offset/i);
    // Structured fields so the HTTP layer can answer 400 without parsing prose.
    expect(error!.max_limit).toBe(MAX_PAGE_SIZE);
    expect(error!.requested_limit).toBe(25_000);
  });

  test("one past the cap is refused — the boundary is exact, not approximate", async () => {
    const { client, sql } = recordingClient();
    await expect(listFiles(client, { limit: MAX_PAGE_SIZE + 1 })).rejects.toThrow(/limit/i);
    expect(emittedLimit(sql)).toBeNull();
  });

  test("a non-positive or fractional limit is refused, not coerced to something else", async () => {
    // `Math.max(0, 1)` used to turn a requested 0 into 1 row, and a fractional
    // limit reached SQL as-is. Both are the same defect: the answer describes a
    // page the caller never asked for.
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      const { client, sql } = recordingClient();
      await expect(listFiles(client, { limit: bad })).rejects.toThrow(/limit/i);
      expect(emittedLimit(sql)).toBeNull();
    }
  });

  test("listConflicts and the activity queries share the cap and the refusal", async () => {
    // Same clamp, three more call sites. Fixing only the one that was reported
    // leaves the identical silent truncation live on the others.
    for (const call of [
      (c: ReturnType<typeof recordingClient>["client"]) => listConflicts(c, "src_1", 25_000),
      (c: ReturnType<typeof recordingClient>["client"]) => getFileHistory(c, "f_1", { limit: 25_000 }),
      (c: ReturnType<typeof recordingClient>["client"]) => getAgentActivity(c, "ag_1", { limit: 25_000 }),
      (c: ReturnType<typeof recordingClient>["client"]) => getSessionActivity(c, "s_1", { limit: 25_000 }),
    ]) {
      const { client, sql } = recordingClient();
      await expect(call(client)).rejects.toThrow(/limit/i);
      expect(emittedLimit(sql)).toBeNull();
    }
  });

  // ── must stay silent ─────────────────────────────────────────────────────
  // These pass before and after the fix. Without them the change above is
  // indistinguishable from a guard that refuses everything.

  test("a limit at the cap is served unchanged", async () => {
    const { client, sql } = recordingClient(MAX_PAGE_SIZE);
    const out = await listFiles(client, { limit: MAX_PAGE_SIZE });
    expect(emittedLimit(sql)).toBe(MAX_PAGE_SIZE);
    expect(out).toHaveLength(MAX_PAGE_SIZE);
  });

  test("a limit below the cap reaches SQL exactly as asked", async () => {
    for (const limit of [1, 50, 400, 499]) {
      const { client, sql } = recordingClient(0);
      await listFiles(client, { limit });
      expect(emittedLimit(sql)).toBe(limit);
    }
  });

  test("an omitted limit still defaults to 50 rather than erroring", async () => {
    const { client, sql } = recordingClient(0);
    await listFiles(client, {});
    expect(emittedLimit(sql)).toBe(50);
  });

  test("offset is preserved so the cap is paginable rather than a hard ceiling", async () => {
    const { client, sql } = recordingClient(0);
    await listFiles(client, { limit: MAX_PAGE_SIZE, offset: 17_500 });
    expect(sql.some((s) => /LIMIT 500 OFFSET 17500/.test(s))).toBe(true);
  });

  test("pages have a total order when more than 500 rows share one indexed_at", async () => {
    // The synthetic rows intentionally all share indexed_at. Offset pagination
    // is data-safe only if the query adds a unique tie-breaker after it.
    const { client, sql } = recordingClient(MAX_PAGE_SIZE + 1);
    await listFiles(client, { limit: MAX_PAGE_SIZE });
    expect(sql.some((s) => /ORDER BY indexed_at DESC, id DESC LIMIT 500 OFFSET 0/.test(s))).toBe(true);
  });

  test("the cap is one named constant, not three magic numbers", () => {
    expect(MAX_PAGE_SIZE).toBe(500);
  });
});

describe("pg-store extension filters", () => {
  test("list accepts an extension without a leading dot", async () => {
    const { client, params } = recordingClient();

    await listFiles(client, { ext: "pdf" });

    expect(params[0]).toContain(".pdf");
  });

  test("list preserves an already dotted extension", async () => {
    const { client, params } = recordingClient();

    await listFiles(client, { ext: ".pdf" });

    expect(params[0]).toContain(".pdf");
  });

  test("metadata search shares the same extension normalization", async () => {
    const { client, params } = recordingClient();

    await listFiles(client, { q: "entrepreneur", ext: "PDF" });

    expect(params[0]).toContain(".pdf");
    expect(params[0]).toContain("%entrepreneur%");
  });

  test("omitting the extension does not add an extension parameter", async () => {
    const { client, params } = recordingClient();

    await listFiles(client, { q: "entrepreneur" });

    expect(params[0]).not.toContain(".pdf");
  });
});
