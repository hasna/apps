/**
 * Shared test helpers for the @hasna/logs cloud `/v1` serve tests.
 *
 * Extracted from `app.test.ts` so the store-level ApiStore tests can drive the
 * same in-memory fake Postgres client + Hono app through the real HTTP
 * transport (see `src/store/api-lane.test.ts`).
 */
import { mintApiKey } from "@hasna/contracts/auth";
import type { QueryResultRow } from "pg";
import { logsCloudMigrations } from "../../db/pg-migrate.ts";
import type { TypedQueryClient } from "../../generated/storage-kit/index.ts";
import { buildCloudApp } from "./app.ts";

export const SIGNING_SECRET = "test-signing-secret-do-not-use-in-prod";

interface FakeEventRow extends Record<string, unknown> {
  event_id: string;
  event_time: string;
}

/**
 * In-memory fake of the vendored kit's TypedQueryClient. Enough to exercise the
 * cloud routes without a live Postgres: it pattern-matches on the SQL text.
 *
 * Supported surfaces: projects, logs, event_records (with WHERE/ORDER/LIMIT
 * evaluation so cursor-watch queries behave like Postgres), feedback, pages,
 * scan_jobs, scan_runs, and performance_snapshots.
 */
export function fakeClient(): {
  client: TypedQueryClient;
  state: {
    logs: Map<string, Record<string, unknown>>;
    projects: Map<string, Record<string, unknown>>;
    events: Map<string, Record<string, unknown>>;
    pages: Map<string, Record<string, unknown>>;
    scanJobs: Map<string, Record<string, unknown>>;
    scanRuns: Map<string, Record<string, unknown>>;
    perfSnapshots: Map<string, Record<string, unknown>>;
    migrations: { id: string }[];
  };
} {
  const state = {
    logs: new Map<string, Record<string, unknown>>(),
    projects: new Map<string, Record<string, unknown>>(),
    events: new Map<string, Record<string, unknown>>(),
    pages: new Map<string, Record<string, unknown>>(),
    scanJobs: new Map<string, Record<string, unknown>>(),
    scanRuns: new Map<string, Record<string, unknown>>(),
    perfSnapshots: new Map<string, Record<string, unknown>>(),
    migrations: logsCloudMigrations().map((m) => ({ id: m.id })),
  };

  const EVENT_COLUMNS = [
    "event_id",
    "schema_version",
    "source_event_id",
    "event_type",
    "event_time",
    "ingest_time",
    "severity",
    "source",
    "project_id",
    "page_id",
    "log_id",
    "machine_id",
    "repo_id",
    "app_id",
    "process_id",
    "run_id",
    "trace_id",
    "span_id",
    "parent_span_id",
    "session_id",
    "release_id",
    "environment",
    "artifact_id",
    "privacy_tier",
    "segment_id",
    "segment_path",
    "byte_offset",
    "byte_length",
    "record_hash",
    "message",
    "metadata",
  ];

  const SCAN_JOB_COLUMNS = [
    "id",
    "project_id",
    "page_id",
    "schedule",
    "enabled",
    "last_run_at",
    "created_at",
  ];

  const SCAN_RUN_COLUMNS = [
    "id",
    "job_id",
    "page_id",
    "started_at",
    "finished_at",
    "status",
    "logs_collected",
    "errors_found",
    "perf_score",
  ];

  const PAGE_COLUMNS = [
    "id",
    "project_id",
    "url",
    "path",
    "name",
    "last_scanned_at",
    "created_at",
  ];

  // ── event_records query evaluation ────────────────────────

  /** Split a SQL WHERE condition list on top-level ` AND ` (parens respected). */
  function splitAnd(where: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    const tokens = where.split(" AND ");
    for (const token of tokens) {
      const opens = (token.match(/\(/g) ?? []).length;
      const closes = (token.match(/\)/g) ?? []).length;
      if (depth === 0 && current === "") {
        if (opens === closes) parts.push(token);
        else {
          current = token;
          depth = opens - closes;
        }
      } else {
        current = `${current} AND ${token}`;
        depth += opens - closes;
        if (depth === 0) {
          parts.push(current);
          current = "";
        }
      }
    }
    if (current !== "") parts.push(current);
    return parts;
  }

  /** Apply the event_records WHERE clause + ORDER BY + LIMIT/OFFSET like Postgres. */
  function queryEventRows(
    sql: string,
    params: readonly unknown[],
  ): Record<string, unknown>[] {
    const s = sql.replace(/\s+/g, " ").trim();
    const whereMatch = /WHERE (.+?)( ORDER BY| LIMIT|$)/.exec(s);
    const orderMatch = /ORDER BY (\w+) (ASC|DESC), (\w+) (ASC|DESC)/.exec(s);
    const limitMatch = /LIMIT \$(\d+)( OFFSET \$(\d+))?/.exec(s);

    let rows = [...state.events.values()] as FakeEventRow[];

    if (whereMatch) {
      const conds = splitAnd(whereMatch[1] ?? "");
      const mcpNeedle = "%\"category\":\"mcp_tool_call\"%";
      rows = rows.filter((row) => {
        for (const cond of conds) {
          const inMatch = /^(\w+) IN \(([^)]+)\)$/.exec(cond);
          if (inMatch) {
            const col = inMatch[1] as keyof FakeEventRow;
            const vals = (inMatch[2] ?? "")
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.startsWith("$"))
              .map((t) => String(params[Number(t.slice(1)) - 1] ?? ""));
            if (!vals.includes(String(row[col] ?? ""))) return false;
            continue;
          }
          const eqMatch = /^(\w+) = \$(\d+)$/.exec(cond);
          if (eqMatch) {
            const col = eqMatch[1] as keyof FakeEventRow;
            const want = String(params[Number(eqMatch[2]) - 1] ?? "");
            if (String(row[col] ?? "") !== want) return false;
            continue;
          }
          const geMatch = /^(\w+) >= \$(\d+)$/.exec(cond);
          if (geMatch) {
            const col = geMatch[1] as keyof FakeEventRow;
            const want = String(params[Number(geMatch[2]) - 1] ?? "");
            if (String(row[col] ?? "") < want) return false;
            continue;
          }
          const leMatch = /^(\w+) <= \$(\d+)$/.exec(cond);
          if (leMatch) {
            const col = leMatch[1] as keyof FakeEventRow;
            const want = String(params[Number(leMatch[2]) - 1] ?? "");
            if (String(row[col] ?? "") > want) return false;
            continue;
          }
          if (/^NOT \(event_type = 'agent' AND source = 'mcp'/.test(cond)) {
            const needleMatch = /\$(\d+)/.exec(cond);
            const needle = needleMatch
              ? String(params[Number(needleMatch[1]) - 1] ?? "")
              : mcpNeedle;
            if (
              row.event_type === "agent" &&
              row.source === "mcp" &&
              String(row.metadata ?? "").includes(needle.replace(/%/g, ""))
            )
              return false;
            continue;
          }
          if (/^\(event_id ILIKE/.test(cond)) {
            const needleMatch = /\$(\d+)/.exec(cond);
            const needle = needleMatch
              ? String(params[Number(needleMatch[1]) - 1] ?? "")
                  .replace(/%/g, ".*")
              : "";
            const re = new RegExp(needle, "i");
            const hay = [
              row.event_id,
              row.source_event_id,
              row.message,
              row.metadata,
            ]
              .map((v) => String(v ?? ""))
              .join(" ");
            if (!re.test(hay)) return false;
            continue;
          }
          if (/^\(event_time > \$/.test(cond)) {
            const ids = [...cond.matchAll(/\$(\d+)/g)].map((m) =>
              Number(m[1] ?? "0"),
            );
            const first = ids[0] ?? 0;
            const last = ids.at(-1) ?? 0;
            const time = String(params[first - 1] ?? "");
            const id = String(params[last - 1] ?? "");
            if (
              !(
                String(row.event_time ?? "") > time ||
                (String(row.event_time ?? "") === time &&
                  String(row.event_id ?? "") > id)
              )
            )
              return false;
            continue;
          }
          // Unknown condition: fail open (return all rows) would hide bugs;
          // fail closed so an unmatched condition is visible in tests.
          throw new Error(`fakeClient: unhandled event_records condition: ${cond}`);
        }
        return true;
      });
    }

    if (orderMatch) {
      const col1 = orderMatch[1] ?? "event_time";
      const dir1 = orderMatch[2] ?? "DESC";
      const col2 = orderMatch[3] ?? "event_id";
      const dir2 = orderMatch[4] ?? "DESC";
      const sign1 = dir1 === "ASC" ? 1 : -1;
      const sign2 = dir2 === "ASC" ? 1 : -1;
      rows = rows.sort((a, b) => {
        const c = String(a[col1] ?? "").localeCompare(String(b[col1] ?? ""));
        if (c !== 0) return sign1 * c;
        return sign2 * String(a[col2] ?? "").localeCompare(String(b[col2] ?? ""));
      });
    }

    if (limitMatch) {
      const limitIdx = limitMatch[1] ?? "";
      const offsetIdx = limitMatch[3];
      const limit = Number(params[Number(limitIdx) - 1] ?? 0);
      const offset = offsetIdx
        ? Number(params[Number(offsetIdx) - 1] ?? 0)
        : 0;
      rows = rows.slice(offset, offset + limit);
    }
    return rows;
  }

  async function run<T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("SELECT id FROM schema_migrations")) {
      return state.migrations as unknown as T[];
    }
    if (s.startsWith("SELECT 1 AS ok")) return [{ ok: 1 } as unknown as T];
    if (s.startsWith("INSERT INTO projects")) {
      const [id, name] = params as string[];
      const row = {
        id,
        name,
        github_repo: null,
        base_url: null,
        description: null,
        created_at: new Date().toISOString(),
      };
      state.projects.set(id ?? "", row);
      return [row as unknown as T];
    }
    if (
      s.startsWith(
        "SELECT id, name, github_repo, base_url, description, created_at FROM projects WHERE name",
      )
    ) {
      return []; // no dup
    }
    if (
      s.startsWith(
        "SELECT id, name, github_repo, base_url, description, created_at FROM projects WHERE id",
      )
    ) {
      const row = state.projects.get((params as string[])[0] ?? "");
      return row ? [row as unknown as T] : [];
    }
    if (
      s.startsWith(
        "SELECT id, name, github_repo, base_url, description, created_at FROM projects",
      )
    ) {
      return [...state.projects.values()] as unknown as T[];
    }
    if (s.startsWith("INSERT INTO logs")) {
      const p = params as unknown[];
      const row = {
        id: p[0],
        timestamp: new Date().toISOString(),
        project_id: p[2],
        level: p[3],
        source: p[4],
        service: p[5],
        message: p[6],
        trace_id: p[7],
        session_id: p[8],
        agent: p[9],
        url: p[10],
        stack_trace: p[11],
        metadata: p[12],
      };
      state.logs.set(p[0] as string, row);
      return [row as unknown as T];
    }
    if (s.startsWith("DELETE FROM logs WHERE id")) {
      const id = (params as string[])[0] ?? "";
      const existed = state.logs.delete(id);
      return existed ? [{ id } as unknown as T] : [];
    }
    if (s.startsWith("SELECT") && s.includes("FROM logs WHERE id")) {
      const row = state.logs.get((params as string[])[0] ?? "");
      return row ? [row as unknown as T] : [];
    }
    if (s.startsWith("SELECT") && s.includes("FROM logs")) {
      return [...state.logs.values()] as unknown as T[];
    }
    if (s.startsWith("INSERT INTO event_records")) {
      const p = params as unknown[];
      const eventId = p[0] as string;
      if (!state.events.has(eventId)) {
        const row: Record<string, unknown> = {
          created_at: new Date().toISOString(),
        };
        EVENT_COLUMNS.forEach((col, i) => {
          row[col] = p[i] ?? null;
        });
        state.events.set(eventId, row);
      }
      return [];
    }
    if (
      s.startsWith("SELECT * FROM event_records WHERE event_id = $1") ||
      s === "SELECT * FROM event_records WHERE event_id = $1"
    ) {
      const row = state.events.get((params as string[])[0] ?? "");
      return row ? [row as unknown as T] : [];
    }
    if (s.startsWith("SELECT * FROM event_records")) {
      return queryEventRows(s, params) as unknown as T[];
    }
    if (s.startsWith("INSERT INTO feedback")) {
      return [{ id: "fb1" } as unknown as T];
    }
    // ── pages ────────────────────────────────────────────────
    if (s.startsWith("INSERT INTO pages")) {
      const p = params as unknown[];
      const id = `page-${state.pages.size + 1}`;
      const row: Record<string, unknown> = { id };
      PAGE_COLUMNS.forEach((col, i) => {
        if (col === "id") return;
        row[col] = i === 0 ? undefined : (p[i - 1] ?? null);
      });
      row.created_at = new Date().toISOString();
      row.last_scanned_at = null;
      state.pages.set(id, row);
      return [row as unknown as T];
    }
    if (s.startsWith("SELECT") && s.includes("FROM pages WHERE id")) {
      const row = state.pages.get((params as string[])[0] ?? "");
      return row ? [row as unknown as T] : [];
    }
    if (s.startsWith("SELECT") && s.includes("FROM pages WHERE project_id")) {
      const pid = (params as string[])[0] ?? "";
      return [...state.pages.values()].filter(
        (r) => r.project_id === pid,
      ) as unknown as T[];
    }
    if (s.startsWith("UPDATE pages SET last_scanned_at")) {
      const row = state.pages.get((params as string[])[0] ?? "");
      if (!row) return [];
      row.last_scanned_at = (params as string[])[1] ?? null;
      return [row as unknown as T];
    }
    // ── scan_jobs ────────────────────────────────────────────
    if (s.startsWith("INSERT INTO scan_jobs")) {
      const p = params as unknown[];
      const row: Record<string, unknown> = {
        id: `job-${state.scanJobs.size + 1}`,
        project_id: p[0],
        page_id: p[1] ?? null,
        schedule: p[2],
        enabled: true,
        last_run_at: null,
        created_at: new Date().toISOString(),
      };
      state.scanJobs.set(row.id as string, row);
      return [row as unknown as T];
    }
    if (s.startsWith("SELECT") && s.includes("FROM scan_jobs")) {
      const rows = [...state.scanJobs.values()];
      if (s.includes("WHERE project_id")) {
        const pid = (params as string[])[0] ?? "";
        return rows.filter((r) => r.project_id === pid) as unknown as T[];
      }
      if (s.includes("WHERE id")) {
        const row = state.scanJobs.get((params as string[])[0] ?? "");
        return row ? [row as unknown as T] : [];
      }
      return rows as unknown as T[];
    }
    if (s.startsWith("UPDATE scan_jobs SET")) {
      const row = state.scanJobs.get(
        (params as string[]).at(-1) ?? "",
      );
      if (!row) return [];
      const sets = /SET (.+?) WHERE/.exec(s)?.[1] ?? "";
      for (const frag of sets.split(",").map((f) => f.trim())) {
        const m = /^(\w+) = \$(\d+)$/.exec(frag);
        if (!m) continue;
        const col = m[1] ?? "";
        const value = params[Number(m[2] ?? "0") - 1];
        if (col === "enabled") {
          row.enabled = value === true || value === "true" ? true : false;
        } else {
          row[col] = value ?? null;
        }
      }
      return [row as unknown as T];
    }
    // ── scan_runs ────────────────────────────────────────────
    if (s.startsWith("INSERT INTO scan_runs")) {
      const p = params as unknown[];
      const row: Record<string, unknown> = {
        id: `run-${state.scanRuns.size + 1}`,
        job_id: p[0],
        page_id: p[1] ?? null,
        started_at: new Date().toISOString(),
        finished_at: null,
        status: "running",
        logs_collected: 0,
        errors_found: 0,
        perf_score: null,
      };
      state.scanRuns.set(row.id as string, row);
      return [row as unknown as T];
    }
    if (s.startsWith("UPDATE scan_runs SET")) {
      const row = state.scanRuns.get((params as string[]).at(-1) ?? "");
      if (!row) return [];
      const sets = /SET (.+?) WHERE/.exec(s)?.[1] ?? "";
      for (const frag of sets.split(",").map((f) => f.trim())) {
        const m = /^(\w+) = \$(\d+)$/.exec(frag);
        if (!m) continue;
        const col = m[1] ?? "";
        const value = params[Number(m[2] ?? "0") - 1];
        if (col === "status" || col === "logs_collected" || col === "errors_found") {
          row[col] = value;
        } else {
          row[col] = value ?? null;
        }
      }
      if (/finished_at = NOW\(\)::text/.test(sets)) {
        row.finished_at = new Date().toISOString();
      }
      return [row as unknown as T];
    }
    // ── performance_snapshots ────────────────────────────────
    if (s.startsWith("INSERT INTO performance_snapshots")) {
      const p = params as unknown[];
      const row: Record<string, unknown> = {
        id: `perf-${state.perfSnapshots.size + 1}`,
        timestamp: new Date().toISOString(),
        project_id: p[0],
        page_id: p[1] ?? null,
        url: p[2],
        lcp: p[3] ?? null,
        fcp: p[4] ?? null,
        cls: p[5] ?? null,
        tti: p[6] ?? null,
        ttfb: p[7] ?? null,
        score: p[8] ?? null,
        raw_audit: p[9] ?? null,
      };
      state.perfSnapshots.set(row.id as string, row);
      return [row as unknown as T];
    }
    return [];
  }

  const client: TypedQueryClient = {
    async query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]) {
      const rows = await run<T>(sql, params);
      return { rows, rowCount: rows.length };
    },
    many: <T extends QueryResultRow>(sql: string, params?: readonly unknown[]) =>
      run<T>(sql, params),
    async get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]) {
      const rows = await run<T>(sql, params);
      return rows[0] ?? null;
    },
    async one<T extends QueryResultRow>(sql: string, params?: readonly unknown[]) {
      const rows = await run<T>(sql, params);
      if (rows.length !== 1) throw new Error("expected one row");
      return rows[0] as T;
    },
    async execute<T extends QueryResultRow>(sql: string, params?: readonly unknown[]) {
      await run<T>(sql, params);
    },
  };
  return { client, state };
}

export { mintApiKey };

export function tokenWith(scopes: string[]): string {
  return mintApiKey({
    app: "logs",
    scopes,
    signingSecret: SIGNING_SECRET,
    agent: "test",
  }).token;
}

export function buildTestCloudApp() {
  return buildCloudApp({
    client: fakeClient().client,
    version: "9.9.9",
    signingSecret: SIGNING_SECRET,
    // Tests mint tokens directly with SIGNING_SECRET; the key-status lookup is
    // not the subject, so every presented key is treated as active.
    keyStatus: async (): Promise<"active"> => "active",
  });
}
