import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-extraction-snapshot-"));
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

describe("extraction snapshots", () => {
  test("builds deterministic pages, sections, and content hash from extracted text", async () => {
    const { extractTextSnapshotFromBuffer } = await import("./extraction-snapshot.js");

    const input = {
      source_ref: "open-files://file/f_123/revision/rev_456",
      file_id: "f_123",
      revision_id: "rev_456",
      mime: "text/markdown",
      bytes: Buffer.from("# Intro\nhello and welcome\n\n## Next\nsecond section\n", "utf8"),
      max_segment_chars: 256,
    };

    const first = extractTextSnapshotFromBuffer(input);
    const second = extractTextSnapshotFromBuffer(input);

    expect(first.snapshot_id).toBe(second.snapshot_id);
    expect(first.content_hash).toBe(second.content_hash);
    expect(first).toMatchObject({
      source_ref: "open-files://file/f_123/revision/rev_456",
      file_id: "f_123",
      revision_id: "rev_456",
      status: "ready",
      content_hash_algorithm: "sha256",
      mime: "text/markdown",
      redacted: false,
      truncated: false,
    });
    expect(first.pages).toHaveLength(1);
    expect(first.sections.map((section) => section.title)).toEqual(["Intro", "Next"]);
    expect(first.sections[0]).toMatchObject({
      page_number: 1,
      byte_start: 0,
      char_start: 0,
      line_start: 1,
    });
    expect(first.content_hints).toContain("markdown");
    expect(first.language_hints).toContain("en");
  });

  test("extracts snapshots from local files through revision refs", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { extractTextSnapshotFromFile } = await import("./extraction-snapshot.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    const text = "# Payroll\nredact this secret\n";
    writeFileSync(join(sourceRoot, "notes.md"), text);

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Local docs",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_snapshotLocal",
      source_id: source.id,
      machine_id: machine.id,
      path: "notes.md",
      name: "notes.md",
      ext: ".md",
      size: Buffer.byteLength(text),
      mime: "text/markdown",
      hash: "c".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    const snapshot = await extractTextSnapshotFromFile(file.id, {
      redact_patterns: [/secret/g],
    });

    expect(snapshot.source_ref).toMatch(/^open-files:\/\/file\/f_snapshotLocal\/revision\/rev_/);
    expect(snapshot.revision_id).toBeDefined();
    expect(snapshot.redacted).toBe(true);
    expect(snapshot.sections[0]?.text).toContain("[REDACTED]");
    expect(snapshot.sections[0]?.text).not.toContain("secret");
  });
});
