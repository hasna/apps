import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { setMachineLocalPath } from "../db/projects.js";
import { registerAgent } from "../db/agents.js";
import { createTask, startTask } from "../db/tasks.js";
import { resetMachineId } from "../db/machines.js";
import {
  MACHINE_TOPOLOGY_SCHEMA,
  registerLocalMachine,
  getPathOverrides,
  buildMachineTopologyReport,
  getReachableHostnames,
} from "./machine-topology.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  resetMachineId();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_MACHINE_NAME"];
  resetMachineId();
});

describe("machine topology", () => {
  it("registers local machine", () => {
    const m = registerLocalMachine();
    expect(m.id).toBeTruthy();
    expect(m.name).toBeTruthy();
  });

  it("lists path overrides with casing detection", () => {
    const project = createProject({ name: "topo", path: "/home/user/Project" });
    setMachineLocalPath(project.id, "/home/user/project");

    const overrides = getPathOverrides();
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.casing_mismatch).toBe(true);
  });

  it("builds topology report", () => {
    registerAgent({ name: "agent-a" });
    const report = buildMachineTopologyReport();
    expect(report.schema_version).toBe(MACHINE_TOPOLOGY_SCHEMA);
    expect(report.machines.length).toBeGreaterThan(0);
    expect(report.machines[0]!.is_local).toBe(true);
    expect(report.agents.some((a) => a.agent_name === "agent-a")).toBe(true);
  });

  it("flags stale locks in diagnostics", () => {
    const task = createTask({ title: "Stale lock task" });
    startTask(task.id, "stale-agent");
    const db = getDatabase();
    db.run(
      "UPDATE tasks SET locked_at = ? WHERE id = ?",
      [new Date(Date.now() - 60 * 60 * 1000).toISOString(), task.id],
    );

    const report = buildMachineTopologyReport();
    expect(report.stale_tasks.length).toBeGreaterThan(0);
    expect(report.diagnostics.some((d) => d.includes("stale"))).toBe(true);
  });

  it("lists reachable hostnames", () => {
    process.env["TODOS_MACHINE_NAME"] = "dev-box";
    const names = getReachableHostnames();
    expect(names).toContain("dev-box");
  });
});
