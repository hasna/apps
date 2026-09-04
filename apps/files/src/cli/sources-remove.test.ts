import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
const denyNetworkPath = join(process.cwd(), "src/cli/test-fixtures/deny-network.ts");
const remoteSelectorKeys = [
  "HASNA_FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "HASNA_FILES_DATABASE_URL",
  "FILES_API_URL",
  "FILES_API_KEY",
  "FILES_DATABASE_URL",
] as const;
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("source removal CLI", () => {
  test("nested sources remove fails closed when deleteSource returns false", () => {
    const env = cliEnv();
    const sourceId = addSource(env);
    const db = new Database(env.HASNA_FILES_DB_PATH!);
    db.run("CREATE TRIGGER ignore_source_delete BEFORE DELETE ON sources BEGIN SELECT RAISE(IGNORE); END");
    db.close();

    const result = run(["sources", "remove", sourceId, "--yes"], env);

    expect(result.exitCode).toBe(1);
    expect(stdout(result)).not.toContain("removed");
    expect(stderr(result)).toContain(`Source not found: ${sourceId}`);
    expect(JSON.parse(stdout(run(["sources", "list", "--json"], env)))).toHaveLength(1);
  });

  test("nested sources remove preserves success when deleteSource returns true", () => {
    const env = cliEnv();
    const sourceId = addSource(env);
    const result = run(["sources", "remove", sourceId, "--yes"], env);

    expect(result.exitCode).toBe(0);
    expect(stdout(result)).toContain(`Source ${sourceId} removed`);
    expect(stderr(result)).toBe("");
    expect(JSON.parse(stdout(run(["sources", "list", "--json"], env)))).toHaveLength(0);
  });

  test("top-level remove alias remains fail-closed for a missing source", () => {
    const env = cliEnv();
    const missingSourceId = "src_missing";
    const result = run(["remove", missingSourceId, "--yes"], env);

    expect(result.exitCode).toBe(1);
    expect(stdout(result)).not.toContain("removed");
    expect(stderr(result)).toContain("No source found matching");
  });

  test("subprocesses inherit no Files API, key, or database selectors", () => {
    const env = cliEnv();

    for (const key of remoteSelectorKeys) expect(env[key]).toBeUndefined();
    expect(run(["sources", "list", "--json"], env).exitCode).toBe(0);
  });
});

function cliEnv(): NodeJS.ProcessEnv {
  testDir = mkdtempSync(join(tmpdir(), "files-source-remove-cli-"));
  const dataDir = join(testDir, "data");
  mkdirSync(dataDir, { recursive: true });
  return {
    PATH: process.env.PATH,
    HOME: testDir,
    TMPDIR: testDir,
    NO_COLOR: "1",
    // The local data plane now requires the explicit local opt-in; this env is
    // deliberately built from scratch (no inherited selectors), so name it here.
    HASNA_FILES_LOCAL_MODE: "1",
    HASNA_FILES_DATA_DIR: dataDir,
    HASNA_FILES_DB_PATH: join(testDir, "files.db"),
  };
}

function addSource(env: NodeJS.ProcessEnv): string {
  const sourcePath = join(testDir!, "source");
  mkdirSync(sourcePath, { recursive: true });
  const result = run(["sources", "add", sourcePath, "--name", "removal-fixture"], env);
  expect(result.exitCode).toBe(0);
  const sourceId = stdout(result).match(/source added: (\S+) /i)?.[1];
  expect(sourceId).toBeDefined();
  return sourceId!;
}

function run(args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({
    cmd: ["bun", "--no-env-file", "--preload", denyNetworkPath, cliPath, ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stdout(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stdout);
}

function stderr(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stderr);
}
