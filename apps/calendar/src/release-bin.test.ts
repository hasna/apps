import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type PackageJson = {
  version: string;
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

/**
 * npm pack --json writes the JSON array as the TRAILING document on stdout.
 * The package's `prepack` lifecycle runs `bun run build`, whose "Bundled N
 * modules ..." progress lines interleave with the JSON, so a raw JSON.parse
 * of the whole stdout fails. Walk back from the end and slice the depth-0
 * array. Mirrors the fleet publish-guard extractor
 * (tooling/ci/check-publish-guard.ts extractJsonArraySuffix) and the
 * conversations packaged-worker test fix.
 */
function extractJsonArraySuffix(raw: string): string {
  let i = raw.length - 1;
  while (i >= 0 && /\s/.test(raw[i])) i--;
  if (i < 0 || raw[i] !== "]") {
    throw new Error("pack output has no JSON array document (npm wrote no --json array)");
  }
  let depth = 0;
  let inString = false;
  for (; i >= 0; i--) {
    const c = raw[i];
    if (inString) {
      if (c === '"') {
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && raw[j] === "\\"; j--) backslashes++;
        if (backslashes % 2 === 0) inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "]") {
      depth++;
    } else if (c === "[") {
      depth--;
      if (depth === 0) return raw.slice(i);
    }
  }
  throw new Error("pack output brackets do not balance to a single JSON array");
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
  if (child.exitCode !== null || child.signalCode !== null) return;

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
  }, 120_000);

  test(
    "build emits executable bun bin files and package metadata preserves them",
    () => {
      const pkg = readPackageJson();
      for (const surface of ["dist/index.js", "dist/sdk/index.js", "dist/mcp/index.js", "dist/server/index.js"]) {
        const code = readFileSync(join(repoRoot, surface), "utf8");
        expect(code).not.toContain("bun:sqlite");
        expect(code).not.toContain("class LocalStore");
        expect(code).not.toContain("installDomainFixture");
      }
      const binEntries = Object.entries(pkg.bin ?? {});
      expect(binEntries.length).toBeGreaterThan(0);

      for (const entry of pkg.files ?? []) {
        expect(existsSync(join(repoRoot, entry))).toBe(true);
      }

      const packResult = run("npm", ["pack", "--dry-run", "--json"]);
      requireSuccess(packResult, "npm pack --dry-run --json");
      const [pack] = JSON.parse(extractJsonArraySuffix(packResult.stdout)) as PackResult[];
      const packedFiles = new Map(pack.files.map((file) => [file.path, file]));

      for (const [, relativePath] of binEntries) {
        const binPath = join(repoRoot, relativePath);
        expect(readFileSync(binPath, "utf8").split("\n")[0]).toBe("#!/usr/bin/env bun");
        expect(statSync(binPath).mode & 0o111).not.toBe(0);

        const packedFile = packedFiles.get(relativePath);
        expect(packedFile).toBeDefined();
        expect(packedFile!.mode & 0o111).not.toBe(0);
      }
    },
    120_000,
  );

  test("calendar bin runs through its shebang", () => {
    const pkg = readPackageJson();
    const calendarBin = pkg.bin?.["calendar"];
    expect(calendarBin).toBeDefined();

    const home = mkdtempSync(join(tmpdir(), "calendar-home-"));
    try {
      const env = {
        HOME: home,
        BUN_TEST: "1",
        CALENDAR_DB_PATH: join(home, "calendar.db"),
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      };

      const version = run(join(repoRoot, calendarBin!), ["--version"], env);
      requireSuccess(version, "calendar --version");
      expect(version.stdout.trim()).toBe(pkg.version);

      const help = run(join(repoRoot, calendarBin!), ["--help"], env);
      requireSuccess(help, "calendar --help");
      expect(help.stdout).toContain("Usage: calendar");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("calendar-mcp bin starts through its shebang and exits cleanly on stdin EOF", () => {
    const pkg = readPackageJson();
    const mcpBin = pkg.bin?.["calendar-mcp"];
    expect(mcpBin).toBeDefined();

    const home = mkdtempSync(join(tmpdir(), "calendar-mcp-home-"));
    try {
      const result = spawnSync(join(repoRoot, mcpBin!), [], {
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
    }
  });

  test("calendar-serve bin starts through its shebang and serves health", async () => {
    const pkg = readPackageJson();
    const serveBin = pkg.bin?.["calendar-serve"];
    expect(serveBin).toBeDefined();

    const port = await getAvailablePort();
    const home = mkdtempSync(join(tmpdir(), "calendar-serve-home-"));
    const child = spawn(join(repoRoot, serveBin!), [], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        BUN_TEST: "1",
        CALENDAR_DB_PATH: join(home, "calendar.db"),
        CALENDAR_PORT: String(port),
        // A non-hosted calendar-serve must be given an auth posture or it now
        // refuses to start rather than exposing /mcp anonymously. This bin smoke
        // test binds loopback, so the loopback-only anonymous plane is correct.
        CALENDAR_ALLOW_ANONYMOUS: "1",
        HASNA_CALENDAR_DATABASE_URL: "postgres://fixture@127.0.0.1:1/calendar_test",
      },
      stdio: "ignore",
    });

    try {
      const response = await waitForHealth(`http://127.0.0.1:${port}/health`);
      const health = await response.json() as { status?: string };
      expect(health.status).toBe("ok");
    } finally {
      child.kill("SIGINT");
      await waitForExit(child);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
