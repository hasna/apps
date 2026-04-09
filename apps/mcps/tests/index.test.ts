import { describe, it, expect } from "bun:test";
import "./setup";

// Test that the public API exports all expected symbols
import * as api from "../src/index";

describe("index exports", () => {
  it("exports registry functions", () => {
    expect(typeof api.addServer).toBe("function");
    expect(typeof api.removeServer).toBe("function");
    expect(typeof api.listServers).toBe("function");
    expect(typeof api.getServer).toBe("function");
    expect(typeof api.updateServer).toBe("function");
    expect(typeof api.enableServer).toBe("function");
    expect(typeof api.disableServer).toBe("function");
  });

  it("exports remote functions", () => {
    expect(typeof api.searchRegistry).toBe("function");
    expect(typeof api.getRegistryServer).toBe("function");
    expect(typeof api.installFromRegistry).toBe("function");
    expect(typeof api.listHasnaMcpCatalog).toBe("function");
    expect(typeof api.runFleetHealthCheck).toBe("function");
    expect(typeof api.runFleetInstall).toBe("function");
  });

  it("exports proxy functions", () => {
    expect(typeof api.connectToServer).toBe("function");
    expect(typeof api.disconnectServer).toBe("function");
    expect(typeof api.listAllTools).toBe("function");
    expect(typeof api.callTool).toBe("function");
    expect(typeof api.refreshTools).toBe("function");
    expect(typeof api.disconnectAll).toBe("function");
  });

  it("exports database functions", () => {
    expect(typeof api.getDb).toBe("function");
    expect(typeof api.closeDb).toBe("function");
  });

  it("exports machine registry functions", () => {
    expect(typeof api.addMachine).toBe("function");
    expect(typeof api.upsertMachine).toBe("function");
    expect(typeof api.listMachines).toBe("function");
    expect(typeof api.getMachine).toBe("function");
    expect(typeof api.updateMachine).toBe("function");
    expect(typeof api.removeMachine).toBe("function");
    expect(typeof api.seedDefaultMachines).toBe("function");
  });

  it("exports version helpers", () => {
    expect(typeof api.readPackageVersion).toBe("function");
  });
});
