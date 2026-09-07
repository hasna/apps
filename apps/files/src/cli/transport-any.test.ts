/**
 * Every `files` command works on BOTH transports (allcmds campaign — the
 * storage-mode axis is retired, owner directive 2026-08-15). These tests lock
 * the hosted-transport behavior of the commands whose gates were removed:
 *
 *   - content commands (cat, where, resolve, extract-snapshot) serve hosted
 *     files through the service's content/sign/extract routes;
 *   - search-index stats/rebuild-fts answer from the hosted API surface;
 *   - machine commands (db, index, peers, watch, organize, knowledge outbox,
 *     Google Drive) announce the on-box store and run their machine operation
 *     instead of refusing with transport vocabulary.
 *
 * Every subprocess env isolates the credential disk tier (HASNA_HOME) so the
 * station's real credentials file can never leak into a fake-URL test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
const API_KEY = "fixture-transport-any-key";
const CONTENT = "TRANSPORT_ANY_CONTENT_5501\nline two\nline three\n";

let testDir: string;
let server: ReturnType<typeof Bun.serve>;
let requests: Array<{ method: string; path: string }>;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-transport-any-"));
  requests = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      requests.push({ method: req.method, path: url.pathname });
      if (req.headers.get("x-api-key") !== API_KEY) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (req.method === "GET" && url.pathname === "/v1/files/f_remote") {
        return Response.json({
          id: "f_remote",
          source_id: "src_remote",
          machine_id: "m_remote",
          path: "notes.md",
          name: "notes.md",
          ext: ".md",
          size: CONTENT.length,
          mime: "text/markdown",
          canonical_name: "notes.md",
          hash: "d".repeat(64),
          status: "active",
          indexed_at: "2026-08-18T00:00:00.000Z",
          created_at: "2026-08-18T00:00:00.000Z",
          modified_at: "2026-08-18T00:00:00.000Z",
          tags: [],
        });
      }
      if (req.method === "GET" && url.pathname === "/v1/files/f_remote/content") {
        return new Response(CONTENT, { headers: { "content-type": "text/markdown" } });
      }
      if (req.method === "POST" && url.pathname === "/v1/files/f_remote/sign-download") {
        return Response.json({ url: "https://s3.example.test/signed-f_remote" });
      }
      if (req.method === "POST" && url.pathname === "/v1/files/f_remote/extract-text") {
        return Response.json({
          source_ref: "open-files://file/f_remote",
          file_id: "f_remote",
          status: "ready",
          mime: "text/markdown",
          bytes_read: CONTENT.length,
          truncated: false,
          redacted: false,
          segments: [{ index: 0, text: "TRANSPORT_ANY_CONTENT_5501", byte_start: 0, byte_end: 24, char_start: 0, char_end: 24, line_start: 1, line_end: 1 }],
          metadata: { extractor: "fixture-extractor", max_bytes: 1048576, max_segment_chars: 4000, supported_mime: true },
        });
      }
      if (req.method === "GET" && url.pathname === "/v1/search-documents") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (offset > 0 || limit === 0) return Response.json([]);
        return Response.json([{
          id: "fsd_remote",
          file_id: "f_remote",
          source_ref: "open-files://file/f_remote",
          kind: "extracted_text",
          extractor: "fixture-extractor",
          content_hash: "e".repeat(64),
          searchable_text: "ignored",
          metadata: {},
          status: "ready",
          private: false,
          created_at: "2026-08-18T00:00:00.000Z",
          updated_at: "2026-08-18T00:00:00.000Z",
        }]);
      }
      if (req.method === "GET" && url.pathname === "/v1/files") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (offset > 0) return Response.json({ items: [] });
        return Response.json({
          items: [{
            id: "f_remote",
            source_id: "src_remote",
            machine_id: "m_remote",
            path: "notes.md",
            name: "notes.md",
            ext: ".md",
            size: CONTENT.length,
            mime: "text/markdown",
            canonical_name: "notes.md",
            status: "active",
            indexed_at: "2026-08-18T00:00:00.000Z",
            created_at: "2026-08-18T00:00:00.000Z",
            modified_at: "2026-08-18T00:00:00.000Z",
            tags: [],
          }],
        });
      }
      return Response.json({ error: "File not found" }, { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  rmSync(testDir, { recursive: true, force: true });
});

function hostedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: testDir,
    HASNA_HOME: testDir,
    HASNA_FILES_DATA_DIR: testDir,
    HASNA_FILES_DB_PATH: join(testDir, "files.db"),
    HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}/v1`,
    HASNA_FILES_API_KEY: API_KEY,
  };
}

describe("hosted content commands (transport-any)", () => {
  test("cat streams the hosted content route to stdout", async () => {
    const result = await runCli(["cat", "f_remote"], hostedEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(CONTENT);
    expect(requests).toContainEqual({ method: "GET", path: "/v1/files/f_remote/content" });
  });

  test("where prints the signed object-store URL", async () => {
    const result = await runCli(["where", "f_remote"], hostedEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("https://s3.example.test/signed-f_remote");
    expect(requests).toContainEqual({ method: "POST", path: "/v1/files/f_remote/sign-download" });
  });

  test("resolve reports the hosted storage location", async () => {
    const result = await runCli(["resolve", "f_remote", "--json"], hostedEnv());
    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout) as { kind: string; provider: string; url: string; file_id: string };
    expect(summary.kind).toBe("s3");
    expect(summary.provider).toBe("hosted-service");
    expect(summary.url).toBe("https://s3.example.test/signed-f_remote");
    expect(summary.file_id).toBe("f_remote");
  });

  test("extract-snapshot derives a deterministic snapshot from the hosted extract route", async () => {
    const result = await runCli(["extract-snapshot", "f_remote", "--json"], hostedEnv());
    expect(result.exitCode).toBe(0);
    const snapshot = JSON.parse(result.stdout) as { snapshot_id: string; status: string; content_hash_algorithm: string };
    expect(snapshot.snapshot_id.startsWith("snap_")).toBe(true);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.content_hash_algorithm).toBe("sha256");
    expect(requests.some((r) => r.method === "POST" && r.path === "/v1/files/f_remote/extract-text")).toBe(true);
  });

  test("search-index stats computes coverage from the hosted API surface", async () => {
    const result = await runCli(["search-index", "stats", "--json"], hostedEnv());
    expect(result.exitCode).toBe(0);
    const stats = JSON.parse(result.stdout) as { documents: number; indexed_files: number; active_files: number; hosted: boolean };
    expect(stats.hosted).toBe(true);
    expect(stats.documents).toBe(1);
    expect(stats.indexed_files).toBe(1);
    expect(stats.active_files).toBe(1);
  });

  test("search-index rebuild-fts reports the server-maintained index without touching anything", async () => {
    const result = await runCli(["search-index", "rebuild-fts"], hostedEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("refreshed 0 search document(s)");
    expect(requests).toHaveLength(0);
  });

  test("db reports the on-box SQLite path under a hosted credential with the LOCAL-mode announcement", async () => {
    const result = await runCli(["db"], hostedEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(join(testDir, "files.db"));
    expect(result.stderr).toContain("LOCAL mode");
  });

  test("index announces the on-box store and reports no local sources instead of refusing", async () => {
    const result = await runCli(["index"], hostedEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("LOCAL mode");
    expect(result.stdout).toContain("No sources to index");
  });
});

describe("local transport controls (transport-any)", () => {
  test("content commands still answer against on-box files", async () => {
    const env = { ...hostedEnv() };
    delete env.HASNA_FILES_API_URL;
    delete env.HASNA_FILES_API_KEY;
    env.HASNA_FILES_LOCAL = "1";
    mkdirSync(join(testDir, "source"), { recursive: true });
    writeFileSync(join(testDir, "source", "notes.md"), "local-any-content\n");

    const add = await runCli(["sources", "add", join(testDir, "source"), "-n", "any"], env);
    expect(add.exitCode).toBe(0);
    const indexed = await runCli(["index"], env);
    expect(indexed.exitCode).toBe(0);

    const list = await runCli(["list", "--json"], env);
    expect(list.exitCode).toBe(0);
    const files = JSON.parse(list.stdout) as Array<{ id: string; name: string }>;
    expect(files.length).toBeGreaterThanOrEqual(1);
    const file = files.find((entry) => entry.name === "notes.md")!;

    const cat = await runCli(["cat", file.id], env);
    expect(cat.exitCode).toBe(0);
    expect(cat.stdout).toBe("local-any-content\n");

    const where = await runCli(["where", file.id], env);
    expect(where.exitCode).toBe(0);
    expect(where.stdout.trim()).toBe(join(testDir, "source", "notes.md"));

    const resolve = await runCli(["resolve", file.id, "--json"], env);
    expect(resolve.exitCode).toBe(0);
    const summary = JSON.parse(resolve.stdout) as { storage: { kind: string } };
    expect(summary.storage.kind).toBe("local");
  });
});

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: process.cwd(),
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
