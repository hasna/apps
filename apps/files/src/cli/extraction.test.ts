import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("extraction CLI", () => {
  test("prints chunk-ready extracted text as JSON", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-extraction-cli-"));
    const sourceRoot = join(testDir, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "notes.md"), "# Notes\nhello agent\n");
    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: testDir,
      HASNA_FILES_DB_PATH: join(testDir, "files.db"),
    };

    const add = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", sourceRoot, "--name", "docs"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(add.exitCode).toBe(0);

    const index = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "index"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(index.exitCode).toBe(0);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const files = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ id: string; name: string }>;
    const file = files.find((entry) => entry.name === "notes.md")!;

    const extract = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "extract-text", file.id, "--json", "--segment-chars", "256"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(extract.exitCode).toBe(0);
    const result = JSON.parse(new TextDecoder().decode(extract.stdout)) as {
      status: string;
      source_ref: string;
      segments: Array<{ text: string; section_hint?: string }>;
    };

    expect(result.status).toBe("ready");
    expect(result.source_ref).toMatch(/^open-files:\/\/file\/f_/);
    expect(result.segments[0]?.text).toContain("hello agent");
    expect(result.segments[0]?.section_hint).toBe("Notes");
  });

  test("prints deterministic extraction snapshots as JSON", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-extraction-snapshot-cli-"));
    const sourceRoot = join(testDir, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "notes.md"), "# Notes\nhello snapshot\n");
    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: testDir,
      HASNA_FILES_DB_PATH: join(testDir, "files.db"),
    };

    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", sourceRoot, "--name", "docs"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);
    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "index"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const files = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ id: string; name: string }>;
    const file = files.find((entry) => entry.name === "notes.md")!;

    const snapshot = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "extract-snapshot", file.id, "--json", "--segment-chars", "256"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(snapshot.exitCode).toBe(0);
    const result = JSON.parse(new TextDecoder().decode(snapshot.stdout)) as {
      status: string;
      snapshot_id: string;
      sections: Array<{ title?: string; text: string }>;
      content_hash_algorithm: string;
    };

    expect(result.status).toBe("ready");
    expect(result.snapshot_id).toMatch(/^snap_/);
    expect(result.content_hash_algorithm).toBe("sha256");
    expect(result.sections[0]?.title).toBe("Notes");
    expect(result.sections[0]?.text).toContain("hello snapshot");
  });
});
