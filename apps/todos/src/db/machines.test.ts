import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  getOrCreateLocalMachine,
  getMachineId,
  resetMachineId,
  getMachine,
  getMachineByName,
  listMachines,
  registerMachine,
  setPrimaryMachine,
  getPrimaryMachine,
  archiveMachine,
  unarchiveMachine,
  deleteMachine,
  backfillMachineId,
} from "./machines.js";
import { createTask } from "./tasks.js";
import { createProject } from "./projects.js";
import { registerAgent } from "./agents.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  resetMachineId();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_MACHINE_NAME"];
});

describe("getOrCreateLocalMachine", () => {
  it("should create a machine on first call", () => {
    const machine = getOrCreateLocalMachine();
    expect(machine.id).toBeTruthy();
    expect(machine.name).toBeTruthy();
    expect(machine.hostname).toBeTruthy();
    expect(machine.platform).toBeTruthy();
    expect(machine.created_at).toBeTruthy();
  });

  it("should be idempotent — same name returns same machine", () => {
    const first = getOrCreateLocalMachine();
    const second = getOrCreateLocalMachine();
    expect(second.id).toBe(first.id);
    expect(second.name).toBe(first.name);
  });

  it("should use TODOS_MACHINE_NAME env var for name", () => {
    process.env["TODOS_MACHINE_NAME"] = "test-machine-42";
    const machine = getOrCreateLocalMachine();
    expect(machine.name).toBe("test-machine-42");
  });

  it("should update hostname and platform on subsequent calls", () => {
    const first = getOrCreateLocalMachine();
    const second = getOrCreateLocalMachine();
    expect(second.hostname).toBe(first.hostname);
    expect(second.platform).toBe(first.platform);
  });
});

describe("getMachineId", () => {
  it("should return a machine ID string", () => {
    const id = getMachineId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should cache the machine ID", () => {
    const id1 = getMachineId();
    const id2 = getMachineId();
    expect(id2).toBe(id1);
  });

  it("should reset cache on resetMachineId", () => {
    const id1 = getMachineId();
    resetMachineId();
    // After reset, should still get the same ID (same machine name)
    const id2 = getMachineId();
    expect(id2).toBe(id1);
  });
});

describe("getMachine", () => {
  it("should retrieve a machine by ID", () => {
    const created = getOrCreateLocalMachine();
    const found = getMachine(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe(created.name);
  });

  it("should return null for non-existent ID", () => {
    const found = getMachine("nonexistent-id");
    expect(found).toBeNull();
  });
});

describe("getMachineByName", () => {
  it("should retrieve a machine by name", () => {
    process.env["TODOS_MACHINE_NAME"] = "my-laptop";
    const created = getOrCreateLocalMachine();
    const found = getMachineByName("my-laptop");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it("should return null for non-existent name", () => {
    const found = getMachineByName("does-not-exist");
    expect(found).toBeNull();
  });
});

describe("listMachines", () => {
  it("should list all machines", () => {
    getOrCreateLocalMachine();
    const machines = listMachines();
    expect(machines.length).toBeGreaterThanOrEqual(1);
  });

  it("should return empty array when no machines", () => {
    // Don't create any machine — but DB is fresh in-memory
    const db = getDatabase();
    const machines = db.query("SELECT * FROM machines").all();
    expect(machines.length).toBe(0);
  });
});

describe("deleteMachine", () => {
  it("should delete a machine by ID", () => {
    const machine = getOrCreateLocalMachine();
    const deleted = deleteMachine(machine.id);
    expect(deleted).toBe(true);
    expect(getMachine(machine.id)).toBeNull();
  });

  it("should return false for non-existent ID", () => {
    const deleted = deleteMachine("nonexistent-id");
    expect(deleted).toBe(false);
  });
});

describe("backfillMachineId", () => {
  it("should stamp machine_id on tasks without one", () => {
    const db = getDatabase();
    const project = createProject({ name: "test", path: "/tmp/test-backfill" });
    const task = createTask({ title: "Test task", project_id: project.id });

    // Verify task has no machine_id initially
    const row = db.query("SELECT machine_id FROM tasks WHERE id = ?").get(task.id) as { machine_id: string | null };
    expect(row.machine_id).toBeNull();

    // Run backfill
    backfillMachineId(db, true);

    // Now it should have machine_id
    const updated = db.query("SELECT machine_id FROM tasks WHERE id = ?").get(task.id) as { machine_id: string | null };
    expect(updated.machine_id).toBeTruthy();
  });

  it("should stamp machine_id on projects without one", () => {
    const db = getDatabase();
    const project = createProject({ name: "test-proj", path: "/tmp/test-backfill-proj" });

    const row = db.query("SELECT machine_id FROM projects WHERE id = ?").get(project.id) as { machine_id: string | null };
    expect(row.machine_id).toBeNull();

    backfillMachineId(db, true);

    const updated = db.query("SELECT machine_id FROM projects WHERE id = ?").get(project.id) as { machine_id: string | null };
    expect(updated.machine_id).toBeTruthy();
  });

  it("should stamp machine_id on agents without one", () => {
    const db = getDatabase();
    const agent = registerAgent({ name: "test-agent" });

    const row = db.query("SELECT machine_id FROM agents WHERE id = ?").get(agent.id) as { machine_id: string | null };
    expect(row.machine_id).toBeNull();

    backfillMachineId(db, true);

    const updated = db.query("SELECT machine_id FROM agents WHERE id = ?").get(agent.id) as { machine_id: string | null };
    expect(updated.machine_id).toBeTruthy();
  });

  it("should not overwrite existing machine_id", () => {
    const db = getDatabase();
    const task = createTask({ title: "Already stamped" });

    // Manually set a machine_id
    db.run("UPDATE tasks SET machine_id = 'other-machine' WHERE id = ?", [task.id]);

    backfillMachineId(db, true);

    const row = db.query("SELECT machine_id FROM tasks WHERE id = ?").get(task.id) as { machine_id: string };
    expect(row.machine_id).toBe("other-machine");
  });

  it("should be idempotent — running twice produces same result", () => {
    const db = getDatabase();
    createTask({ title: "Test idempotent" });

    backfillMachineId(db, true);
    const first = db.query("SELECT machine_id FROM tasks").get() as { machine_id: string };

    backfillMachineId(db, true);
    const second = db.query("SELECT machine_id FROM tasks").get() as { machine_id: string };

    expect(second.machine_id).toBe(first.machine_id);
  });
});

describe("schema — machine_id and synced_at columns", () => {
  it("tasks table should have machine_id column", () => {
    const db = getDatabase();
    const cols = db.query("PRAGMA table_info(tasks)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("machine_id");
    expect(colNames).toContain("synced_at");
  });

  it("projects table should have machine_id column", () => {
    const db = getDatabase();
    const cols = db.query("PRAGMA table_info(projects)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("machine_id");
    expect(colNames).toContain("synced_at");
  });

  it("agents table should have machine_id column", () => {
    const db = getDatabase();
    const cols = db.query("PRAGMA table_info(agents)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("machine_id");
    expect(colNames).toContain("synced_at");
  });

  it("machines table should exist with correct schema", () => {
    const db = getDatabase();
    const cols = db.query("PRAGMA table_info(machines)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("name");
    expect(colNames).toContain("hostname");
    expect(colNames).toContain("platform");
    expect(colNames).toContain("last_seen_at");
    expect(colNames).toContain("metadata");
    expect(colNames).toContain("created_at");
  });

  it("plans table should have machine_id column", () => {
    const db = getDatabase();
    const cols = db.query("PRAGMA table_info(plans)").all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain("machine_id");
  });

  it("task_lists table should have machine_id column", () => {
    const db = getDatabase();
    const cols = db.query("PRAGMA table_info(task_lists)").all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain("machine_id");
  });
});

describe("registerMachine", () => {
  it("should register a new machine with SSH address", () => {
    const m = registerMachine("remote-box", { ssh_address: "user@remote.example.com" });
    expect(m.name).toBe("remote-box");
    expect(m.ssh_address).toBe("user@remote.example.com");
    expect(m.is_primary).toBe(false);
  });

  it("should update existing machine on re-registration", () => {
    const first = registerMachine("my-laptop", { ssh_address: "old@host" });
    const second = registerMachine("my-laptop", { ssh_address: "new@host", hostname: "new-hostname" });
    expect(second.id).toBe(first.id);
    expect(second.ssh_address).toBe("new@host");
    expect(second.hostname).toBe("new-hostname");
  });

  it("should set primary flag when requested", () => {
    const m = registerMachine("primary-box", { primary: true });
    expect(m.is_primary).toBe(true);
    const primary = getPrimaryMachine();
    expect(primary).not.toBeNull();
    expect(primary!.id).toBe(m.id);
  });
});

describe("setPrimaryMachine", () => {
  it("should set one machine as primary and clear others", () => {
    registerMachine("box-a", {});
    registerMachine("box-b", {});
    setPrimaryMachine("box-b");
    expect(getPrimaryMachine()!.name).toBe("box-b");

    setPrimaryMachine("box-a");
    expect(getPrimaryMachine()!.name).toBe("box-a");
    const boxB = getMachineByName("box-b");
    expect(boxB!.is_primary).toBe(false);
  });

  it("should throw on non-existent machine", () => {
    expect(() => setPrimaryMachine("nope")).toThrow("Machine 'nope' not found");
  });

  it("should not set archived machine as primary", () => {
    const m = registerMachine("to-archive", {});
    archiveMachine(m.id);
    expect(() => setPrimaryMachine("to-archive")).toThrow("Cannot set archived machine");
  });
});

describe("archiveMachine", () => {
  it("should archive a machine", () => {
    const m = registerMachine("archive-me", {});
    archiveMachine(m.id);
    const archived = getMachine(m.id)!;
    expect(archived.archived_at).toBeTruthy();
  });

  it("should not archive primary machine", () => {
    const m = registerMachine("cant-archive", { primary: true });
    expect(() => archiveMachine(m.id)).toThrow("Cannot archive the primary machine");
  });

  it("should not archive machine with active tasks", () => {
    const db = getDatabase();
    const m = registerMachine("has-tasks", {}, db);
    const task = createTask({ title: "active task" });
    db.run("UPDATE tasks SET machine_id = ? WHERE id = ?", [m.id, task.id]);
    expect(() => archiveMachine(m.id)).toThrow("Cannot archive machine with");
  });

  it("should exclude archived machines from list by default", () => {
    const db = getDatabase();
    const m = registerMachine("archive-hide", {}, db);
    archiveMachine(m.id, db);
    const active = listMachines(db);
    expect(active.find((x) => x.id === m.id)).toBeUndefined();
    const all = listMachines(db, true);
    expect(all.find((x) => x.id === m.id)).toBeDefined();
  });
});

describe("unarchiveMachine", () => {
  it("should restore an archived machine", () => {
    const m = registerMachine("restore-me", {});
    archiveMachine(m.id);
    const restored = unarchiveMachine(m.id)!;
    expect(restored.archived_at).toBeNull();
  });
});
