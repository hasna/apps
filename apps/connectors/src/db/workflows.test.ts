import { describe, test, expect } from "bun:test";
import { SqliteAdapter as Database } from "./sqlite-adapter.js";
import {
  createWorkflow, getWorkflow, getWorkflowByName,
  listWorkflows, updateWorkflow, deleteWorkflow,
} from "./workflows.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE IF NOT EXISTS connector_workflows (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);
  return db;
}

const STEPS = [
  { connector: "stripe", command: "products list" },
  { connector: "github", command: "issues list", args: ["--limit", "5"] },
];

describe("createWorkflow", () => {
  test("creates workflow with steps", () => {
    const db = makeDb();
    const wf = createWorkflow({ name: "sync-flow", steps: STEPS }, db);
    expect(wf.name).toBe("sync-flow");
    expect(wf.steps).toHaveLength(2);
    expect(wf.steps[0].connector).toBe("stripe");
    expect(wf.enabled).toBe(true);
    expect(wf.id).toHaveLength(8);
  });

  test("empty steps allowed", () => {
    const db = makeDb();
    const wf = createWorkflow({ name: "empty-flow", steps: [] }, db);
    expect(wf.steps).toHaveLength(0);
  });
});

describe("getWorkflow / getWorkflowByName", () => {
  test("returns null for unknown id", () => {
    expect(getWorkflow("nope1234", makeDb())).toBeNull();
  });
  test("finds by name", () => {
    const db = makeDb();
    createWorkflow({ name: "mywf", steps: STEPS }, db);
    expect(getWorkflowByName("mywf", db)?.name).toBe("mywf");
  });
  test("returns null for unknown name", () => {
    expect(getWorkflowByName("nobody", makeDb())).toBeNull();
  });
});

describe("listWorkflows", () => {
  test("returns workflows ordered by name", () => {
    const db = makeDb();
    createWorkflow({ name: "z-flow", steps: [] }, db);
    createWorkflow({ name: "a-flow", steps: [] }, db);
    const names = listWorkflows(db).map(w => w.name);
    expect(names).toEqual(["a-flow", "z-flow"]);
  });
});

describe("updateWorkflow", () => {
  test("disables a workflow", () => {
    const db = makeDb();
    const wf = createWorkflow({ name: "wf1", steps: [] }, db);
    updateWorkflow(wf.id, { enabled: false }, db);
    expect(getWorkflow(wf.id, db)?.enabled).toBe(false);
  });

  test("updates steps", () => {
    const db = makeDb();
    const wf = createWorkflow({ name: "wf2", steps: STEPS }, db);
    updateWorkflow(wf.id, { steps: [STEPS[0]] }, db);
    expect(getWorkflow(wf.id, db)?.steps).toHaveLength(1);
  });

  test("no-op returns unchanged workflow", () => {
    const db = makeDb();
    const wf = createWorkflow({ name: "wf3", steps: [] }, db);
    const result = updateWorkflow(wf.id, {}, db);
    expect(result.name).toBe("wf3");
  });
});

describe("deleteWorkflow", () => {
  test("deletes existing workflow", () => {
    const db = makeDb();
    const wf = createWorkflow({ name: "todel-wf", steps: [] }, db);
    expect(deleteWorkflow(wf.id, db)).toBe(true);
    expect(getWorkflow(wf.id, db)).toBeNull();
  });
  test("returns false for non-existent", () => {
    expect(deleteWorkflow("nope1234", makeDb())).toBe(false);
  });
});
