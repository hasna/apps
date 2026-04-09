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
    const machine = addMachine({ host: "spark01" });

    expect(machine.id).toBe("spark01");
    expect(machine.name).toBe("spark01");
    expect(machine.host).toBe("spark01");
    expect(machine.port).toBe(22);
    expect(machine.enabled).toBe(true);
    expect(machine.username.length).toBeGreaterThan(0);
  });

  it("upserts an existing machine by id", () => {
    addMachine({ id: "spark01", host: "spark01", name: "spark01" });

    const updated = upsertMachine({
      id: "spark01",
      host: "spark01.internal",
      name: "Spark 01",
      port: 2222,
      installer: "bun",
    });

    expect(updated.id).toBe("spark01");
    expect(updated.name).toBe("Spark 01");
    expect(updated.host).toBe("spark01.internal");
    expect(updated.port).toBe(2222);
    expect(updated.installer).toBe("bun");
  });

  it("updates machine state and metadata", () => {
    addMachine({ id: "spark01", host: "spark01" });

    const updated = updateMachine("spark01", {
      enabled: false,
      last_seen_at: "2026-04-08T10:00:00.000Z",
      last_error: "ssh timeout",
    });

    expect(updated.enabled).toBe(false);
    expect(updated.last_seen_at).toBe("2026-04-08T10:00:00.000Z");
    expect(updated.last_error).toBe("ssh timeout");
  });

  it("lists machines ordered by name", () => {
    addMachine({ id: "spark02", name: "spark02", host: "spark02" });
    addMachine({ id: "apple01", name: "apple01", host: "apple01" });

    expect(listMachines().map((machine) => machine.id)).toEqual(["apple01", "spark02"]);
  });

  it("seeds the default machine inventory", () => {
    const machines = seedDefaultMachines();

    expect(machines.map((machine) => machine.id)).toEqual(["spark01", "spark02", "apple01", "apple03"]);
    expect(getMachine("spark01")?.platform).toBe("linux");
    expect(getMachine("apple01")?.platform).toBe("darwin");
  });

  it("removes machines", () => {
    addMachine({ id: "spark01", host: "spark01" });
    removeMachine("spark01");
    expect(getMachine("spark01")).toBeNull();
  });
});
