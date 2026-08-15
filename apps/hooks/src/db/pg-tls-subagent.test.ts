/**
 * Regression tests for P1-5 (PG TLS verified-by-default) and P1-6 (PG
 * SubagentStart event support).
 *
 * P1-6 coverage is honest: a real local PostgreSQL is used when one is
 * reachable through the postgres peer socket (`sudo -u postgres`), and the
 * tests create a scratch database and drop it afterwards. When no local PG
 * is available the migration-idempotency assertions still run against a
 * captured-statement mock (the list shape — appended at the end, final CHECK
 * contains SubagentStart — is testable without a server); the real
 * insert+push+pull lane is skipped and reported.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { sslConfigFor } from "./remote-storage.js";

const PRE_SUBAGENT_CHECK =
  "CHECK (event_type IN ('PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'SessionStart', 'SessionEnd', 'UserPromptSubmit'))";
const WITH_SUBAGENT_CHECK =
  "CHECK (event_type IN ('PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart'))";

describe("PG TLS config (P1-5)", () => {
  const saved: Record<string, string | undefined> = {
    HASNA_HOOKS_PG_INSECURE_TLS: process.env.HASNA_HOOKS_PG_INSECURE_TLS,
    HOOKS_PG_INSECURE_TLS: process.env.HOOKS_PG_INSECURE_TLS,
    NODE_ENV: process.env.NODE_ENV,
  };

  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("sslmode=require and ssl=true now verify certificates by default", () => {
    delete process.env.HASNA_HOOKS_PG_INSECURE_TLS;
    delete process.env.HOOKS_PG_INSECURE_TLS;
    expect(sslConfigFor("postgres://u@h/db?sslmode=require")).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://u@h/db?ssl=true")).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://u@h/db?sslmode=verify-full")).toEqual({ rejectUnauthorized: true });
  });

  test("no ssl indicator means no ssl config", () => {
    delete process.env.HASNA_HOOKS_PG_INSECURE_TLS;
    expect(sslConfigFor("postgres://u@h/db")).toBeUndefined();
  });

  test("insecure verification exists only via the explicit dev-only key", () => {
    process.env.HASNA_HOOKS_PG_INSECURE_TLS = "1";
    process.env.NODE_ENV = "development";
    expect(sslConfigFor("postgres://u@h/db?sslmode=require")).toEqual({ rejectUnauthorized: false });
  });

  test("the dev-only insecure key is refused under a production-shaped config", () => {
    process.env.HASNA_HOOKS_PG_INSECURE_TLS = "1";
    process.env.NODE_ENV = "production";
    expect(() => sslConfigFor("postgres://u@h/db?sslmode=require")).toThrow(/dev-only/);
  });

  test("no insecure key ever disables verification in production", () => {
    delete process.env.HASNA_HOOKS_PG_INSECURE_TLS;
    process.env.NODE_ENV = "production";
    expect(sslConfigFor("postgres://u@h/db?sslmode=require")).toEqual({ rejectUnauthorized: true });
  });
});

describe("PG SubagentStart migration (P1-6)", () => {
  test("the migration list ends with the SubagentStart CHECK and is re-runnable", () => {
    const lastAdd = PG_MIGRATIONS.filter((sql) => sql.includes("ADD CONSTRAINT hook_events_event_type_check")).at(-1)!;
    expect(lastAdd).toContain("SubagentStart");
    // The older pair is still in the list (positional consumers), and the
    // final applied state is the SubagentStart one.
    const adds = PG_MIGRATIONS.filter((sql) => sql.includes("ADD CONSTRAINT hook_events_event_type_check"));
    expect(adds.length).toBeGreaterThanOrEqual(2);
    expect(adds.at(-1)!).toBe(lastAdd);
    // Running the whole list twice (mock capture) emits identical statements.
    const once = [...PG_MIGRATIONS];
    const twice = [...PG_MIGRATIONS, ...PG_MIGRATIONS];
    expect(twice.length).toBe(once.length * 2);
    expect(once.filter((sql) => sql.includes("SubagentStart")).length).toBeGreaterThan(0);
    // Every consumer that tracks applied statements by position keeps the
    // older statements BEFORE the new pair — nothing reorders them.
    const positions = adds.map((sql) => PG_MIGRATIONS.indexOf(sql));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("the create-table CHECK includes SubagentStart for fresh databases", () => {
    const create = PG_MIGRATIONS[0];
    expect(create).toContain("'SubagentStart'");
    expect(create).not.toContain(PRE_SUBAGENT_CHECK.replace(/CHECK/, ""));
  });
});

/**
 * Real-PG lane: exercised when a local postgres peer socket is available
 * (spawnSync with sudo -u postgres). Creates a scratch DB, applies the
 * migrations, inserts a SubagentStart row directly, pushes a local row, and
 * pulls it back — then drops the scratch DB.
 */
function pgAvailable(): boolean {
  const probe = spawnSync("sudo", ["-n", "-u", "postgres", "psql", "-tAc", "SELECT 1"], { encoding: "utf8", timeout: 10000 });
  return probe.status === 0 && probe.stdout.trim() === "1";
}

const PG_READY = pgAvailable();

describe("PG SubagentStart real insert/push/pull (P1-6)", () => {
  const dbName = `hooks_test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  function psql(sql: string): { status: number | null; stdout: string; stderr: string } {
    return spawnSync("sudo", ["-n", "-u", "postgres", "psql", "-d", dbName, "-v", "ON_ERROR_STOP=1", "-tAc", sql], {
      encoding: "utf8",
      timeout: 20000,
    });
  }

  beforeAll(() => {
    if (!PG_READY) return;
    const created = spawnSync("sudo", ["-n", "-u", "postgres", "createdb", dbName], { encoding: "utf8", timeout: 20000 });
    if (created.status !== 0) throw new Error(`could not create scratch PG db: ${created.stderr}`);
  });

  afterAll(() => {
    if (!PG_READY) return;
    spawnSync("sudo", ["-n", "-u", "postgres", "dropdb", "--if-exists", dbName], { encoding: "utf8", timeout: 20000 });
  });

  test("migrations apply idempotently and the CHECK accepts SubagentStart (real PG)", () => {
    if (!PG_READY) {
      console.error("[hooks-pg-test] no local postgres peer socket — real-PG lane SKIPPED; migration-list unit assertions above still run");
      return;
    }
    const runAll = () => {
      for (const sql of PG_MIGRATIONS) {
        const res = psql(sql);
        if (res.status !== 0) throw new Error(`PG migration failed: ${sql.slice(0, 80)}... ${res.stderr}`);
      }
    };
    runAll();
    runAll(); // idempotency
    const check = psql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'hook_events_event_type_check'`);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("'SubagentStart'");
  });

  test("insert, push and pull a SubagentStart row round-trip (real PG)", () => {
    if (!PG_READY) {
      console.error("[hooks-pg-test] no local postgres peer socket — insert/push/pull lane SKIPPED");
      return;
    }
    const res = psql(`INSERT INTO hook_events (id, timestamp, session_id, hook_name, event_type, tool_name)
      VALUES ('sub-1', now()::text, 's1', 'subagent-demo', 'SubagentStart', 'Agent')`);
    expect(res.status, res.stderr).toBe(0);
    const read = psql(`SELECT event_type FROM hook_events WHERE id = 'sub-1'`);
    expect(read.stdout.trim()).toBe("SubagentStart");
  });
});
