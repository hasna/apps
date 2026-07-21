import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");
const DIST_ROOT = join(REPOSITORY_ROOT, "dist");
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "capacity-package-artifact-"));
const EXTRACT_ROOT = join(TEMP_ROOT, "extracted");

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface PackedFile {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
}

interface PackResult {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly entryCount: number;
  readonly files: readonly PackedFile[];
}

interface ArchiveReader {
  files(): Promise<Map<string, Blob>>;
  extract(destination: string): Promise<number>;
}

const BunArchive = (
  Bun as unknown as {
    readonly Archive: new (bytes: Uint8Array) => ArchiveReader;
  }
).Archive;

let pack: PackResult;
let packedCliPath: string;

async function run(command: readonly string[]): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd: REPOSITORY_ROOT,
    env: {
      HOME: Bun.env.HOME,
      PATH: Bun.env.PATH,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_offline: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function requireSuccess(result: CommandResult, operation: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${operation} failed (${result.exitCode})\n${result.stdout}${result.stderr}`);
  }
}

beforeAll(async () => {
  chmodSync(TEMP_ROOT, 0o700);
  mkdirSync(EXTRACT_ROOT, { mode: 0o700 });

  rmSync(DIST_ROOT, { recursive: true, force: true });
  expect(existsSync(DIST_ROOT)).toBe(false);

  const build = await run([process.execPath, "run", "build"]);
  requireSuccess(build, "clean-dist build");

  const npm = Bun.which("npm");
  if (npm === null) throw new Error("npm is required for the package artifact test");
  const packed = await run([
    npm,
    "pack",
    ".",
    "--pack-destination",
    TEMP_ROOT,
    "--json",
    "--ignore-scripts",
    "--offline",
  ]);
  requireSuccess(packed, "local npm pack");
  const [packedMetadata] = JSON.parse(packed.stdout) as readonly PackResult[];
  if (packedMetadata === undefined) throw new Error("npm pack returned no artifact metadata");
  pack = packedMetadata;

  const archiveBytes = Bun.gunzipSync(await Bun.file(join(TEMP_ROOT, pack.filename)).bytes());
  const archive = new BunArchive(archiveBytes);
  const archiveFiles = await archive.files();
  expect(archiveFiles.size).toBe(pack.entryCount);

  const manifestFile = archiveFiles.get("package/package.json");
  if (manifestFile === undefined) throw new Error("packed package.json is missing");
  const manifest = (await manifestFile.json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    name: "@hasna/capacity",
    version: "0.1.1",
    repository: {
      type: "git",
      url: "git+https://github.com/hasna/capacity.git",
    },
  });
  expect(manifest.bin).toEqual({ capacity: "dist/cli.js" });

  expect(await archive.extract(EXTRACT_ROOT)).toBe(pack.entryCount);
  packedCliPath = join(EXTRACT_ROOT, "package", "dist", "cli.js");
  expect(existsSync(packedCliPath)).toBe(true);
});

afterAll(() => {
  rmSync(DIST_ROOT, { recursive: true, force: true });
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("packed capacity CLI", () => {
  test("contains the exact package identity and file contract", () => {
    expect(pack).toMatchObject({
      id: "@hasna/capacity@0.1.1",
      name: "@hasna/capacity",
      version: "0.1.1",
    });

    const paths = pack.files.map(({ path }) => path);
    expect(pack.entryCount).toBe(pack.files.length);
    expect(paths).toContain("package.json");
    expect(paths.some((path) => path.startsWith("test/") || path.startsWith("tests/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
    expect(pack.files.find(({ path }) => path === "dist/cli.js")).toMatchObject({ mode: 0o755 });
  });

  test("reports the version from the extracted package binary", async () => {
    const humanOutput = '{"package":"@hasna/capacity","version":"0.1.1"}\n';
    const jsonOutput =
      '{"command":"version","data":{"package":"@hasna/capacity","version":"0.1.1"},"schemaVersion":"accounts.cli.v1"}\n';

    for (const args of [["--version"], ["version"]]) {
      expect(await run([process.execPath, packedCliPath, ...args])).toEqual({
        stdout: humanOutput,
        stderr: "",
        exitCode: 0,
      });
    }
    for (const args of [["--version", "--json"], ["version", "--json"]]) {
      expect(await run([process.execPath, packedCliPath, ...args])).toEqual({
        stdout: jsonOutput,
        stderr: "",
        exitCode: 0,
      });
    }
  });

  test("keeps explicit help precedence over the version flag", async () => {
    const help = await run([process.execPath, packedCliPath, "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("capacity validate <file|-> [--json]");

    for (const args of [[], ["--help", "--version"], ["--version", "--help"]]) {
      expect(await run([process.execPath, packedCliPath, ...args])).toEqual(help);
    }

    const jsonHelp = await run([process.execPath, packedCliPath, "--help", "--version", "--json"]);
    expect(jsonHelp.exitCode).toBe(0);
    expect(jsonHelp.stderr).toBe("");
    expect(JSON.parse(jsonHelp.stdout)).toMatchObject({
      schemaVersion: "accounts.cli.v1",
      command: "help",
    });
  });
});
