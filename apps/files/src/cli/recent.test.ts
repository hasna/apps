import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");

let server: ReturnType<typeof Bun.serve> | undefined;
let testDir: string | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("files recent (cloud transport)", () => {
  test("degrades gracefully when the self-hosted service lacks the /v1/files/recent route (404)", async () => {
    // A self-hosted service older than the Store-seam release exposes no recent
    // route, so the cloud transport gets a 404. The CLI must emit a clean,
    // guard-style message rather than leaking the raw transport error
    // (`Hasna cloud request failed: GET /files/recent?limit=20 -> 404`).
    server = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) });

    const result = await runRecent(server.port);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unavailable on the connected self-hosted service");
    expect(result.stderr).not.toContain("Hasna cloud request failed");
    expect(result.stdout.trim()).toBe("");
  });

  test("prints the cloud service's recent files as JSON when the route is supported", async () => {
    const payload = [
      {
        id: "f_1",
        name: "report.pdf",
        size: 42,
        indexed_at: "2026-07-01T00:00:00Z",
        last_touched: "2026-07-02T00:00:00Z",
        source_id: "s_1",
      },
    ];
    server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/v1/files/recent" && req.method === "GET") return Response.json(payload);
        return new Response("not found", { status: 404 });
      },
    });

    const result = await runRecent(server.port);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });
});

async function runRecent(port: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  testDir = mkdtempSync(join(tmpdir(), "files-cli-recent-"));
  // Async spawn (not spawnSync): the mock server shares this event loop and must
  // stay responsive while the CLI subprocess runs.
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliPath, "recent", "--json"],
    env: {
      ...process.env,
      // Bind the client to the cloud (api) transport pointed at the mock server.
      HASNA_FILES_DATA_DIR: testDir,
      HASNA_FILES_DB_PATH: join(testDir, "files.db"),
      HASNA_FILES_API_URL: `http://127.0.0.1:${port}`,
      HASNA_FILES_API_KEY: "hf_test_key_not_used_offline",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}
