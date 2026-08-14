import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import "./setup";
import {
  addMachine,
  getMachine,
  listMachines,
  removeMachine,
  seedDefaultMachines,
  updateMachine,
  upsertMachine,
} from "../src/lib/machines";
import { closeDb, getDb } from "../src/lib/db";

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM machines");
}

describe("machines", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  it("adds a machine with defaults", () => {
    const machine = addMachine({ host: "linux-node-a" });

    expect(machine.id).toBe("linux-node-a");
    expect(machine.name).toBe("linux-node-a");
    expect(machine.host).toBe("linux-node-a");
    expect(machine.port).toBe(22);
    expect(machine.enabled).toBe(true);
    expect(machine.username.length).toBeGreaterThan(0);
  });

  it("upserts an existing machine by id", () => {
    addMachine({ id: "linux-node-a", host: "linux-node-a", name: "linux-node-a" });

    const updated = upsertMachine({
      id: "linux-node-a",
      host: "linux-node-a.internal",
      name: "Spark 01",
      port: 2222,
      installer: "bun",
    });

    expect(updated.id).toBe("linux-node-a");
    expect(updated.name).toBe("Spark 01");
    expect(updated.host).toBe("linux-node-a.internal");
    expect(updated.port).toBe(2222);
    expect(updated.installer).toBe("bun");
  });

  it("updates machine state and metadata", () => {
    addMachine({ id: "linux-node-a", host: "linux-node-a" });

    const updated = updateMachine("linux-node-a", {
      enabled: false,
      last_seen_at: "2026-04-08T10:00:00.000Z",
      last_error: "ssh timeout",
    });

    expect(updated.enabled).toBe(false);
    expect(updated.last_seen_at).toBe("2026-04-08T10:00:00.000Z");
    expect(updated.last_error).toBe("ssh timeout");
  });

  it("lists machines ordered by name", () => {
    addMachine({ id: "linux-node-b", name: "linux-node-b", host: "linux-node-b" });
    addMachine({ id: "macos-node-a", name: "macos-node-a", host: "macos-node-a" });

    expect(listMachines().map((machine) => machine.id)).toEqual(["linux-node-b", "macos-node-a"]);
  });

  it("seeds the default machine inventory", () => {
    const machines = seedDefaultMachines();

    expect(machines.map((machine) => machine.id)).toEqual(["linux-node-a", "linux-node-b", "macos-node-a", "macos-node-b"]);
    expect(getMachine("linux-node-a")?.platform).toBe("linux");
    expect(getMachine("macos-node-a")?.platform).toBe("darwin");
  });

  it("removes machines", () => {
    addMachine({ id: "linux-node-a", host: "linux-node-a" });
    removeMachine("linux-node-a");
    expect(getMachine("linux-node-a")).toBeNull();
  });
});
