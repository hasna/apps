import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type PackageJson = {
  bin?: Record<string, string>;
  files?: string[];
};

type PackedFile = {
  path: string;
  mode: number;
};

type PackResult = {
  files: PackedFile[];
};

function run(command: string, args: string[], env: Record<string, string | undefined> = {}): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function requireSuccess(result: SpawnSyncReturns<string>, label: string): void {
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}
stdout:
${result.stdout}
stderr:
${result.stderr}`);
  }
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageJson;
}

function copyExecutable(relativePath: string, name: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "open-calendar-bin-"));
  const executable = join(dir, name);
  copyFileSync(join(repoRoot, relativePath), executable);
  chmodSync(executable, 0o755);
  return { dir, path: executable };
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        server.close();
        reject(new Error("Could not allocate a local test port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 3000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error ? lastError : new Error("Server did not become healthy");
}

async function waitForExit(child: ChildProcess, timeoutMs = 3000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Process did not exit after shutdown"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("release bin artifacts", () => {
  beforeAll(() => {
    requireSuccess(run("bun", ["run", "build"]), "bun run build");
  });

  test("build emits executable bun bin files and package metadata preserves them", () => {
    const pkg = readPackageJson();
    const binEntries = Object.entries(pkg.bin ?? {});
    expect(binEntries.length).toBeGreaterThan(0);

    for (const entry of pkg.files ?? []) {
      expect(existsSync(join(repoRoot, entry))).toBe(true);
    }

    const packResult = run("npm", ["pack", "--dry-run", "--json"]);
    requireSuccess(packResult, "npm pack --dry-run --json");
    const [pack] = JSON.parse(packResult.stdout) as PackResult[];
    const packedFiles = new Map(pack.files.map((file) => [file.path, file]));

    for (const [, relativePath] of binEntries) {
      const binPath = join(repoRoot, relativePath);
      expect(readFileSync(binPath, "utf8").split("\n")[0]).toBe("#!/usr/bin/env bun");
      expect(statSync(binPath).mode & 0o111).not.toBe(0);

      const packedFile = packedFiles.get(relativePath);
      expect(packedFile).toBeDefined();
      expect(packedFile!.mode & 0o111).not.toBe(0);
    }
  });

  test("calendar bin runs through its shebang like an installed executable", () => {
    const pkg = readPackageJson();
    const calendarBin = pkg.bin?.["calendar"];
    expect(calendarBin).toBeDefined();

    const home = mkdtempSync(join(tmpdir(), "open-calendar-home-"));
    const executable = copyExecutable(calendarBin!, "calendar");
    try {
      const version = spawnSync(executable.path, ["--version"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          BUN_TEST: "1",
          CALENDAR_DB_PATH: join(home, "calendar.db"),
        },
      });
      requireSuccess(version, "calendar --version");
      expect(version.stdout.trim()).toBe(pkg.version);

      const result = spawnSync(executable.path, ["--help"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          BUN_TEST: "1",
          CALENDAR_DB_PATH: join(home, "calendar.db"),
        },
      });

      requireSuccess(result, "calendar --help");
      expect(result.stdout).toContain("Usage: calendar");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(executable.dir, { recursive: true, force: true });
    }
  });

  test("calendar-mcp bin starts through its shebang and exits cleanly on stdin EOF", () => {
    const pkg = readPackageJson();
    const mcpBin = pkg.bin?.["calendar-mcp"];
    expect(mcpBin).toBeDefined();

    const home = mkdtempSync(join(tmpdir(), "open-calendar-mcp-home-"));
    const executable = copyExecutable(mcpBin!, "calendar-mcp");
    try {
      const result = spawnSync(executable.path, [], {
        cwd: repoRoot,
        encoding: "utf8",
        input: "",
        env: {
          ...process.env,
          HOME: home,
          BUN_TEST: "1",
          CALENDAR_DB_PATH: join(home, "calendar.db"),
        },
      });

      requireSuccess(result, "calendar-mcp");
      expect(result.stderr).not.toContain("//: Is a directory");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(executable.dir, { recursive: true, force: true });
    }
  });

  test("calendar-serve bin starts through its shebang and serves health", async () => {
    const pkg = readPackageJson();
    const serveBin = pkg.bin?.["calendar-serve"];
    expect(serveBin).toBeDefined();

    const port = await getAvailablePort();
    const home = mkdtempSync(join(tmpdir(), "open-calendar-serve-home-"));
    const executable = copyExecutable(serveBin!, "calendar-serve");
    const child = spawn(executable.path, [], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        BUN_TEST: "1",
        CALENDAR_DB_PATH: join(home, "calendar.db"),
        CALENDAR_PORT: String(port),
      },
      stdio: "ignore",
    });

    try {
      const response = await waitForHealth(`http://127.0.0.1:${port}/api/health`);
      const health = await response.json() as { status?: string };
      expect(health.status).toBe("ok");
    } finally {
      child.kill("SIGINT");
      await waitForExit(child);
      rmSync(home, { recursive: true, force: true });
      rmSync(executable.dir, { recursive: true, force: true });
    }
  });
});
