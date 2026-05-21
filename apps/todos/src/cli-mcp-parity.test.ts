import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TODOS_CLI_MCP_PARITY,
  TODOS_CLI_MCP_PARITY_MANIFEST,
  createCliMcpParityManifest,
} from "./cli-mcp-parity.js";
import { getJsonContract, validateJsonContract } from "./json-contracts.js";
import { getMcpToolNames } from "./mcp.js";
import { withNoNetwork } from "./test/no-network.js";

const expectedDomains = [
  "tasks",
  "projects",
  "plans",
  "workspace-trust",
  "runs",
  "comments",
  "search",
  "imports",
  "exports",
];

describe("CLI/MCP parity manifest", () => {
  test("publishes deterministic local-only parity metadata", () => {
    const manifest = createCliMcpParityManifest({
      version: "1.2.3",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-01-02T03:04:05.000Z",
      package: {
        packageName: "@hasna/todos",
        repository: "hasna/todos",
        version: "1.2.3",
      },
      localOnly: true,
      noNetworkRequired: true,
    });
    expect(manifest.parity.map((entry) => entry.domain)).toEqual(expectedDomains);
    expect(TODOS_CLI_MCP_PARITY_MANIFEST.generatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(validateJsonContract("cli_mcp_parity_manifest", manifest).ok).toBe(true);
  });

  test("covers every required local workflow domain with MCP tools or documented gaps", () => {
    const knownMcpTools = new Set(getMcpToolNames({ profile: "full" }));

    for (const entry of TODOS_CLI_MCP_PARITY) {
      expect(entry.cliCommands.length).toBeGreaterThan(0);
      expect(entry.errorContracts).toEqual(expect.arrayContaining(["structured_error", "api_error"]));
      expect(entry.example.cli).toMatch(/^todos /);
      expect(entry.mcpTools.length + (entry.intentionalGaps?.length ?? 0)).toBeGreaterThan(0);

      for (const tool of entry.mcpTools) {
        expect(knownMcpTools.has(tool)).toBe(true);
      }
      for (const contractId of entry.jsonContracts) {
        expect(getJsonContract(contractId)).not.toBeNull();
      }
      for (const contractId of entry.errorContracts) {
        expect(getJsonContract(contractId)).not.toBeNull();
      }
      for (const gap of entry.intentionalGaps ?? []) {
        expect(entry.cliCommands).toContain(gap.cliCommand);
        expect(gap.reason.length).toBeGreaterThan(40);
      }
      if (entry.status === "intentional-gap") {
        expect(entry.gapReason?.length ?? 0).toBeGreaterThan(40);
      }
    }
  });

  test("keeps documented top-level CLI commands present in CLI help output", () => {
    const help = Bun.spawnSync({
      cmd: [process.execPath, "src/cli/index.tsx", "--help"],
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TODOS_DB_PATH: ":memory:" },
    });
    expect(help.exitCode).toBe(0);
    const output = help.stdout.toString();

    for (const entry of TODOS_CLI_MCP_PARITY) {
      for (const command of entry.cliCommands) {
        const topLevel = command.replace(/^todos\s+/, "").split(/\s+/)[0];
        expect(output).toContain(`  ${topLevel}`);
      }
    }
  });

  test("keeps run, comment, search, import, and export contracts represented", () => {
    const byDomain = new Map(TODOS_CLI_MCP_PARITY.map((entry) => [entry.domain, entry]));

    expect(byDomain.get("runs")?.mcpTools).toEqual(expect.arrayContaining([
      "start_task_run",
      "add_task_run_event",
      "add_task_run_command",
      "finish_task_run",
    ]));
    expect(byDomain.get("comments")?.mcpTools).toEqual(expect.arrayContaining(["add_comment", "list_comments"]));
    expect(byDomain.get("search")?.mcpTools).toEqual(expect.arrayContaining(["search_tasks", "get_status"]));
    expect(byDomain.get("imports")?.jsonContracts).toContain("local_bridge_import_result");
    expect(byDomain.get("exports")?.jsonContracts).toContain("local_bridge_bundle");
  });

  test("does not need network access to build or validate", async () => {
    const { result, calls } = await withNoNetwork(async () => {
      const manifest = createCliMcpParityManifest();
      return validateJsonContract("cli_mcp_parity_manifest", manifest);
    });

    expect(calls).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("documents examples and intentional gaps", () => {
    const docs = readFileSync(join(import.meta.dir, "..", "docs", "cli-mcp-parity.md"), "utf-8");

    expect(docs).toContain("todos add \"Fix flaky parser\" --priority high --json");
    expect(docs).toContain("create_task");
    expect(docs).toContain("todos export --format bridge --output todos-bridge.json --json");
    expect(docs).toContain("todos bridge-import todos-bridge.json --apply --json");
    expect(docs).toContain("intentionally CLI-only");
  });

  test("keeps parity metadata neutral and local-only", () => {
    const serialized = JSON.stringify(TODOS_CLI_MCP_PARITY_MANIFEST).toLowerCase();

    for (const forbidden of ["stripe", "billing", "tenant", "aws", "s3", "platform-todos", "saas"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});
