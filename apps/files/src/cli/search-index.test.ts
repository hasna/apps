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

describe("search-index CLI", () => {
  test("indexes a derived text artifact and finds it through content search", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-search-index-cli-"));
    const sourceRoot = join(testDir, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "opaque.bin"), "binary placeholder");
    const artifactPath = join(testDir, "artifact.txt");
    writeFileSync(artifactPath, "Agent-visible summary for warehouse lease renewal.");
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
    const file = files.find((entry) => entry.name === "opaque.bin")!;

    const add = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "search-index",
        "add",
        file.id,
        "--kind",
        "llm_summary",
        "--extractor",
        "test-agent",
        "--text-file",
        artifactPath,
        "--json",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(add.exitCode).toBe(0);
    const document = JSON.parse(new TextDecoder().decode(add.stdout)) as {
      id: string;
      kind: string;
      searchable_chars: number;
      searchable_text?: string;
    };
    expect(document.id).toMatch(/^fsd_/);
    expect(document.kind).toBe("llm_summary");
    expect(document.searchable_chars).toBeGreaterThan(0);
    expect(document.searchable_text).toBeUndefined();

    const search = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "search", "warehouse lease", "--scope", "content", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(search.exitCode).toBe(0);
    const results = JSON.parse(new TextDecoder().decode(search.stdout)) as Array<{
      id: string;
      search_match_sources?: string[];
      search_document_kinds?: string[];
    }>;
    expect(results.map((result) => result.id)).toContain(file.id);
    const result = results.find((entry) => entry.id === file.id)!;
    expect(result.search_match_sources).toEqual(["content"]);
    expect(result.search_document_kinds).toEqual(["llm_summary"]);

    const stats = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "search-index", "stats", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stats.exitCode).toBe(0);
    const statsJson = JSON.parse(new TextDecoder().decode(stats.stdout)) as {
      active_files: number;
      active_indexed_files: number;
      missing_indexed_active_files: number;
      indexed_active_coverage_pct: number;
    };
    expect(statsJson.active_files).toBe(1);
    expect(statsJson.active_indexed_files).toBe(1);
    expect(statsJson.missing_indexed_active_files).toBe(0);
    expect(statsJson.indexed_active_coverage_pct).toBe(100);
  });
});
