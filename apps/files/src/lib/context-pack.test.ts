import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-context-pack-"));
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

describe("files context packs", () => {
  test("builds bounded excerpts with citations, attachment refs, redaction, and deterministic ids", async () => {
    const { fileId } = await seedFiles();
    const { buildFilesContextPack } = await import("./context-pack.js");

    const first = await buildFilesContextPack({
      file_ids: [fileId],
      max_files: 1,
      max_excerpts: 1,
      max_excerpt_chars: 120,
      max_total_chars: 120,
    });
    const second = await buildFilesContextPack({
      file_ids: [fileId],
      max_files: 1,
      max_excerpts: 1,
      max_excerpt_chars: 120,
      max_total_chars: 120,
    });

    expect(first.schema_version).toBe("files.context_pack.v1");
    expect(first.pack_id).toBe(second.pack_id);
    expect(first.files).toHaveLength(1);
    expect(first.files[0]?.excerpts).toHaveLength(1);
    expect(first.citations[0]).toMatchObject({
      id: "c1",
      file_id: fileId,
      attachment_ref: `open-files://file/${fileId}`,
      line_start: 1,
    });
    expect(first.attachment_refs[0]).toMatchObject({
      ref: `open-files://file/${fileId}`,
      file_id: fileId,
      mime: "text/markdown",
    });
    const serialized = JSON.stringify(first);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("sk-openai");
    expect(first.counts.included_excerpts).toBe(1);
    expect(first.counts.omitted_chars).toBeGreaterThan(0);
  });

  test("search packs cap matched files and report omitted counts", async () => {
    await seedFiles();
    const { buildFilesSearchPack } = await import("./context-pack.js");

    const pack = await buildFilesSearchPack({
      query: "renewal",
      max_files: 1,
      max_excerpts: 3,
      max_excerpt_chars: 120,
      max_total_chars: 240,
    });

    expect(pack.mode).toBe("search");
    expect(pack.query).toBe("renewal");
    expect(pack.counts.matched_files).toBeGreaterThanOrEqual(1);
    expect(pack.files).toHaveLength(1);
    expect(pack.files[0]?.excerpts.length).toBeGreaterThan(0);
    expect(pack.counts.omitted_files).toBe(1);
  });

  test("preserves explicit revision refs in citations", async () => {
    const { fileId } = await seedFiles();
    const { getLatestFileVersion } = await import("../db/file-versions.js");
    const { upsertFile } = await import("../db/files.js");
    const { getCurrentMachine } = await import("../db/machines.js");
    const { buildOpenFilesFileRevisionRef } = await import("./source-ref.js");
    const { buildFilesContextPack } = await import("./context-pack.js");

    const oldRevision = getLatestFileVersion(fileId)!;
    upsertFile({
      id: fileId,
      source_id: oldRevision.source_id,
      machine_id: getCurrentMachine().id,
      path: "supplier-renewal.md",
      name: "supplier-renewal.md",
      ext: ".md",
      size: 200,
      mime: "text/markdown",
      hash: "d".repeat(64),
      status: "active",
    });
    const oldRef = buildOpenFilesFileRevisionRef(fileId, oldRevision.id);

    const pack = await buildFilesContextPack({ source_refs: [oldRef], max_excerpts: 1 });
    expect(pack.files[0]?.revision_id).toBe(oldRevision.id);
    expect(pack.files[0]?.source_ref).toBe(oldRef);
    expect(pack.citations[0]?.source_ref).toBe(oldRef);
  });
});

async function seedFiles(): Promise<{ fileId: string }> {
  const { getCurrentMachine } = await import("../db/machines.js");
  const { createSource } = await import("../db/sources.js");
  const { upsertFile } = await import("../db/files.js");

  const root = join(testDir!, "source");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "supplier-renewal.md"),
    [
      "# Supplier renewal",
      "The contract renewal should be reviewed by finance.",
      "password=supersecret should never appear in an agent pack.",
      "OPENAI_API_KEY=sk-openai-example-secret-value",
      "Include pricing exception notes and renewal dates.",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "renewal-notes.txt"), "Another renewal note for omitted file counting.\n");
  const machine = getCurrentMachine();
  const source = createSource({
    name: "Context source",
    type: "local",
    path: root,
    machine_id: machine.id,
  });
  const file = upsertFile({
    id: "f_context_pack",
    source_id: source.id,
    machine_id: machine.id,
    path: "supplier-renewal.md",
    name: "supplier-renewal.md",
    ext: ".md",
    size: 180,
    mime: "text/markdown",
    hash: "a".repeat(64),
    status: "active",
  });
  upsertFile({
    id: "f_context_pack_2",
    source_id: source.id,
    machine_id: machine.id,
    path: "renewal-notes.txt",
    name: "renewal-notes.txt",
    ext: ".txt",
    size: 48,
    mime: "text/plain",
    hash: "b".repeat(64),
    status: "active",
  });
  return { fileId: file.id };
}
