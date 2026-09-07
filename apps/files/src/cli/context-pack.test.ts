import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("context-pack CLI", () => {
  test("prints bounded JSON packs and dry-run artifact pointers", () => {
    const env = seedCliFiles();
    const files = JSON.parse(stdout(run(["list", "--json"], env))) as Array<{ id: string; name: string }>;
    const file = files.find((entry) => entry.name === "loop-receipt.txt")!;

    const context = run(["context-pack", `open-files://file/${file.id}`, "--max-excerpt-chars", "64", "--max-total-chars", "64"], env);
    expect(context.exitCode).toBe(0);
    expect(stdout(context).trim()).not.toContain("\n");
    const pack = JSON.parse(stdout(context)) as {
      pack_id: string;
      files: Array<{ excerpts: Array<{ text: string }> }>;
      citations: unknown[];
      attachment_refs: unknown[];
      counts: { omitted_chars: number };
    };
    expect(pack.pack_id).toMatch(/^ctxpack_/);
    expect(pack.files[0]?.excerpts[0]?.text.length).toBeLessThanOrEqual(64);
    expect(pack.citations).toHaveLength(1);
    expect(pack.attachment_refs).toHaveLength(1);
    expect(pack.counts.omitted_chars).toBeGreaterThan(0);

    const outPath = join(testDir!, "pack.json");
    const dryRun = run(["search-pack", "loop receipt", "--max-files", "1", "--out", outPath, "--dry-run"], env);
    expect(dryRun.exitCode).toBe(0);
    expect(stdout(dryRun).trim()).not.toContain("\n");
    const pointer = JSON.parse(stdout(dryRun)) as {
      dry_run: boolean;
      artifact: { path: string };
      pack_id: string;
      citations?: unknown[];
      citation_count: number;
    };
    expect(pointer.dry_run).toBe(true);
    expect(pointer.artifact.path).toBe(outPath);
    expect(pointer.pack_id).toMatch(/^ctxpack_/);
    expect(pointer.citations).toBeUndefined();
    expect(pointer.citation_count).toBeGreaterThanOrEqual(1);
    expect(existsSync(outPath)).toBe(false);
  });

  test("builds context and search packs on the hosted transport through the service's data and extraction routes", async () => {
    testDir = mkdtempSync(join(tmpdir(), "files-cli-context-pack-api-"));
    const dataDir = join(testDir, "data");
    mkdirSync(dataDir, { recursive: true });
    // A fake files service: file metadata, ranked search, content route, and
    // the server-side extract-text route the hosted pack builder consumes.
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname.replace(/^\/v1/, "") || "/";
        if (req.headers.get("x-api-key") !== "hf_test_key") {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (req.method === "GET" && path === "/files/f_remote") {
          return Response.json({
            id: "f_remote",
            source_id: "src_remote",
            machine_id: "m_remote",
            path: "notes.md",
            name: "notes.md",
            ext: ".md",
            size: 34,
            mime: "text/markdown",
            hash: "c".repeat(64),
            status: "active",
            indexed_at: "2026-08-18T00:00:00.000Z",
            created_at: "2026-08-18T00:00:00.000Z",
            modified_at: "2026-08-18T00:00:00.000Z",
            tags: [],
          });
        }
        if (req.method === "GET" && path === "/files") {
          const q = url.searchParams.get("q");
          if (q !== "loop receipt") return Response.json({ items: [] });
          return Response.json({
            items: [{
              id: "f_remote",
              source_id: "src_remote",
              machine_id: "m_remote",
              path: "notes.md",
              name: "notes.md",
              ext: ".md",
              size: 34,
              mime: "text/markdown",
              hash: "c".repeat(64),
              status: "active",
              indexed_at: "2026-08-18T00:00:00.000Z",
              created_at: "2026-08-18T00:00:00.000Z",
              modified_at: "2026-08-18T00:00:00.000Z",
              tags: [],
              rank: 1,
              search_match_sources: ["metadata"],
            }],
          });
        }
        if (req.method === "POST" && path === "/files/f_remote/extract-text") {
          return Response.json({
            source_ref: "open-files://file/f_remote",
            file_id: "f_remote",
            status: "ready",
            mime: "text/markdown",
            bytes_read: 34,
            total_size: 34,
            truncated: false,
            redacted: false,
            segments: [{
              index: 0,
              text: "Hosted loop receipt stdout line one.",
              byte_start: 0,
              byte_end: 34,
              char_start: 0,
              char_end: 34,
              line_start: 1,
              line_end: 1,
            }],
            metadata: { extractor: "hosted-extractor", max_bytes: 262144, max_segment_chars: 900, supported_mime: true },
          });
        }
        return Response.json({ error: `fake server: no route ${req.method} ${path}` }, { status: 404 });
      },
    });

    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: dataDir,
      HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
      HASNA_HOME: dataDir,
      HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}/v1`,
      HASNA_FILES_API_KEY: "hf_test_key",
    };

    try {
      const context = await runCliAsync(
        ["context-pack", "open-files://file/f_remote", "--max-excerpt-chars", "40", "--max-total-chars", "40"],
        env,
      );
      expect(context.exitCode).toBe(0);
      expect(context.stderr).not.toContain("on-box only");
      const pack = JSON.parse(context.stdout) as {
        pack_id: string;
        files: Array<{ file_id: string; source_ref: string; excerpts: Array<{ text: string }> }>;
        counts: { included_files: number };
      };
      expect(pack.pack_id).toMatch(/^ctxpack_/);
      expect(pack.files[0]?.file_id).toBe("f_remote");
      expect(pack.files[0]?.source_ref).toBe("open-files://file/f_remote");
      expect(pack.files[0]?.excerpts[0]?.text).toContain("Hosted loop receipt");

      const search = await runCliAsync(
        ["search-pack", "loop receipt", "--max-files", "1", "--max-excerpt-chars", "40", "--max-total-chars", "40"],
        env,
      );
      expect(search.exitCode).toBe(0);
      const searchPack = JSON.parse(search.stdout) as { files: Array<{ file_id: string }>; counts: { included_files: number } };
      expect(searchPack.files[0]?.file_id).toBe("f_remote");
    } finally {
      server.stop(true);
    }
  });
});

/** Async spawn so an in-process fake server can answer the subprocess. */
async function runCliAsync(args: string[], env: NodeJS.ProcessEnv): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliPath, ...args],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function seedCliFiles(): NodeJS.ProcessEnv {
  testDir = mkdtempSync(join(tmpdir(), "files-cli-context-pack-"));
  const sourceRoot = join(testDir, "source");
  const dataDir = join(testDir, "data");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(sourceRoot, "loop-receipt.txt"),
    "Loop receipt stdout line one.\nLoop receipt stdout line two with token-heavy detail.\n",
  );
  const env = {
    ...process.env,
    HASNA_FILES_DATA_DIR: dataDir,
    HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
  };
  expect(run(["sources", "add", sourceRoot, "--name", "loop-fixtures"], env).exitCode).toBe(0);
  expect(run(["index"], env).exitCode).toBe(0);
  return env;
}

function run(args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({
    cmd: ["bun", "run", cliPath, ...args],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stdout(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stdout);
}
