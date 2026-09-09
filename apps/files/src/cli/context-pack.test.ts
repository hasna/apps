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

  test("refuses context-pack and search-pack on the hosted transport instead of querying the local island", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-cli-context-pack-api-"));
    const dataDir = join(testDir, "data");
    mkdirSync(dataDir, { recursive: true });
    // Bind the client to the hosted transport. The pack builders read on-box
    // SQLite/FTS directly, so on the hosted transport they must refuse (as the
    // MCP tools already do) rather than silently return results from the wrong
    // island.
    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: dataDir,
      HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
      HASNA_FILES_API_URL: "https://files.md/v1",
      HASNA_FILES_API_KEY: "hf_test_key_not_used_offline",
      // A station's own `~/.hasna/files/config/credentials` (disk tier) outranks
      // the env tier, so with the fake authority above it would be REFUSED as
      // written for a different authority (REMOTE_API_CONFIG_MISSING) before the
      // local-transport guard has a chance to fire. Point the child's ambient
      // credential roots at the scratch dir — no credentials file can exist
      // there — so the refusal under test is the guard, not the resolver.
      HOME: testDir!,
      HASNA_HOME: testDir!,
      HASNA_CONFIG_HOME: testDir!,
      // Keychain account pin: the spawned child's resolver reads HASNA_STATION
      // else the short hostname else USER, so a real macOS keychain item under
      // this machine's account would resolve next to the fake authority the
      // child pins below. A sentinel account no item uses keeps the tier a miss.
      HASNA_STATION: "files-hermetic-no-such-station",
    };

    for (const args of [["context-pack", "open-files://file/f_missing"], ["search-pack", "anything"]]) {
      const result = run(args, env);
      expect(result.exitCode).toBe(1);
      expect(new TextDecoder().decode(result.stderr)).toContain("on-box only");
      expect(stdout(result).trim()).toBe("");
    }
  });
});

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
