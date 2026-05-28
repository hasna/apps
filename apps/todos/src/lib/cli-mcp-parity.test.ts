import { describe, it, expect } from "bun:test";
import {
  CLI_MCP_PARITY_MANIFEST,
  getParityReport,
  validateParityManifest,
  normalizeErrorContract,
  findParityForMcpTool,
  findParityForCliCommand,
  PARITY_SCHEMA_VERSION,
} from "./cli-mcp-parity.js";

describe("CLI MCP parity manifest", () => {
  it("validates manifest structure with no issues", () => {
    expect(validateParityManifest()).toEqual([]);
  });

  it("covers core task workflow operations", () => {
    expect(findParityForCliCommand("claim")).toMatchObject({ mcp: "claim_next_task" });
    expect(findParityForCliCommand("done")).toMatchObject({ mcp: "complete_task" });
    expect(findParityForMcpTool("get_status")).toBeTruthy();
  });

  it("documents intentional CLI-only gaps", () => {
    const tui = CLI_MCP_PARITY_MANIFEST.find((e) => e.operation === "tui");
    expect(tui?.gap).toBeTruthy();
    expect(tui?.mcp).toBeNull();
  });

  it("includes session feature parity entries", () => {
    expect(findParityForCliCommand("bootstrap")).toMatchObject({ mcp: "bootstrap_workspace" });
    expect(findParityForCliCommand("runs queue")).toMatchObject({ mcp: "enqueue_agent_run" });
    expect(findParityForCliCommand("lease acquire")).toMatchObject({ mcp: "acquire_task_lease" });
    expect(findParityForCliCommand("md sync")).toMatchObject({ mcp: "sync_todos_md" });
  });

  it("produces parity report summary", () => {
    const report = getParityReport();
    expect(report.schema_version).toBe(PARITY_SCHEMA_VERSION);
    expect(report.total).toBeGreaterThan(40);
    expect(report.matched).toBeGreaterThan(30);
    expect(report.documented_gaps).toBeGreaterThan(0);
  });

  it("normalizes error contract deterministically", () => {
    const err = normalizeErrorContract(new Error("task not found"));
    expect(err.message).toBe("task not found");
    expect(err.code).toBe("Error");
  });

  it("manifest requires no network", () => {
    expect(JSON.stringify(CLI_MCP_PARITY_MANIFEST)).not.toMatch(/https?:\/\//);
  });
});
