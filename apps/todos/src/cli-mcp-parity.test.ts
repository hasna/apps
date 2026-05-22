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
  "references",
  "knowledge",
  "risks",
  "retrospectives",
  "agent-reliability",
  "local-fields",
  "dedupe",
  "verification-providers",
  "projects",
  "plans",
  "templates",
  "workspace-trust",
  "secret-safety",
  "retention-cleanup",
  "runner-sandbox",
  "extensions",
  "workflow-prompts",
  "policy-packs",
  "approval-gates",
  "review-queues",
  "runs",
  "agent-runs",
  "source-index",
  "calendar",
  "kanban-boards",
  "time-tracking",
  "handoffs",
  "local-event-hooks",
  "terminal-notifications",
  "branch-work-plans",
  "natural-language-intake",
  "encryption",
  "comments",
  "search",
  "context-packs",
  "environment-snapshots",
  "onboarding",
  "local-snapshots",
  "imports",
  "release-notes",
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
    expect(byDomain.get("local-fields")?.mcpTools).toEqual(expect.arrayContaining([
      "get_task_fields",
      "set_task_fields",
      "query_tasks_by_fields",
    ]));
    expect(byDomain.get("local-fields")?.jsonContracts).toContain("local_task_fields");
    expect(byDomain.get("retention-cleanup")?.mcpTools).toEqual(expect.arrayContaining([
      "preview_retention_cleanup",
      "apply_retention_cleanup",
    ]));
    expect(byDomain.get("retention-cleanup")?.jsonContracts).toContain("retention_cleanup_report");
    expect(byDomain.get("dedupe")?.mcpTools).toEqual(expect.arrayContaining([
      "find_duplicate_tasks",
      "merge_duplicate_task",
    ]));
    expect(byDomain.get("dedupe")?.jsonContracts).toEqual(expect.arrayContaining(["duplicate_task_candidate", "task_merge_result"]));
    expect(byDomain.get("references")?.mcpTools).toContain("resolve_mentions");
    expect(byDomain.get("references")?.jsonContracts).toContain("mention_resolution_report");
    expect(byDomain.get("knowledge")?.mcpTools).toEqual(expect.arrayContaining([
      "create_knowledge_record",
      "create_knowledge_snapshot",
      "list_knowledge_records",
      "search_knowledge_records",
      "export_knowledge_records",
    ]));
    expect(byDomain.get("knowledge")?.jsonContracts).toEqual(expect.arrayContaining([
      "project_knowledge_record",
      "project_knowledge_export",
    ]));
    expect(byDomain.get("risks")?.mcpTools).toEqual(expect.arrayContaining([
      "create_risk",
      "list_risks",
      "score_plan_health",
      "score_project_health",
      "export_risk_register",
    ]));
    expect(byDomain.get("risks")?.jsonContracts).toEqual(expect.arrayContaining([
      "project_risk_record",
      "risk_register_export",
      "project_health_report",
    ]));
    expect(byDomain.get("retrospectives")?.mcpTools).toEqual(expect.arrayContaining([
      "create_retrospective",
      "list_retrospectives",
      "export_retrospectives",
    ]));
    expect(byDomain.get("retrospectives")?.jsonContracts).toEqual(expect.arrayContaining([
      "retrospective_record",
      "retrospective_report",
      "retrospective_export",
    ]));
    expect(byDomain.get("agent-reliability")?.mcpTools).toEqual(expect.arrayContaining([
      "get_agent_reliability_scorecard",
      "export_agent_reliability_scorecards",
    ]));
    expect(byDomain.get("agent-reliability")?.jsonContracts).toEqual(expect.arrayContaining([
      "agent_reliability_scorecard",
      "agent_reliability_export",
    ]));
    expect(byDomain.get("verification-providers")?.mcpTools).toEqual(expect.arrayContaining([
      "set_verification_provider",
      "run_verification_provider",
    ]));
    expect(byDomain.get("verification-providers")?.jsonContracts).toEqual(expect.arrayContaining(["verification_provider", "verification_provider_result"]));
    expect(byDomain.get("extensions")?.mcpTools).toContain("test_local_extension_compatibility");
    expect(byDomain.get("extensions")?.jsonContracts).toContain("local_extension_compatibility");
    expect(byDomain.get("handoffs")?.mcpTools).toEqual(expect.arrayContaining([
      "create_handoff",
      "list_handoffs",
      "read_handoff",
      "acknowledge_handoff",
      "recover_stale_session_handoff",
    ]));
    expect(byDomain.get("handoffs")?.jsonContracts).toContain("handoff");
    expect(byDomain.get("search")?.mcpTools).toEqual(expect.arrayContaining(["search_tasks", "get_status"]));
    expect(byDomain.get("templates")?.mcpTools).toEqual(expect.arrayContaining([
      "list_template_library",
      "init_templates",
      "create_task_from_template",
      "export_template",
      "import_template",
    ]));
    expect(byDomain.get("environment-snapshots")?.mcpTools).toEqual(expect.arrayContaining([
      "capture_environment_snapshot",
      "compare_environment_snapshots",
    ]));
    expect(byDomain.get("environment-snapshots")?.jsonContracts).toEqual(expect.arrayContaining([
      "environment_snapshot",
      "environment_snapshot_comparison",
    ]));
    expect(byDomain.get("release-notes")?.mcpTools).toContain("generate_release_notes");
    expect(byDomain.get("release-notes")?.jsonContracts).toContain("release_notes");
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
    expect(docs).toContain("todos references resolve file:src/index.ts:12 symbol:createTask branch:main --json");
    expect(docs).toContain("todos fields set 1234abcd --labels bug,cli --severity s1 --field component=parser --json");
    expect(docs).toContain("todos dedupe scan --threshold 0.8 --json");
    expect(docs).toContain("todos verify-providers run local --task 1234abcd --json");
    expect(docs).toContain("todos retention cleanup --older-than-days 30 --json");
    expect(docs).toContain("todos template-library --json");
    expect(docs).toContain("todos extensions compat ./todos.extension.json --json");
    expect(docs).toContain("todos handoff --create --agent codex");
    expect(docs).toContain("acknowledge_handoff");
    expect(docs).toContain("create_task");
    expect(docs).toContain("todos export --format bridge --output todos-bridge.json --json");
    expect(docs).toContain("todos bridge-import todos-bridge.json --apply --json");
    expect(docs).toContain("todos event-hooks set audit --event task.completed");
    expect(docs).toContain("todos env-snapshot capture --task 1234abcd --json");
    expect(docs).toContain("todos release-notes --project . --format markdown");
    expect(docs).toContain("intentionally CLI-only");
  });

  test("keeps parity metadata neutral and local-only", () => {
    const serialized = JSON.stringify(TODOS_CLI_MCP_PARITY_MANIFEST).toLowerCase();

    for (const forbidden of ["stripe", "billing", "tenant", "aws", "s3", "platform-todos", "saas"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});
