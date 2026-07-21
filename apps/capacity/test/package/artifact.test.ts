import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");
const DIST_ROOT = join(REPOSITORY_ROOT, "dist");
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "capacity-package-artifact-"));
const NPM_PACK_ROOT = join(TEMP_ROOT, "npm-pack");
const NPM_EXTRACT_ROOT = join(TEMP_ROOT, "npm-extracted");
const BUN_IGNORED_PACK_ROOT = join(TEMP_ROOT, "bun-ignored-pack");
const BUN_PACK_ROOT = join(TEMP_ROOT, "bun-pack");
const BUN_EXTRACT_ROOT = join(TEMP_ROOT, "bun-extracted");
const COMMAND_TIMEOUT_MS = 25_000;
const PACKAGE_LIFECYCLE_TIMEOUT_MS = 30_000;

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
let ignoredScriptsPack: PackResult;
let packedCliPath: string;
let npmArchiveFiles: Map<string, Blob>;
let bunIgnoredArchivePaths: readonly string[];
let bunArchiveFiles: Map<string, Blob>;
let bunArchivePaths: readonly string[];
let bunPackedCliPath: string;
let bunPackedCliMode: string;

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
    timeout: COMMAND_TIMEOUT_MS,
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

function parsePackResults(stdout: string): readonly PackResult[] {
  for (let searchEnd = stdout.length; searchEnd > 0;) {
    const jsonStart = stdout.lastIndexOf("[", searchEnd - 1);
    if (jsonStart === -1) break;
    try {
      const candidate = JSON.parse(stdout.slice(jsonStart)) as unknown;
      if (
        Array.isArray(candidate) &&
        candidate.every(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            "filename" in item &&
            "files" in item &&
            Array.isArray(item.files),
        )
      ) {
        return candidate as readonly PackResult[];
      }
    } catch {
      // Lifecycle output may contain unrelated brackets before npm's final JSON payload.
    }
    searchEnd = jsonStart;
  }
  throw new Error("npm pack returned no parseable artifact metadata");
}

beforeAll(async () => {
  chmodSync(TEMP_ROOT, 0o700);
  for (const directory of [
    NPM_PACK_ROOT,
    NPM_EXTRACT_ROOT,
    BUN_IGNORED_PACK_ROOT,
    BUN_PACK_ROOT,
    BUN_EXTRACT_ROOT,
  ]) {
    mkdirSync(directory, { mode: 0o700 });
  }

  rmSync(DIST_ROOT, { recursive: true, force: true });
  expect(existsSync(DIST_ROOT)).toBe(false);

  const npm = Bun.which("npm");
  if (npm === null) throw new Error("npm is required for the package artifact test");
  const ignoredScripts = await run([
    npm,
    "pack",
    ".",
    "--dry-run",
    "--json",
    "--ignore-scripts",
    "--offline",
  ]);
  requireSuccess(ignoredScripts, "ignore-scripts npm pack");
  const [ignoredScriptsMetadata] = parsePackResults(ignoredScripts.stdout);
  if (ignoredScriptsMetadata === undefined) {
    throw new Error("ignore-scripts npm pack returned no artifact metadata");
  }
  ignoredScriptsPack = ignoredScriptsMetadata;
  expect(existsSync(DIST_ROOT)).toBe(false);

  const bunIgnored = await run([
    process.execPath,
    "pm",
    "pack",
    "--ignore-scripts",
    "--destination",
    BUN_IGNORED_PACK_ROOT,
  ]);
  requireSuccess(bunIgnored, "ignore-scripts Bun pack");
  const bunIgnoredArchive = new BunArchive(
    Bun.gunzipSync(
      await Bun.file(join(BUN_IGNORED_PACK_ROOT, "hasna-capacity-0.1.1.tgz")).bytes(),
    ),
  );
  bunIgnoredArchivePaths = [...(await bunIgnoredArchive.files()).keys()]
    .map((path) => path.replace(/^package\//, ""))
    .sort();
  expect(existsSync(DIST_ROOT)).toBe(false);

  const packed = await run([
    npm,
    "pack",
    ".",
    "--pack-destination",
    NPM_PACK_ROOT,
    "--json",
    "--offline",
  ]);
  requireSuccess(packed, "local npm pack");
  const [packedMetadata] = parsePackResults(packed.stdout);
  if (packedMetadata === undefined) throw new Error("npm pack returned no artifact metadata");
  pack = packedMetadata;

  const archiveBytes = Bun.gunzipSync(await Bun.file(join(NPM_PACK_ROOT, pack.filename)).bytes());
  const archive = new BunArchive(archiveBytes);
  npmArchiveFiles = await archive.files();
  expect(npmArchiveFiles.size).toBe(pack.entryCount);

  const manifestFile = npmArchiveFiles.get("package/package.json");
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

  expect(await archive.extract(NPM_EXTRACT_ROOT)).toBe(pack.entryCount);
  packedCliPath = join(NPM_EXTRACT_ROOT, "package", "dist", "cli.js");
  expect(existsSync(packedCliPath)).toBe(true);

  rmSync(DIST_ROOT, { recursive: true, force: true });
  expect(existsSync(DIST_ROOT)).toBe(false);
  const bunPacked = await run([
    process.execPath,
    "pm",
    "pack",
    "--destination",
    BUN_PACK_ROOT,
  ]);
  requireSuccess(bunPacked, "clean-dist Bun pack");
  const bunArchiveBytes = Bun.gunzipSync(
    await Bun.file(join(BUN_PACK_ROOT, "hasna-capacity-0.1.1.tgz")).bytes(),
  );
  const tar = Bun.which("tar");
  if (tar === null) throw new Error("tar is required for the package artifact test");
  const bunCliHeader = await run([
    tar,
    "-tvzf",
    join(BUN_PACK_ROOT, "hasna-capacity-0.1.1.tgz"),
    "package/dist/cli.js",
  ]);
  requireSuccess(bunCliHeader, "Bun-packed CLI tar header");
  const [packedCliMode] = bunCliHeader.stdout.trim().split(/\s+/, 1);
  if (packedCliMode === undefined) throw new Error("Bun-packed CLI tar mode is missing");
  bunPackedCliMode = packedCliMode;
  const bunArchive = new BunArchive(bunArchiveBytes);
  bunArchiveFiles = await bunArchive.files();
  bunArchivePaths = [...bunArchiveFiles.keys()]
    .map((path) => path.replace(/^package\//, ""))
    .sort();
  const bunManifestFile = bunArchiveFiles.get("package/package.json");
  if (bunManifestFile === undefined) throw new Error("Bun-packed package.json is missing");
  const bunManifest = (await bunManifestFile.json()) as Record<string, unknown>;
  expect(bunManifest).toMatchObject({ name: "@hasna/capacity", version: "0.1.1" });
  expect(bunManifest.bin).toEqual({ capacity: "dist/cli.js" });
  expect(await bunArchive.extract(BUN_EXTRACT_ROOT)).toBe(bunArchiveFiles.size);
  bunPackedCliPath = join(BUN_EXTRACT_ROOT, "package", "dist", "cli.js");
  expect(existsSync(bunPackedCliPath)).toBe(true);
}, { timeout: PACKAGE_LIFECYCLE_TIMEOUT_MS });

afterAll(() => {
  rmSync(DIST_ROOT, { recursive: true, force: true });
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("packed capacity CLI", () => {
  test("requires the package lifecycle to produce build artifacts", () => {
    expect(ignoredScriptsPack.files.map(({ path }) => path)).not.toContain("dist/cli.js");
    expect(bunIgnoredArchivePaths).not.toContain("dist/cli.js");
  });

  test("contains the exact package identity and file contract", () => {
    expect(pack).toMatchObject({
      id: "@hasna/capacity@0.1.1",
      name: "@hasna/capacity",
      version: "0.1.1",
    });

    const paths = pack.files.map(({ path }) => path);
    expect(pack.entryCount).toBe(pack.files.length);
    expect(paths).toContain("package.json");
    expect(paths).toContain("dist/index.js");
    expect(paths).toContain("dist/index.d.ts");
    expect(paths.some((path) => path.startsWith("test/") || path.startsWith("tests/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
    expect(pack.files.find(({ path }) => path === "dist/cli.js")).toMatchObject({ mode: 0o755 });
  });

  test("keeps npm and Bun package payload contracts aligned", async () => {
    const npmArchivePaths = pack.files.map(({ path }) => path).sort();
    expect(bunArchivePaths).toEqual(npmArchivePaths);
    expect(bunPackedCliMode).toBe("-rwxr-xr-x");
    for (const path of npmArchivePaths) {
      const npmFile = npmArchiveFiles.get(`package/${path}`);
      const bunFile = bunArchiveFiles.get(`package/${path}`);
      if (npmFile === undefined || bunFile === undefined) {
        throw new Error(`Packed payload is missing from one archive: ${path}`);
      }
      expect(await bunFile.bytes()).toEqual(await npmFile.bytes());
    }
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
    for (const cliPath of [packedCliPath, bunPackedCliPath]) {
      expect(await run([cliPath, "--version"])).toEqual({
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
