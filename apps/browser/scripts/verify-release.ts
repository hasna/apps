#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import packageJson from "../package.json" assert { type: "json" };

const PACKAGE_NAME = "@hasna/browser";
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_UNPACKED_BYTES = 20 * 1024 * 1024;
const MAX_PACKAGE_FILE_COUNT = 260;
const REQUIRED_FILES = [
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/storage.js",
  "package/dist/storage.d.ts",
  "package/dist/video.js",
  "package/dist/video.d.ts",
  "package/dist/extension.js",
  "package/dist/extension.d.ts",
  "package/dist/cli/index.js",
  "package/dist/mcp/index.js",
  "package/dist/server/index.js",
  "package/dashboard/dist/index.html",
  "package/extension/dist/manifest.json",
  "package/extension/dist/background.js",
  "package/extension/dist/popup.html",
  "package/extension/dist/popup.js",
  "package/extension/dist/icon-32.png",
  "package/extension/dist/icon-128.png",
  "package/README.md",
  "package/LICENSE",
];
const FORBIDDEN_PATTERNS = [
  /^package\/\.hasna\//,
  /^package\/src\//,
  /^package\/test\//,
  /^package\/extension\/dist\/src\//,
  /^package\/.*(?:\.test|\.spec|\.e2e\.test)\.(?:js|mjs|cjs|d\.ts)(?:\.map)?$/i,
  /^package\/.*\.map$/i,
  /^package\/.*\.db$/,
  /^package\/.*\.sqlite$/,
  /^package\/.*\.env$/,
  /^package\/.*(?:secret|token|credential|password)/i,
];
const SCANNABLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const SCANNABLE_BASENAMES = new Set(["LICENSE"]);
const RETIRED_CONTENT_PATTERNS = [
  { label: "retired package import", pattern: rx(["@hasna/", "cloud"]) },
  { label: "retired package name", pattern: rx(["open", "-cloud"]) },
  { label: "retired MCP binary", pattern: rx(["cloud", "-mcp"]) },
  { label: "retired MCP registrar", pattern: rx(["register", "Cloud", "Tools"]) },
  { label: "retired CLI registrar", pattern: rx(["register", "Cloud", "Commands"]) },
  { label: "retired service env", pattern: rx(["HASNA", "_CLOUD"]) },
  { label: "retired open env", pattern: rx(["OPEN", "_CLOUD"]) },
  { label: "retired data path", pattern: rx(["\\.hasna/", "cloud"]) },
  { label: "retired sync command", pattern: rx(["cloud", " sync"]) },
  { label: "retired database shorthand", pattern: rx(["\\br", "ds\\b"]) },
];
const TOKEN_CONTENT_PATTERNS = [
  { label: "Anthropic-style API token", pattern: rx(["sk-", "ant-"]) },
  { label: "OpenAI-style project token", pattern: rx(["sk-", "proj-"]) },
  { label: "npm token", pattern: rx(["npm", "_[a-zA-Z]"], "") },
  { label: "GitHub OAuth token", pattern: rx(["gh", "o_"]) },
  { label: "GitHub PAT", pattern: rx(["gh", "p_"]) },
  { label: "generic secret token", pattern: rx(["secret", "-token:"]) },
  { label: "Context7 token", pattern: rx(["ctx7", "sk-"]) },
  { label: "xAI token", pattern: rx(["x", "ai-"]) },
  { label: "Google API key", pattern: rx(["AI", "za[a-zA-Z0-9]"], "") },
  { label: "AWS access key", pattern: rx(["AK", "IA[A-Z0-9]"], "") },
];

function rx(parts: string[], flags = "i"): RegExp {
  return new RegExp(parts.join(""), flags);
}

async function main(): Promise<void> {
  assertExtensionVersions();
  await assertVersionIsPublishable();
  const tmp = mkdtempSync(join(tmpdir(), "browser-release-"));
  try {
    const packed = await pack(tmp);
    const files = await listTarball(packed);
    await assertPackageContents(files, packed);
    const extractDir = join(tmp, "packed");
    mkdirSync(extractDir, { recursive: true });
    await run(["tar", "-xzf", packed, "-C", extractDir], { quiet: true });
    assertPackedContentClean(extractDir);

    const appDir = join(tmp, "app");
    mkdirSync(appDir, { recursive: true });
    await Bun.write(join(appDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
    await run(["npm", "install", "--omit=dev", "--ignore-scripts", packed, "--dry-run=false"], { cwd: appDir, quiet: true });
    await smokeInstalledPackage(appDir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("browser release verification passed");
}

async function assertVersionIsPublishable(): Promise<void> {
  const publishedVersions = await maybeNpmVersions(PACKAGE_NAME);
  if (publishedVersions.length === 0) return;
  assert(!publishedVersions.includes(packageJson.version), `${PACKAGE_NAME}@${packageJson.version} is already published`);
  const maxPublished = publishedVersions.reduce((max, version) => compareSemver(version, max) > 0 ? version : max, publishedVersions[0]!);
  assert(compareSemver(packageJson.version, maxPublished) > 0, `${PACKAGE_NAME}@${packageJson.version} must be greater than published ${maxPublished}`);
}

function assertExtensionVersions(): void {
  const extensionPackage = JSON.parse(readFileSync("extension/package.json", "utf8")) as { version?: string };
  const extensionManifest = JSON.parse(readFileSync("extension/manifest.json", "utf8")) as { version?: string };
  assert(extensionPackage.version === packageJson.version, `extension/package.json version ${extensionPackage.version} does not match ${packageJson.version}`);
  assert(extensionManifest.version === packageJson.version, `extension/manifest.json version ${extensionManifest.version} does not match ${packageJson.version}`);
  const distManifest = Bun.file("extension/dist/manifest.json");
  if (distManifest.size > 0) {
    const parsed = JSON.parse(readFileSync("extension/dist/manifest.json", "utf8")) as { version?: string };
    assert(parsed.version === packageJson.version, `extension/dist/manifest.json version ${parsed.version} does not match ${packageJson.version}`);
  }
}

async function pack(destination: string): Promise<string> {
  const result = await run(["npm", "pack", "--json", "--pack-destination", destination, "--dry-run=false"], { quiet: true });
  const parsed = JSON.parse(result.stdout) as Array<{ filename: string }>;
  const filename = parsed[0]?.filename;
  assert(filename, "npm pack did not return a filename");
  return join(destination, filename);
}

async function listTarball(path: string): Promise<string[]> {
  const result = await run(["tar", "-tf", path], { quiet: true });
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function assertPackageContents(files: string[], packed: string): Promise<void> {
  const set = new Set(files);
  for (const file of REQUIRED_FILES) {
    assert(set.has(file), `packed artifact missing ${file}`);
  }
  assert(files.some((file) => /^package\/dashboard\/dist\/assets\/.+/.test(file)), "packed artifact missing dashboard assets");
  for (const file of files) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert(!pattern.test(file), `packed artifact contains forbidden path ${file}`);
    }
  }
  const stat = await getPackStats();
  const size = Bun.file(packed).size;
  assert(size <= MAX_PACKAGE_BYTES, `packed artifact is too large: ${size} bytes`);
  assert(stat.unpackedSize <= MAX_PACKAGE_UNPACKED_BYTES, `packed artifact unpacked size is too large: ${stat.unpackedSize} bytes`);
  assert(stat.fileCount <= MAX_PACKAGE_FILE_COUNT, `packed artifact has too many files: ${stat.fileCount}`);
}

async function getPackStats(): Promise<{ fileCount: number; unpackedSize: number }> {
  const result = await run(["npm", "pack", "--dry-run", "--json"], { quiet: true });
  const parsed = JSON.parse(result.stdout) as Array<{ files?: unknown[]; unpackedSize?: number }>;
  const metadata = parsed[0];
  assert(metadata, "npm pack dry-run did not return package metadata");
  return {
    fileCount: Array.isArray(metadata.files) ? metadata.files.length : 0,
    unpackedSize: typeof metadata.unpackedSize === "number" ? metadata.unpackedSize : 0,
  };
}

function assertPackedContentClean(extractDir: string): void {
  for (const file of walkFiles(extractDir)) {
    if (!shouldScanContent(file)) continue;
    const content = readFileSync(file, "utf8");
    const rel = relative(extractDir, file);
    for (const { label, pattern } of [...RETIRED_CONTENT_PATTERNS, ...TOKEN_CONTENT_PATTERNS]) {
      assert(!pattern.test(content), `packed artifact contains ${label} in ${rel}`);
    }
  }
}

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (stat.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function shouldScanContent(path: string): boolean {
  return SCANNABLE_EXTENSIONS.has(extname(path).toLowerCase()) || SCANNABLE_BASENAMES.has(basename(path));
}

async function smokeInstalledPackage(appDir: string): Promise<void> {
  await run(["bun", "-e", "import('@hasna/browser').then((m)=>{ if (!m.createBrowserSDK || !m.BrowserSDK || !m.createSession) throw new Error('missing root exports') })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/browser/storage').then((m)=>{ if (!m.getStorageStatus || !m.storagePush) throw new Error('missing storage exports') })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/browser/video').then((m)=>{ if (!m.resolveVideoRecordingPreset || !m.validateVideoOutput) throw new Error('missing video exports') })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/browser/extension').then((m)=>{ if (!m.createExtensionPage || !m.createExtensionPairing) throw new Error('missing extension exports') })"], { cwd: appDir, quiet: true });
  await run(["./node_modules/.bin/browser", "--version"], { cwd: appDir, quiet: true, expect: packageJson.version });
  await run(["./node_modules/.bin/browser", "storage", "status", "--json"], { cwd: appDir, quiet: true, expect: "\"service\": \"browser\"" });
  await run(["./node_modules/.bin/browser-mcp", "--help"], { cwd: appDir, quiet: true, expect: "Usage:" });
  await run(["./node_modules/.bin/browser-mcp", "--version"], { cwd: appDir, quiet: true, expect: packageJson.version });
  await smokeServer(appDir);
}

async function smokeServer(appDir: string): Promise<void> {
  const port = 19_700 + Math.floor(Math.random() * 500);
  const dataRoot = join(tmpdir(), `browser-release-server-${port}`);
  const proc = Bun.spawn(["./node_modules/.bin/browser-serve"], {
    cwd: appDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BROWSER_SERVER_PORT: String(port),
      BROWSER_ALLOW_UNAUTHENTICATED: "1",
      BROWSER_DATA_DIR: dataRoot,
      BROWSER_DB_PATH: join(dataRoot, "browser.db"),
    },
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  try {
    const response = await waitForHealth(port);
    const payload = await response.json() as { status?: string };
    assert(payload.status === "ok", `browser-serve health returned ${JSON.stringify(payload)}`);
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await Promise.all([stdout, stderr]).catch(() => undefined);
  }
}

async function waitForHealth(port: number): Promise<Response> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }
  throw lastError instanceof Error ? lastError : new Error("browser-serve health check timed out");
}

async function maybeNpmVersions(pkg: string): Promise<string[]> {
  const result = await run(["npm", "view", pkg, "versions", "--json"], { quiet: true, allowFailure: true });
  if (result.exitCode !== 0) return [];
  const parsed = JSON.parse(result.stdout) as string[] | string;
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function run(
  cmd: string[],
  options: { cwd?: string; quiet?: boolean; expect?: string; allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const dataRoot = join(tmpdir(), "browser-release-data");
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BROWSER_DATA_DIR: dataRoot,
      BROWSER_DB_PATH: join(dataRoot, "browser.db"),
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`Command failed (${exitCode}): ${cmd.join(" ")}\n${stdout}\n${stderr}`);
  }
  if (options.expect && !stdout.includes(options.expect) && !stderr.includes(options.expect)) {
    throw new Error(`Command output missing ${JSON.stringify(options.expect)}: ${cmd.join(" ")}\n${stdout}\n${stderr}`);
  }
  if (!options.quiet) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  }
  return { stdout, stderr, exitCode };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function compareSemver(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
