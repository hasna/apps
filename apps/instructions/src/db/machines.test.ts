import { describe, test, expect, beforeEach } from "bun:test";
import { getDatabase, resetDatabase } from "./database";
import { registerMachine, listMachines, updateMachineApplied } from "./machines";
import type { Database } from "bun:sqlite";

let db: Database;

beforeEach(() => {
  resetDatabase();
  process.env["CONFIGS_DB_PATH"] = ":memory:";
  db = getDatabase();
});

describe("machines", () => {
  test("registers a machine", () => {
    const m = registerMachine("myhost", "Darwin", db);
    expect(m.hostname).toBe("myhost");
    expect(m.os).toBe("Darwin");
    expect(m.last_applied_at).toBeNull();
  });

  test("is idempotent — same hostname returns same machine", () => {
    const m1 = registerMachine("myhost", "Darwin", db);
    const m2 = registerMachine("myhost", "Darwin", db);
    expect(m1.id).toBe(m2.id);
  });

  test("listMachines returns all", () => {
    registerMachine("host1", "Darwin", db);
    registerMachine("host2", "Linux", db);
    expect(listMachines(db).length).toBe(2);
  });

  test("updateMachineApplied sets last_applied_at", () => {
    registerMachine("myhost", "Darwin", db);
    updateMachineApplied("myhost", db);
    const machines = listMachines(db);
    expect(machines[0]!.last_applied_at).not.toBeNull();
  });
});
