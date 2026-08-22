// Server-side regression tests for the silent filter-drop family (todos
// d5a181fa): GET /api/memories must parse and apply the five list filters
// that the client serializes but the route used to ignore:
//
//   machine_id  visible_to_machine_id  search  source  flag
//
// Before the fix the route parsed only key/as_of/scope/category/tags/
// min_importance/pinned/agent_id/project_id/session_id/namespace/status/
// limit/offset, so in API/cloud mode these filters silently vanished while the
// local SQLite branch applied them — a silent transport divergence (verified
// by executing both branches against the same filter in the investigate phase).
//
// These tests fail against the pre-fix server: every filtered call returns the
// full seeded population instead of the expected subset.
//
// NOTE on server identity: this machine hosts many parallel test suites whose
// leaked server processes (bun-real) hold random ports and answer /api/health
// with 200. A bare health probe can therefore bind to a FOREIGN server and
// assert against its database. The spawn helper therefore verifies identity by
// polling for a distinctive seeded key through the real route; a foreign
// server can never answer it, and the attempt retries on a fresh port.

// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isolatedStoreEnv } from "../test-support/store-isolation.js";
import { getDatabase, resetDatabase } from "../db/database.js";

const DB_PATH = join(tmpdir(), `mementos-server-list-filter-${Date.now()}.db`);
const BASE_KEY = "k-d5a181fa-";

// Seeded population (all status='active'; source must be a DB CHECK-valid
// MEMORY_SOURCES value: user|agent|system|auto|imported):
//   k-d5a181fa-a  machine_id=m-d5a181fa-abc source=user  flag=important  value="invoice from client 42"
//   k-d5a181fa-b  machine_id=m-d5a181fa-abc source=agent flag=NULL       value="hello world"
//   k-d5a181fa-c  machine_id=m-d5a181fa-other source=user flag=important value="invoice from client 99"
//   k-d5a181fa-d  machine_id=NULL        source=auto  flag=NULL       value="invoice scan"
//   k-d5a181fa-e  machine_id=m-d5a181fa-other source=imported flag=outdated value="notes"
//   k-d5a181fa-f  machine_id=NULL        source=agent flag=NULL       value="plain memory"
const KEYS = {
  thisMachineImportant: `${BASE_KEY}a`,
  thisMachinePlain: `${BASE_KEY}b`,
  otherMachineImportant: `${BASE_KEY}c`,
  nullMachineAuto: `${BASE_KEY}d`,
  otherMachineImported: `${BASE_KEY}e`,
  nullMachineAgent: `${BASE_KEY}f`,
};
const MACHINES = {
  abc: "m-d5a181fa-abc",
  other: "m-d5a181fa-other",
};

let serverProc: ReturnType<typeof Bun.spawn>;
let BASE = "";

beforeAll(async () => {
  const db = getDatabase(DB_PATH);
  const ts = new Date().toISOString();

  // FK: memories.machine_id references machines(id), and the DB runs with
  // PRAGMA foreign_keys = ON, so the machines rows must exist first.
  db.exec(
    `INSERT INTO machines (id, name, hostname, platform)
     VALUES ('${MACHINES.abc}', '${MACHINES.abc}', 'm-abc', 'linux'),
            ('${MACHINES.other}', '${MACHINES.other}', 'm-other', 'linux')`,
  );

  const seed = (
    id: string,
    key: string,
    value: string,
    source: string,
    flag: string | null,
    machineId: string | null,
  ) =>
    `('${id}','${key}','${value}','knowledge','shared',NULL,'[]',5,` +
    `'${source}','active',FALSE,NULL,NULL,NULL,` +
    `${machineId === null ? "NULL" : `'${machineId}'`},` +
    `${flag === null ? "NULL" : `'${flag}'`},` +
    `'{}',0,0,1,NULL,NULL,NULL,NULL,'${ts}','${ts}','${ts}')`;

  db.exec(
    `INSERT INTO memories (id, key, value, category, scope, summary, tags, importance,
       source, status, pinned, agent_id, project_id, session_id, machine_id, flag,
       metadata, access_count, recall_count, version, expires_at, valid_from,
       valid_until, ingested_at, created_at, updated_at, accessed_at)
     VALUES ${[
       seed("00000000-0000-4000-8000-000000000001", KEYS.thisMachineImportant, "invoice from client 42", "user", "important", MACHINES.abc),
       seed("00000000-0000-4000-8000-000000000002", KEYS.thisMachinePlain, "hello world", "agent", null, MACHINES.abc),
       seed("00000000-0000-4000-8000-000000000003", KEYS.otherMachineImportant, "invoice from client 99", "user", "important", MACHINES.other),
       seed("00000000-0000-4000-8000-000000000004", KEYS.nullMachineAuto, "invoice scan", "auto", null, null),
       seed("00000000-0000-4000-8000-000000000005", KEYS.otherMachineImported, "notes", "imported", "outdated", MACHINES.other),
       seed("00000000-0000-4000-8000-000000000006", KEYS.nullMachineAgent, "plain memory", "agent", null, null),
     ].join(",")}`,
  );
  db.close();
  resetDatabase();

  // Spawn our own server and prove identity: the only server that can answer
  // ?key=<seeded marker> with that marker is the one reading our DB. Leaked
  // servers from parallel suites on this machine answer /api/health but never
  // the marker, so they fail the probe and we retry on a fresh port.
  for (let attempt = 0; attempt < 5; attempt++) {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") });
    const port = probe.port;
    probe.stop(true);

    const proc = Bun.spawn(
      ["bun", "run", "src/server/index.ts", "--port", String(port)],
      {
        env: isolatedStoreEnv(DB_PATH),
        stdout: "pipe",
        stderr: "pipe",
        cwd: new URL("../../", import.meta.url).pathname.replace(/\/$/, ""),
      }
    );

    let identified = false;
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/api/memories?key=${KEYS.thisMachineImportant}`);
        if (res.ok) {
          const data = await res.json();
          if ((data.memories ?? []).some((m: any) => m.key === KEYS.thisMachineImportant)) {
            identified = true;
            break;
          }
        }
      } catch { /* not ready yet */ }
      await Bun.sleep(100);
    }

    if (identified) {
      serverProc = proc;
      BASE = `http://localhost:${port}`;
      break;
    }
    proc.kill();
  }
  if (!BASE) throw new Error("Server failed to start (identity check never passed)");
});

afterAll(() => {
  serverProc?.kill();
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

async function api(path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  return { status: res.status, data };
}

function keysOf(data: any): string[] {
  return (data.memories ?? []).map((m: any) => m.key).sort();
}

describe("GET /api/memories applies the machine/search/source/flag filters", () => {
  test("no params returns the full seeded population (control)", async () => {
    const { status, data } = await api("/api/memories");
    expect(status).toBe(200);
    expect(keysOf(data)).toEqual(Object.values(KEYS).sort());
  });

  test("visible_to_machine_id keeps only that machine plus machine-NULL rows", async () => {
    const { status, data } = await api(`/api/memories?visible_to_machine_id=${MACHINES.abc}`);
    expect(status).toBe(200);
    expect(keysOf(data)).toEqual([KEYS.thisMachineImportant, KEYS.thisMachinePlain, KEYS.nullMachineAuto, KEYS.nullMachineAgent].sort());
  });

  test("search is honored and composes with visible_to_machine_id", async () => {
    const { status, data } = await api(`/api/memories?visible_to_machine_id=${MACHINES.abc}&search=invoice`);
    expect(status).toBe(200);
    expect(keysOf(data)).toEqual([KEYS.thisMachineImportant, KEYS.nullMachineAuto].sort());
  });

  test("source and flag compose with search and visible_to_machine_id", async () => {
    const { status, data } = await api(
      `/api/memories?visible_to_machine_id=${MACHINES.abc}&search=invoice&source=user&flag=important`
    );
    expect(status).toBe(200);
    expect(keysOf(data)).toEqual([KEYS.thisMachineImportant]);
  });

  test("source accepts a comma-separated array", async () => {
    const { status, data } = await api("/api/memories?source=user,imported");
    expect(status).toBe(200);
    expect(keysOf(data)).toEqual([KEYS.thisMachineImportant, KEYS.otherMachineImportant, KEYS.otherMachineImported].sort());
  });

  test("machine_id (exact machine) filters the population", async () => {
    const { status, data } = await api(`/api/memories?machine_id=${MACHINES.other}`);
    expect(status).toBe(200);
    expect(keysOf(data)).toEqual([KEYS.otherMachineImportant, KEYS.otherMachineImported].sort());
  });

  test("flag filters the population", async () => {
    const { status, data } = await api("/api/memories?flag=outdated");
    expect(status).toBe(200);
    expect(keysOf(data)).toEqual([KEYS.otherMachineImported]);
  });
});
