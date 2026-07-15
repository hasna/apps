import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFinding } from "../../db/findings.js";
import { createProject } from "../../db/projects.js";
import { createScan } from "../../db/scans.js";
import { getCurrentTestDb, setupTestDb } from "../../db/test-helpers.js";
import { ScannerType, Severity } from "../../types/index.js";
import { registerFindingTools } from "./findings.js";
import { registerScanTools } from "./scan.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function captureTools(register: (server: McpServer) => void): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool(name: string, _description: string, _schema: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  register(server);
  return handlers;
}

const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

describe("MCP credential output safety", () => {
  let cleanup: () => void;
  let findingId: string;

  beforeEach(() => {
    cleanup = setupTestDb();
    const project = createProject("mcp-output-safety", "/tmp/mcp-output-safety");
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO rules (id, name, description, scanner_type, severity, enabled, builtin, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, '{}', datetime('now'), datetime('now'))`,
    ).run("github-token", "GitHub Token", "Synthetic test rule", "secrets", "critical");
    const scan = createScan(project.id, [ScannerType.Secrets]);
    findingId = createFinding(scan.id, {
      rule_id: "github-token",
      scanner_type: ScannerType.Secrets,
      severity: Severity.Critical,
      file: "synthetic.env",
      line: 1,
      message: "Synthetic credential finding",
      code_snippet: "[REDACTED]",
    }).id;
  });

  afterEach(() => cleanup());

  test("suppression responses never echo a caller-provided credential reason", async () => {
    const syntheticSecret = "ghp_" + "SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    const tools = captureTools((server) => {
      registerFindingTools(server, jsonResult, () => {
        throw new Error("credential context must not be read");
      });
    });

    const result = await tools.get("suppress_finding")?.({
      id: findingId,
      reason: `contains ${syntheticSecret}`,
    });
    const output = JSON.stringify(result);

    expect(output).not.toContain(syntheticSecret);
    expect(output).toContain("[REDACTED]");
  });

  test("credential LLM tools short-circuit before source context is read", async () => {
    let contextReads = 0;
    const tools = captureTools((server) => {
      registerFindingTools(server, jsonResult, () => {
        contextReads++;
        return "synthetic context";
      });
    });

    for (const toolName of ["explain_finding", "suggest_fix", "triage_finding"]) {
      const result = await tools.get(toolName)?.({ id: findingId });
      expect(JSON.stringify(result)).toContain("disabled for credential findings");
    }
    expect(contextReads).toBe(0);
  });

  test("secret scan failures withhold arbitrary exception context", async () => {
    const tools = captureTools((server) => {
      registerScanTools(server, jsonResult, () => "");
    });
    const result = await tools.get("scan_secret_exposure")?.({
      path: "/definitely/missing/shield-output-safety-path",
    });
    const output = JSON.stringify(result);

    expect(output).toContain("Details were withheld");
    expect(output).not.toContain("/definitely/missing/shield-output-safety-path");
  });

  test("scan_repo defaults to file-only scanner types", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shield-mcp-files-only-"));
    writeFileSync(join(dir, "index.ts"), "export const safe = true;\n", "utf-8");
    try {
      const tools = captureTools((server) => registerScanTools(server, jsonResult, () => ""));
      const result = await tools.get("scan_repo")?.({ path: dir });
      const envelope = result as { content: Array<{ text: string }> };
      const payload = JSON.parse(envelope.content[0].text);
      expect(payload.scan.scanner_types).not.toContain(ScannerType.GitHistory);
      expect(payload.scan.scanner_types).toContain(ScannerType.Code);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
