import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createLocalBridgeBundle, importLocalBridgeBundle } from "./local-bridge.js";
import { createTask } from "../db/tasks.js";
import { getTaskLocalFields, queryTasksByLocalFields, setTaskLocalFields } from "./local-fields.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local task fields", () => {
  test("sets labels priority severity owner area and redacted custom fields", () => {
    const task = createTask({ title: "Classified task", tags: ["existing"] }, db);
    const updated = setTaskLocalFields(task.id, {
      labels: ["frontend", "bug"],
      priority: "critical",
      severity: "s1",
      owner: "codex",
      area: "cli",
      custom: {
        component: "timeline",
        note: "Bearer abcdefghijklmnop should redact",
      },
    }, db);

    expect(updated.priority).toBe("critical");
    expect(updated.assigned_to).toBe("codex");
    expect(updated.tags).toEqual(["bug", "existing", "frontend"]);
    expect(getTaskLocalFields(task.id, db)).toEqual({
      labels: ["bug", "frontend"],
      priority: "critical",
      severity: "s1",
      owner: "codex",
      area: "cli",
      custom: {
        component: "timeline",
        note: "Bearer [REDACTED] should redact",
      },
    });
  });

  test("queries local fields and survives bridge export/import", () => {
    const task = createTask({ title: "Portable fields" }, db);
    setTaskLocalFields(task.id, {
      labels: ["ops"],
      severity: "s2",
      owner: "agent-a",
      area: "worker",
      custom: { system: "queue" },
    }, db);
    createTask({ title: "Other task" }, db);

    const matches = queryTasksByLocalFields({ labels: ["ops"], severity: "s2", custom: { system: "queue" } }, db);
    expect(matches.map((match) => match.id)).toEqual([task.id]);

    const bundle = createLocalBridgeBundle({}, db);
    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();
    const result = importLocalBridgeBundle(bundle, { dryRun: false }, db);
    expect(result.ok).toBe(true);

    expect(getTaskLocalFields(task.id, db).custom.system).toBe("queue");
    expect(queryTasksByLocalFields({ labels: ["ops"], area: "worker" }, db)).toHaveLength(1);
  });

  test("replaces mirrored labels and clears local owner", () => {
    const task = createTask({ title: "Retag task", tags: ["manual"] }, db);
    const first = setTaskLocalFields(task.id, {
      labels: ["bug", "cli"],
      owner: "codex",
    }, db);
    expect(first.tags).toEqual(["bug", "cli", "manual"]);

    const second = setTaskLocalFields(task.id, {
      labels: ["ops"],
      owner: null,
    }, db);
    expect(second.assigned_to).toBeNull();
    expect(second.tags).toEqual(["manual", "ops"]);
    expect(getTaskLocalFields(task.id, db).owner).toBeNull();
    expect(queryTasksByLocalFields({ labels: ["bug"] }, db)).toHaveLength(0);
    expect(queryTasksByLocalFields({ labels: ["ops"] }, db)).toHaveLength(1);
  });
});
