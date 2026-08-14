import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-extraction-"));
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

describe("text extraction", () => {
  test("segments text with byte spans and markdown section hints", async () => {
    const { extractTextFromBuffer } = await import("./extraction.js");

    const result = extractTextFromBuffer({
      source_ref: "open-files://file/f_123/revision/rev_456",
      file_id: "f_123",
      revision_id: "rev_456",
      mime: "text/markdown",
      bytes: Buffer.from(`# Intro\n${"hello world ".repeat(30)}\n\n## Next\nsecond section\n`, "utf8"),
      max_segment_chars: 256,
    });

    expect(result.status).toBe("ready");
    expect(result.encoding).toBe("utf-8");
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments[0]).toMatchObject({
      index: 0,
      byte_start: 0,
      char_start: 0,
      line_start: 1,
      section_hint: "Intro",
    });
    expect(result.segments.some((segment) => segment.section_hint === "Next")).toBe(true);
  });

  test("extracts local files through revision refs and applies redaction hooks", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { extractTextFromFile } = await import("./extraction.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    const text = "Email: agent@example.com\nKeep this line.\n";
    writeFileSync(join(sourceRoot, "notes.txt"), text);

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Local docs",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_extractLocal",
      source_id: source.id,
      machine_id: machine.id,
      path: "notes.txt",
      name: "notes.txt",
      ext: ".txt",
      size: Buffer.byteLength(text),
      mime: "text/plain",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    const result = await extractTextFromFile(file.id, {
      redact_patterns: [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
    });

    expect(result.source_ref).toMatch(/^open-files:\/\/file\/f_extractLocal\/revision\/rev_/);
    expect(result.revision_id).toBeDefined();
    expect(result.status).toBe("ready");
    expect(result.redacted).toBe(true);
    expect(result.segments[0]?.text).toContain("[REDACTED]");
    expect(result.segments[0]?.text).not.toContain("agent@example.com");
  });

  test("reports unsupported binary MIME without reading content", async () => {
    const { extractTextFromBuffer } = await import("./extraction.js");

    const result = extractTextFromBuffer({
      source_ref: "open-files://file/f_bin",
      file_id: "f_bin",
      mime: "application/octet-stream",
      bytes: Buffer.from([0, 1, 2, 3]),
      total_size: 4,
    });

    expect(result.status).toBe("unsupported");
    expect(result.bytes_read).toBe(0);
    expect(result.segments).toEqual([]);
  });
});
