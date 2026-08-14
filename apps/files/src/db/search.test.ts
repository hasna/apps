import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-search-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterEach(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("searchFiles", () => {
  test("indexes organization target paths and returns them in results", async () => {
    const { getDb } = await import("./database.js");
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { updateFileOrganizationReview } = await import("./organization.js");
    const { searchFiles } = await import("./search.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Search source",
      type: "local",
      path: "/tmp/search-source",
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_search_semantic",
      source_id: source.id,
      machine_id: machine.id,
      path: "incoming/blob.bin",
      name: "blob.bin",
      ext: ".bin",
      size: 100,
      mime: "application/octet-stream",
      hash: "hash-search",
      status: "active",
    });

    getDb().run(
      `INSERT INTO file_organization_reviews (
        id, file_id, source_id, root_type, original_path, current_path, target_path,
        owner, labels, review_status, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "review_search_semantic",
        file.id,
        source.id,
        "unknown",
        "incoming/blob.bin",
        "incoming/blob.bin",
        "archive/unreviewed/blob.bin",
        "archive",
        JSON.stringify(["unreviewed"]),
        "unreviewed",
        "normal",
      ],
    );

    updateFileOrganizationReview(file.id, {
      status: "approved",
      owner: "finance",
      target_path: "finance/tax/2026-quarterly-tax-return.bin",
      labels: ["finance", "tax"],
      actor: "test",
    });

    const results = searchFiles("quarterly-tax", { limit: 10 });
    expect(results.map((result) => result.id)).toContain(file.id);
    const result = results.find((item) => item.id === file.id)!;
    expect(result.organization_owner).toBe("finance");
    expect(result.organization_target_path).toBe("finance/tax/2026-quarterly-tax-return.bin");
    expect(result.organization_review_status).toBe("approved");
  });

  test("searches derived content documents without changing file metadata", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertFileSearchDocument } = await import("./file-search-documents.js");
    const { searchFiles } = await import("./search.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Content search source",
      type: "local",
      path: "/tmp/content-search-source",
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_search_content",
      source_id: source.id,
      machine_id: machine.id,
      path: "incoming/opaque.bin",
      name: "opaque.bin",
      ext: ".bin",
      size: 100,
      mime: "application/octet-stream",
      hash: "hash-content-search",
      status: "active",
    });

    upsertFileSearchDocument({
      file_id: file.id,
      source_ref: `open-files://file/${file.id}`,
      kind: "llm_summary",
      extractor: "test-agent",
      searchable_text: "Contains a supplier renewal forecast and pricing exception summary.",
      metadata: { document_kind: "summary" },
    });

    expect(searchFiles("supplier-renewal", { limit: 10, search_scope: "metadata" })).toHaveLength(0);

    const results = searchFiles("supplier renewal", { limit: 10, search_scope: "content" });
    expect(results.map((result) => result.id)).toContain(file.id);
    const result = results.find((item) => item.id === file.id)!;
    expect(result.search_match_sources).toEqual(["content"]);
    expect(result.search_document_kinds).toEqual(["llm_summary"]);
    expect(result.search_document_count).toBe(1);
  });

  test("replaces older same-source search documents as stale", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { listFileSearchDocuments, upsertFileSearchDocument } = await import("./file-search-documents.js");
    const { searchFiles } = await import("./search.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Stale content source",
      type: "local",
      path: "/tmp/stale-content-source",
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_search_stale",
      source_id: source.id,
      machine_id: machine.id,
      path: "incoming/report.bin",
      name: "report.bin",
      ext: ".bin",
      size: 100,
      mime: "application/octet-stream",
      hash: "hash-stale-search",
      status: "active",
    });
    const sourceRef = `open-files://file/${file.id}`;

    upsertFileSearchDocument({
      file_id: file.id,
      source_ref: sourceRef,
      kind: "extraction_summary",
      extractor: "test-agent",
      searchable_text: "Older artifact with obsolete codename.",
    });
    upsertFileSearchDocument({
      file_id: file.id,
      source_ref: sourceRef,
      kind: "extraction_summary",
      extractor: "test-agent",
      searchable_text: "Current artifact with durable procurement topic.",
    });

    expect(searchFiles("obsolete codename", { limit: 10, search_scope: "content" })).toHaveLength(0);
    expect(searchFiles("durable procurement", { limit: 10, search_scope: "content" }).map((result) => result.id)).toContain(file.id);

    const docs = listFileSearchDocuments({ file_id: file.id, limit: 10 });
    expect(docs.filter((doc) => doc.status === "stale")).toHaveLength(1);
    expect(docs.filter((doc) => doc.status === "ready")).toHaveLength(1);
  });

  test("reports active canonical and derived-search coverage", async () => {
    const { getDb } = await import("./database.js");
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { updateFileOrganizationReview } = await import("./organization.js");
    const { getFileSearchIndexStats, upsertFileSearchDocument } = await import("./file-search-documents.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Coverage source",
      type: "local",
      path: "/tmp/coverage-source",
      machine_id: machine.id,
    });
    const indexed = upsertFile({
      id: "f_search_coverage_indexed",
      source_id: source.id,
      machine_id: machine.id,
      path: "incoming/indexed.pdf",
      name: "indexed.pdf",
      ext: ".pdf",
      size: 100,
      mime: "application/pdf",
      hash: "hash-coverage-indexed",
      status: "active",
    });
    const missing = upsertFile({
      id: "f_search_coverage_missing",
      source_id: source.id,
      machine_id: machine.id,
      path: "incoming/missing.pdf",
      name: "missing.pdf",
      ext: ".pdf",
      size: 100,
      mime: "application/pdf",
      hash: "hash-coverage-missing",
      status: "active",
    });

    for (const file of [indexed, missing]) {
      getDb().run(
        `INSERT INTO file_organization_reviews (
          id, file_id, source_id, root_type, original_path, current_path,
          target_path, owner, labels, review_status, priority
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `review_${file.id}`,
          file.id,
          source.id,
          "unknown",
          file.path,
          file.path,
          null,
          null,
          JSON.stringify([]),
          "unreviewed",
          "normal",
        ],
      );
    }

    updateFileOrganizationReview(indexed.id, {
      status: "approved",
      owner: "finance",
      target_path: "finance/contracts/indexed.pdf",
      labels: ["finance"],
      actor: "test",
    });
    updateFileOrganizationReview(missing.id, {
      status: "approved",
      owner: "finance",
      target_path: "finance/contracts/missing.pdf",
      labels: ["finance"],
      actor: "test",
    });
    upsertFileSearchDocument({
      file_id: indexed.id,
      source_ref: `open-files://file/${indexed.id}`,
      kind: "llm_summary",
      extractor: "test-agent",
      searchable_text: "Bounded summary for coverage test.",
    });

    const stats = getFileSearchIndexStats();
    expect(stats.active_files).toBe(2);
    expect(stats.active_indexed_files).toBe(1);
    expect(stats.missing_indexed_active_files).toBe(1);
    expect(stats.indexed_active_coverage_pct).toBe(50);
    expect(stats.organized_active_files).toBe(2);
    expect(stats.active_files_with_owner).toBe(2);
    expect(stats.active_files_with_target_path).toBe(2);
    expect(stats.active_files_with_canonical_name).toBe(2);
    expect(stats.by_owner).toContainEqual({ owner: "finance", active_files: 2, indexed_files: 1 });
    expect(stats.by_review_status).toContainEqual({ review_status: "approved", active_files: 2, indexed_files: 1 });
  });
});
