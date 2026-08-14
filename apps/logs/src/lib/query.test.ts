import { describe, expect, it } from "bun:test";
import { createTestDb } from "../db/index.ts";
import { ingestBatch } from "./ingest.ts";
import {
  getLogContext,
  searchLogs,
  tailLogs,
  toFtsMatchQuery,
} from "./query.ts";

function seed(db: ReturnType<typeof createTestDb>) {
  ingestBatch(db, [
    {
      level: "error",
      message: "DB connection failed",
      service: "api",
      trace_id: "t1",
    },
    {
      level: "warn",
      message: "Slow query detected",
      service: "api",
      trace_id: "t1",
    },
    { level: "info", message: "User login", service: "auth" },
    { level: "debug", message: "Cache miss", service: "cache" },
    { level: "fatal", message: "Out of memory", service: "worker" },
  ]);
}

describe("searchLogs", () => {
  it("returns all logs without filters", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, {});
    expect(rows.length).toBe(5);
  });

  it("filters by level", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, { level: "error" });
    expect(rows.every((r) => r.level === "error")).toBe(true);
  });

  it("filters by multiple levels", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, { level: ["error", "fatal"] });
    expect(rows).toHaveLength(2);
  });

  it("filters by service", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, { service: "api" });
    expect(rows).toHaveLength(2);
  });

  it("full-text search on message", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, { text: "connection" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain("connection");
  });

  it("full-text search with a hyphenated term (FTS5 syntax char)", () => {
    const db = createTestDb();
    ingestBatch(db, [
      { level: "info", message: "run mcp-qa passed", service: "qa" },
      { level: "info", message: "unrelated entry", service: "other" },
    ]);
    const rows = searchLogs(db, { text: "mcp-qa" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain("mcp-qa");
  });

  it("full-text search with a multi-hyphen identifier", () => {
    const db = createTestDb();
    ingestBatch(db, [
      {
        level: "info",
        message: "session mcplocal-1783534937-32229 started",
        service: "qa",
      },
      { level: "info", message: "noise", service: "other" },
    ]);
    const rows = searchLogs(db, { text: "mcplocal-1783534937-32229" });
    expect(rows).toHaveLength(1);
  });

  it("full-text search with an embedded double quote does not throw", () => {
    const db = createTestDb();
    ingestBatch(db, [
      { level: "info", message: 'quote " inside message', service: "qa" },
    ]);
    expect(() => searchLogs(db, { text: 'quote"' })).not.toThrow();
  });

  it("multi-word text search keeps AND-of-terms semantics", () => {
    const db = createTestDb();
    ingestBatch(db, [
      { level: "error", message: "database connection failed", service: "api" },
      { level: "error", message: "connection reset", service: "api" },
    ]);
    const rows = searchLogs(db, { text: "database connection" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain("database");
  });

  it("filters by trace_id", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, { trace_id: "t1" });
    expect(rows).toHaveLength(2);
  });

  it("respects limit", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, { limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it("returns results ordered by timestamp desc", () => {
    const db = createTestDb();
    seed(db);
    const rows = searchLogs(db, {});
    const [latest] = rows;
    const oldest = rows.at(-1);
    if (!latest || !oldest) throw new Error("expected search rows");
    expect(latest.timestamp >= oldest.timestamp).toBe(true);
  });
});

describe("tailLogs", () => {
  it("returns n most recent logs", () => {
    const db = createTestDb();
    seed(db);
    const rows = tailLogs(db, undefined, 3);
    expect(rows).toHaveLength(3);
  });

  it("filters by project_id", () => {
    const db = createTestDb();
    const rows = tailLogs(db, "nonexistent");
    expect(rows).toHaveLength(0);
  });
});

describe("getLogContext", () => {
  it("returns all logs for a trace_id in asc order", () => {
    const db = createTestDb();
    seed(db);
    const rows = getLogContext(db, "t1");
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    if (!first || !second) throw new Error("expected trace context rows");
    expect(first.timestamp <= second.timestamp).toBe(true);
  });

  it("returns empty for unknown trace_id", () => {
    const db = createTestDb();
    const rows = getLogContext(db, "unknown");
    expect(rows).toHaveLength(0);
  });
});

describe("toFtsMatchQuery", () => {
  it("quotes a single hyphenated token", () => {
    expect(toFtsMatchQuery("mcp-qa")).toBe('"mcp-qa"');
  });
  it("quotes each token in a multi-word query", () => {
    expect(toFtsMatchQuery("database connection")).toBe(
      '"database" "connection"',
    );
  });
  it("doubles embedded double quotes", () => {
    expect(toFtsMatchQuery('a"b')).toBe('"a""b"');
  });
  it("returns an empty phrase for blank input", () => {
    expect(toFtsMatchQuery("   ")).toBe('""');
  });
});
