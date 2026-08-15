import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ProjectPanelSchema, SCHEMA_IDS } from "@hasna/contracts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-project-panel-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("createFilesProjectPanel", () => {
  test("emits a contract-valid project panel with file metrics", async () => {
    const { projectId, fileId } = await seedFilesProject();
    const { createFilesProjectPanel } = await import("./project-panel.js");

    const panel = createFilesProjectPanel(projectId, { limit: 5 });
    const parsed = ProjectPanelSchema.safeParse(panel);

    expect(parsed.success).toBe(true);
    expect(panel.schema).toBe(SCHEMA_IDS.projectPanel);
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("files");
    expect(panel.state).toBe("ready");
    expect(panel.metrics.find((metric) => metric.id === "total_files")?.value).toBe(1);
    expect(panel.metrics.find((metric) => metric.id === "indexed_files")?.value).toBe(1);
    expect(panel.items.some((item) => item.id === fileId && item.resourceRefs.some((ref) => ref.uri === `files://file/${fileId}`))).toBe(true);
  });

  test("emits empty state when the files project has not been created", async () => {
    const { createFilesProjectPanel } = await import("./project-panel.js");

    const panel = createFilesProjectPanel("Swiss Bank Account");

    expect(ProjectPanelSchema.safeParse(panel).success).toBe(true);
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.state).toBe("empty");
    expect(panel.warnings[0]).toContain("No @hasna/files project matched");
  });
});

async function seedFilesProject(): Promise<{ projectId: string; fileId: string }> {
  const { getCurrentMachine } = await import("../db/machines.js");
  const { createSource } = await import("../db/sources.js");
  const { upsertFile } = await import("../db/files.js");
  const { createProject, addToProject } = await import("../db/projects.js");
  const { tagFile } = await import("../db/tags.js");
  const { upsertFileSearchDocument } = await import("../db/file-search-documents.js");

  const sourceRoot = join(testDir!, "source");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "potential-contract.pdf"), "redacted fixture\n");

  const machine = getCurrentMachine();
  const source = createSource({
    name: "Swiss paperwork",
    type: "local",
    path: sourceRoot,
    machine_id: machine.id,
  });
  const project = createProject("Swiss Bank Account", "Paperwork and document tracking", {
    metadata: { slug: "swiss-bank-account" },
  });
  const file = upsertFile({
    id: "f_swiss_contract",
    source_id: source.id,
    machine_id: machine.id,
    path: "potential-contract.pdf",
    name: "potential-contract.pdf",
    ext: ".pdf",
    size: 18,
    mime: "application/pdf",
    hash: "a".repeat(64),
    status: "active",
    modified_at: "2026-06-29T00:00:00.000Z",
  });
  tagFile(file.id, "contract");
  addToProject(project.id, file.id);
  upsertFileSearchDocument({
    file_id: file.id,
    source_ref: `open-files://file/${file.id}`,
    kind: "extracted_text",
    extractor: "test",
    searchable_text: "Redacted contract fixture for dashboard counts.",
    status: "ready",
  });

  return { projectId: project.id, fileId: file.id };
}
