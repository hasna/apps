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

describe("CLI compact output", () => {
  test("keeps list and duplicate defaults compact with explicit detail paths", () => {
    const env = seedDuplicateFiles();
    const longPath = "deeply/nested/customer/archive/with/repeated/legal/finance/context/final/quarterly-board-packet-copy-1.txt";

    const compactList = run(["list", "--limit", "2", "--sort", "name", "--asc"], env);
    expect(compactList.exitCode).toBe(0);
    expect(stdout(compactList)).toContain("showing 2 files");
    expect(stdout(compactList)).toContain("files list --verbose");
    expect(stdout(compactList)).toContain("...");
    expect(stdout(compactList)).not.toContain(longPath);

    const verboseList = run(["list", "--limit", "1", "--sort", "name", "--asc", "--verbose"], env);
    expect(verboseList.exitCode).toBe(0);
    expect(stdout(verboseList)).toContain(longPath);

    const jsonList = run(["list", "--limit", "1", "--sort", "name", "--asc", "--json"], env);
    expect(jsonList.exitCode).toBe(0);
    const json = JSON.parse(stdout(jsonList)) as Array<{ path: string; name: string }>;
    expect(json[0]?.path).toBe(longPath);
    expect(json[0]?.name).toBe("quarterly-board-packet-copy-1.txt");

    const compactDupes = run(["dupes", "--files-per-group", "2"], env);
    expect(compactDupes.exitCode).toBe(0);
    expect(stdout(compactDupes)).toContain("use --verbose for all paths");
    expect(stdout(compactDupes)).toContain("more duplicate file(s)");
    expect(stdout(compactDupes)).toContain("...");

    const verboseDupes = run(["dupes", "--verbose"], env);
    expect(verboseDupes.exitCode).toBe(0);
    expect(stdout(verboseDupes)).toContain(longPath);

    const compactSearch = run(["search", "quarterly-board-packet", "--limit", "1"], env);
    expect(compactSearch.exitCode).toBe(0);
    expect(stdout(compactSearch)).toContain("files search");
    expect(stdout(compactSearch)).toContain("files search \"quarterly-board-packet\" --verbose");
    expect(stdout(compactSearch)).not.toContain(longPath);

    const compactManifest = run(["knowledge", "manifest", "--limit", "1"], env);
    expect(compactManifest.exitCode).toBe(0);
    expect(stdout(compactManifest)).toContain("Knowledge Manifest");
    expect(stdout(compactManifest)).toContain("use files knowledge manifest --json");
    expect(stdout(compactManifest)).not.toContain("\"items\"");

    const jsonManifest = run(["knowledge", "manifest", "--limit", "1", "--json"], env);
    expect(jsonManifest.exitCode).toBe(0);
    const manifest = JSON.parse(stdout(jsonManifest)) as { items: Array<{ path: string }> };
    expect(manifest.items[0]?.path).toContain("deeply/nested/customer/archive/with/repeated/legal/finance/context/final");
    expect(manifest.items[0]?.path).not.toContain("...");
  });
});

function seedDuplicateFiles(): NodeJS.ProcessEnv {
  testDir = mkdtempSync(join(tmpdir(), "files-cli-compact-"));
  const sourceRoot = join(testDir, "source");
  const dataDir = join(testDir, "data");
  const longDir = join(sourceRoot, "deeply/nested/customer/archive/with/repeated/legal/finance/context/final");
  mkdirSync(longDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  for (let index = 1; index <= 4; index++) {
    writeFileSync(join(longDir, `quarterly-board-packet-copy-${index}.txt`), "same duplicate content\n");
  }
  const env = {
    ...process.env,
    HASNA_FILES_DATA_DIR: dataDir,
    HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
  };
  expect(run(["sources", "add", sourceRoot, "--name", "compact-fixtures"], env).exitCode).toBe(0);
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
