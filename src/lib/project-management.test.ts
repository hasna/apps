import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../types/workspace.js";
import {
  FINANCE_DATA_CLASSIFICATIONS,
  FINANCE_FISCAL_CYCLES,
  FINANCE_PROJECT_METADATA_SCHEMA,
  PROJECT_PRIORITIES,
  PROJECT_STAGES,
  PROJECT_START_AGENTS,
  PROJECT_START_SESSION_POLICIES,
  expandProjectIntegrationUnlinkKeys,
  financeProjectMetadata,
  mergeProjectIntegrationFields,
  mergeProjectManagementMetadata,
  mergeProjectTags,
  normalizeProjectMetadata,
  projectExternalLinksSummary,
  removeProjectTags,
  unlinkProjectIntegrationFields,
} from "./project-management.js";

describe("project management taxonomy", () => {
  test("normalizes the authoritative finance metadata contract", () => {
    const metadata = normalizeProjectMetadata({
      keep: true,
      business_area: " Finance ",
      jurisdiction: " ro ",
      legal_entities: [" Example Alpha SRL ", "Example Beta SRL", "Example Alpha SRL"],
      fiscal_cycle: " MONTHLY ",
      data_classification: " Restricted ",
      retention_policy: " knowledge:finance-retention-v1 ",
      ledger_authority: " @hasna/accounting ",
      evidence_store: " @hasna/files ",
      approver: " role:finance-controller ",
      external_recipient_policy: " @hasna/invoices:approved-recipient-only ",
    });

    expect(FINANCE_FISCAL_CYCLES).toContain("monthly");
    expect(FINANCE_DATA_CLASSIFICATIONS).toContain("restricted");
    expect(metadata).toEqual({
      keep: true,
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: ["Example Alpha SRL", "Example Beta SRL"],
      fiscal_cycle: "monthly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    });
    expect(financeProjectMetadata({ metadata })).toEqual({
      schema: FINANCE_PROJECT_METADATA_SCHEMA,
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: ["Example Alpha SRL", "Example Beta SRL"],
      fiscal_cycle: "monthly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    });
  });

  test("rejects incomplete or invalid finance metadata without treating tags as authority", () => {
    expect(() => normalizeProjectMetadata({
      ledger_authority: "@hasna/accounting",
    })).toThrow(/missing required fields.*business_area.*jurisdiction.*legal_entities/i);
    expect(() => normalizeProjectMetadata({
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: [],
      fiscal_cycle: "monthly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    })).toThrow(/legal_entities must be a non-empty array/i);
    expect(() => normalizeProjectMetadata({
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: ["Example Alpha SRL"],
      fiscal_cycle: "weekly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    })).toThrow(/fiscal_cycle must be one of/i);
    expect(financeProjectMetadata({
      metadata: { business_area: "engineering" },
      tags: ["finance"],
    })).toBeNull();
  });

  test("normalizes canonical stage, priority, start agent, and start windows", () => {
    const metadata = mergeProjectManagementMetadata({ keep: true }, {
      stage: " Active ",
      priority: "CRITICAL",
      owner: " hasna ",
      launch_profile: " dev ",
      start_agent: "Claude",
      start_command: " claude --resume ",
      start_session_policy: "ERROR-IF-RUNNING",
      start_windows: [{ name: " server ", command: " bun run dev " }],
    });

    expect(metadata).toEqual({
      keep: true,
      stage: "active",
      priority: "critical",
      owner: "hasna",
      launch_profile: "dev",
      start_agent: "claude",
      start_command: "claude --resume",
      start_session_policy: "error-if-running",
      start_windows: [{ name: "server", command: "bun run dev" }],
    });
  });

  test("rejects unknown lifecycle and launcher values", () => {
    expect(PROJECT_STAGES).toContain("active");
    expect(PROJECT_PRIORITIES).toContain("critical");
    expect(PROJECT_START_AGENTS).toContain("codewith");
    expect(PROJECT_START_SESSION_POLICIES).toContain("error-if-running");
    expect(() => mergeProjectManagementMetadata({}, { stage: "blocked" })).toThrow("Invalid project stage");
    expect(() => mergeProjectManagementMetadata({}, { priority: "urgent" })).toThrow("Invalid project priority");
    expect(() => mergeProjectManagementMetadata({}, { start_agent: "vim" })).toThrow("Invalid project start_agent");
    expect(() => mergeProjectManagementMetadata({}, { start_session_policy: "replace" })).toThrow("Invalid project start_session_policy");
  });

  test("cleans and clears linked project-system integrations", () => {
    const integrations = mergeProjectIntegrationFields({
      todos_project_id: "todo_old",
      brief_id: "brief_old",
    }, {
      todos_project_id: " todo_new ",
      brief_id: null,
      brief_path: " docs/brief.md ",
    });

    expect(integrations).toEqual({
      todos_project_id: "todo_new",
      brief_path: "docs/brief.md",
    });
  });

  test("adds and removes project tags without replacing unrelated tags", () => {
    expect(mergeProjectTags(["security", "family"], [" family ", "cameras", ""])).toEqual(["security", "family", "cameras"]);
    expect(removeProjectTags(["security", "family", "cameras"], [" family ", "missing"])).toEqual(["security", "cameras"]);
  });

  test("expands and clears integration unlink groups", () => {
    expect(expandProjectIntegrationUnlinkKeys(["github", "todos-task-list", "brief_path", "files"])).toEqual([
      "github_repo",
      "github_url",
      "todos_task_list_id",
      "brief_path",
      "files_index_id",
    ]);

    expect(unlinkProjectIntegrationFields({
      github_repo: "hasna/app",
      github_url: "https://github.com/hasna/app",
      todos_project_id: "todo_123",
      todos_task_list_id: "list_456",
      brief_id: "brief_123",
      brief_path: "docs/brief.md",
      files_index_id: "idx_123",
    }, ["github", "todos", "brief_path"])).toEqual({
      brief_id: "brief_123",
      files_index_id: "idx_123",
    });
  });

  test("summarizes linked todos and brief references without task or brief content", () => {
    const root = mkdtempSync(join(tmpdir(), "project-links-"));
    const briefPath = join(root, "brief.md");
    writeFileSync(briefPath, "# Brief\n\nPrivate content that should not be embedded.");
    const project = {
      integrations: {
        todos_project_id: "todo_123",
        todos_task_list_id: "list_456",
        brief_id: "brief_789",
        brief_path: briefPath,
      },
    } as unknown as Workspace;

    expect(projectExternalLinksSummary(project)).toEqual({
      todos: {
        linked: true,
        status: "linked",
        project_id: "todo_123",
        task_list_id: "list_456",
      },
      brief: {
        linked: true,
        status: "linked",
        id: "brief_789",
        path: briefPath,
        path_exists: true,
      },
      canvases: {
        linked: false,
        status: "unlinked",
        project_id: null,
        default_canvas_id: null,
      },
    });
  });
});
