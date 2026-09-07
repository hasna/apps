import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..", "..");
const mcpEntry = join(repoRoot, "src", "mcp", "index.ts");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "files-mcp-startup-"));
  tempDirs.push(dir);
  return dir;
}

test("MCP help exits without creating or opening the files database", async () => {
  const dataDir = makeDataDir();
  const proc = Bun.spawn({
    cmd: ["bun", "run", mcpEntry, "--help"],
    cwd: repoRoot,
    env: { ...process.env, HASNA_FILES_DATA_DIR: dataDir },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Usage: files-mcp");
  expect(stdout).toContain("HTTP port (default: 8863, env: MCP_HTTP_PORT)");
  expect(stderr).toBe("");
  await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
});

test("MCP initialize responds without creating or opening the files database", async () => {
  const dataDir = makeDataDir();
  const proc = Bun.spawn({
    cmd: ["bun", "run", mcpEntry, "--stdio"],
    cwd: repoRoot,
    env: { ...process.env, HASNA_FILES_DATA_DIR: dataDir },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "startup-test", version: "0.0.0" },
      },
    }) + "\n",
  );

  const stdoutReader = proc.stdout.getReader();
  const timeout = setTimeout(() => proc.kill(), 5000);
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { value, done } = await stdoutReader.read();
      if (value) chunks.push(value);
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.includes('"id":1')) {
        expect(text).toContain('"protocolVersion"');
        await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
        proc.kill();
        await proc.exited;
        return;
      }
      if (done) break;
    }
  } finally {
    clearTimeout(timeout);
    proc.kill();
  }

  const stderr = await new Response(proc.stderr).text();
  throw new Error(`MCP initialize did not respond. stderr: ${stderr}`);
});

test("MCP refuses to start without a resolvable credential or a local opt-in (fail closed)", async () => {
  const dataDir = makeDataDir();
  const env = { ...process.env, HOME: dataDir, HASNA_HOME: dataDir, HASNA_FILES_DATA_DIR: dataDir };
  for (const key of [
    "HASNA_FILES_API_URL",
    "FILES_API_URL",
    "HASNA_FILES_API_KEY",
    "FILES_API_KEY",
    "HASNA_FILES_LOCAL",
    "FILES_LOCAL",
    "HASNA_FILES_LOCAL_MODE",
    "FILES_LOCAL_MODE",
    "HASNA_FILES_STORAGE_MODE",
    "HASNA_PROFILE",
    "HASNA_FILES_API_KEY_OVERRIDE",
    "HASNA_FILES_API_KEY_REF",
  ]) {
    delete env[key];
  }

  const proc = Bun.spawn({
    cmd: ["bun", "run", mcpEntry, "--stdio"],
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("HASNA_FILES_API_URL");
  expect(stderr).toContain("no local fallback");
  await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
});
