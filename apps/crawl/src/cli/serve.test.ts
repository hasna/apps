import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const repoRoot = join(import.meta.dir, "../..");
const processes: Bun.Subprocess[] = [];
const dbPaths: string[] = [];

function randomPort(): number {
  return 21000 + Math.floor(Math.random() * 20000);
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

async function waitForJson(port: number, proc: Bun.Subprocess): Promise<Response> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const exit = await Promise.race([
      proc.exited.then((code) => ({ exited: true, code })),
      Bun.sleep(50).then(() => ({ exited: false, code: null })),
    ]);
    if (exit.exited) {
      const stderr = await readStream(proc.stderr);
      throw new Error(`serve exited early with code ${exit.code}: ${stderr}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { accept: "application/json" },
      });
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(100);
  }

  throw new Error(`serve did not respond on port ${port}: ${String(lastError)}`);
}

afterEach(async () => {
  for (const proc of processes.splice(0)) {
    proc.kill();
    await proc.exited.catch(() => {});
  }

  for (const dbPath of dbPaths.splice(0)) {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  }
});

describe("serve command", () => {
  it("starts the REST API on the requested port", async () => {
    const port = randomPort();
    const dbPath = `/tmp/test-crawl-serve-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    dbPaths.push(dbPath);

    const env = { ...process.env };
    delete env["PORT"];
    env["CRAWL_DB_PATH"] = dbPath;
    env["HASNA_CRAWL_DB_PATH"] = dbPath;

    const proc = Bun.spawn(
      [process.execPath, "run", "src/cli/index.ts", "serve", "-p", String(port)],
      {
        cwd: repoRoot,
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    processes.push(proc);

    const response = await waitForJson(port, proc);
    const body = await response.json();

    expect(body.name).toBe("open-crawl");
    expect(body.port).toBe(port);
  });
});
