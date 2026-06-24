#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import packageJson from "../package.json" assert { type: "json" };
import { PG_MIGRATIONS } from "../src/db/pg-migrations.js";
import { STORAGE_TABLES } from "../src/db/storage-sync.js";
import { VERSION } from "../src/version.js";

const PACKAGE_NAME = "@hasna/computer";
const COMPUTER_ROOT = process.cwd();
const MAX_PACKAGE_BYTES = 6 * 1024 * 1024;
const MAX_PACKAGE_UNPACKED_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_FILE_COUNT = 90;
const MAX_UNEXPECTED_FILE_BYTES = 512 * 1024;
const MAX_TEXT_SCAN_BYTES = 3 * 1024 * 1024;
const REQUIRED_FILES = [
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/storage.js",
  "package/dist/storage.d.ts",
  "package/dist/cli/index.js",
  "package/dist/mcp/index.js",
  "package/dist/server/index.js",
  "package/src/db/migrations/001_initial.sql",
  "package/helpers/scroll",
  "package/helpers/scroll.swift",
  "package/helpers/accessibility",
  "package/helpers/accessibility.swift",
  "package/helpers/record",
  "package/helpers/record.swift",
  "package/helpers/manifest.json",
  "package/docs/release-checklist.md",
  "package/docs/fleet-control.md",
  "package/docs/security-control-plane.md",
  "package/docs/runtime-schema.md",
  "package/docs/compatibility.md",
  "package/docs/non-destructive-machine-validation.md",
  "package/examples/local-smoke.md",
  "package/dashboard/dist/index.html",
  "package/CHANGELOG.md",
  "package/LICENSE",
  "package/README.md",
];
const FORBIDDEN_PATTERNS = [
  /^package\/\.hasna\//,
  /^package\/test\//,
  /^package\/src\/(?!db\/migrations\/001_initial\.sql$)/,
  /^package\/.*(?:^|\/)__tests__\//i,
  /^package\/.*(?:^|\/)(?:fixtures?|mocks?|testing|bench(?:marks)?|test-utils)\//i,
  /^package\/.*(?:\.test|\.spec)\.(?:js|mjs|cjs|d\.ts)(?:\.map)?$/i,
  /^package\/.*\.map$/i,
  /^package\/.*\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm))?$/i,
  /^package\/.*(?:^|\/)\.env(?:\.|$)/i,
  /^package\/.*(?:^|\/)\.npmrc$/i,
  /^package\/.*\.(?:pem|key|p12|pfx|crt|cer)$/i,
  /^package\/.*(?:secret|token|credential|password)/i,
  /^package\/.*(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/i,
];
const ALLOWED_LARGE_FILE_PATTERNS = [
  /^package\/dist\/(?:index|storage)\.js$/,
  /^package\/dist\/(?:cli|mcp|server)\/index\.js$/,
  /^package\/dashboard\/dist\/assets\/[^/]+\.(?:js|css)$/,
  /^package\/helpers\/(?:scroll|accessibility|record)$/,
];
const ALLOWED_PACKAGE_FILE_PATTERNS = [
  /^package\/package\.json$/,
  /^package\/(?:README\.md|LICENSE|CHANGELOG\.md)$/,
  /^package\/docs\/(?:ai-sdk-version-gate|compatibility|fleet-control|non-destructive-machine-validation|release-checklist|runtime-schema|secure-remote-transport|security-control-plane)\.md$/,
  /^package\/examples\/local-smoke\.md$/,
  /^package\/src\/db\/migrations\/001_initial\.sql$/,
  /^package\/helpers\/(?:manifest\.json|scroll|scroll\.swift|accessibility|accessibility\.swift|record|record\.swift)$/,
  /^package\/dashboard\/dist\/index\.html$/,
  /^package\/dashboard\/dist\/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)$/,
  /^package\/dist\/(?:index|storage)\.(?:js|d\.ts)$/,
  /^package\/dist\/(?:cli|mcp|server)\/index\.(?:js|d\.ts)$/,
  /^package\/dist\/(?:agent|apps|db|drivers|lib|providers|server|types)\/[A-Za-z0-9_/-]+\.d\.ts$/,
  /^package\/dist\/(?:mcp|cli)\/[A-Za-z0-9_/-]+\.d\.ts$/,
  /^package\/dist\/version\.d\.ts$/,
];
const SECRET_TEXT_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /\bBearer\s+(?:sk-(?:proj-)?|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{20,}/i,
  /\b[A-Za-z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*[ \t]*[:=][ \t]*["'](?!\$\()[^"'\n]{12,}["']/i,
];
const HELPER_NAMES = ["scroll", "accessibility", "record"] as const;
type HelperName = (typeof HELPER_NAMES)[number];
type HelperManifest = {
  schema_version?: string;
  helpers?: Record<HelperName, {
    platform?: string;
    arch?: string;
    binary_format?: string;
    source?: string;
    binary?: string;
    source_sha256?: string;
    binary_sha256?: string;
  }>;
};
const SECURITY_CAPABILITIES = [
  "computer.screenshot",
  "computer.type",
  "terminal.exec",
  "browser.navigate",
  "fleet.run_smoke",
  "storage.sync",
  "computer.run_task",
  "computer.pause_session",
  "computer.resume_session",
  "computer.emergency_stop",
  "provider.analyze",
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assert(packageJson.version === VERSION, `package.json version ${packageJson.version} does not match src/version.ts ${VERSION}`);
  assertReleaseScriptPolicy();
  await assertVersionIsPublishable();
  assertRuntimeMigrationShape();

  const tmp = mkdtempSync(join(tmpdir(), "computer-release-"));
  try {
    const packed = await pack(tmp);
    const tarFiles = await listTarball(packed.path);
    assertPackMetadataMatchesTarball(packed.files, tarFiles);
    await assertPackageContents(packed.files, packed.path, packed.unpackedSize);

    const appDir = join(tmp, "app");
    await run(["bun", "init", "-y"], { cwd: appDir, quiet: true });
    await run(["npm", "install", "--ignore-scripts", packed.path], { cwd: appDir, quiet: true });
    await smokeInstalledPackage(appDir, options);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("release verification passed");
}

type VerifyReleaseOptions = {
  installedSmokeOut: string | null;
};

function parseArgs(args: string[]): VerifyReleaseOptions {
  const options: VerifyReleaseOptions = { installedSmokeOut: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--installed-smoke-out") {
      options.installedSmokeOut = requireValue(args, ++i, arg);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun run scripts/verify-release.ts [options]

Options:
  --installed-smoke-out <path>  Write the installed computer validate-machine JSON report.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

async function assertVersionIsPublishable(): Promise<void> {
  const published = await maybeNpmView(PACKAGE_NAME, "version");
  if (!published) return;
  assert(compareSemver(packageJson.version, published) > 0, `${PACKAGE_NAME}@${packageJson.version} must be greater than published ${published}`);
}

function assertRuntimeMigrationShape(): void {
  const sql = PG_MIGRATIONS.join("\n");
  assertMigrationSqlShape(sql, "PG migrations");

  const legacySql = readFileSync("src/db/migrations/001_initial.sql", "utf8");
  assertMigrationSqlShape(legacySql, "packaged SQL migration");

  const checklist = readFileSync("docs/release-checklist.md", "utf8");
  for (const heading of ["Security", "Docs", "Tests", "Migrations", "Package Files", "Examples", "Changelog"]) {
    assert(checklist.includes(`## ${heading}`), `release checklist missing ${heading}`);
  }
  for (const phrase of [
    "bun run verify:release",
    "bun run verify:workspace:release",
    "Verify packed artifacts do not include local state",
    "Keep `src/db/pg-migrations.ts` and `src/db/migrations/001_initial.sql` aligned",
    "Update `CHANGELOG.md` with the package version before release",
  ]) {
    assert(checklist.includes(phrase), `release checklist missing ${phrase}`);
  }
  assertSecurityControlPlaneShape(readFileSync("docs/security-control-plane.md", "utf8"));
  assertChangelogShape(readFileSync("CHANGELOG.md", "utf8"));
  assertLocalSmokeExampleShape(readFileSync("examples/local-smoke.md", "utf8"));
  assert(readFileSync("dashboard/dist/index.html", "utf8").toLowerCase().includes("<!doctype html>"), "dashboard build missing index.html");
  assertHelperManifest(COMPUTER_ROOT);
}

function assertMigrationSqlShape(sql: string, label: string): void {
  for (const table of STORAGE_TABLES) {
    assert(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${label} missing ${table}`);
  }
  assert(sql.includes("idx_resource_leases_one_active"), `${label} missing unique active lease index`);
  assert(sql.includes("max_steps_exceeded"), `${label} missing max_steps_exceeded status`);
}

function assertReleaseScriptPolicy(): void {
  const scripts = packageJson.scripts ?? {};
  const verifyRelease = scripts["verify:release"];
  const prepublishOnly = scripts.prepublishOnly;
  assert(verifyRelease === "bun run typecheck && bun run test && bun run build && bun run scripts/verify-release.ts", "verify:release must run the exact release gate chain");
  assert(prepublishOnly === "bun run verify:workspace:release && bun run verify:release", "prepublishOnly must run the exact workspace and release gate chain");
  const files = new Set(packageJson.files ?? []);
  for (const file of ["dist", "dashboard/dist", "src/db/migrations", "helpers/manifest.json", "docs", "examples", "CHANGELOG.md", "README.md", "LICENSE"]) {
    assert(files.has(file), `package files missing ${file}`);
  }
  for (const forbidden of [".hasna", "test"]) {
    assert(!files.has(forbidden), `package files must not include ${forbidden}`);
  }
}

function assertSecurityControlPlaneShape(markdown: string): void {
  for (const capability of SECURITY_CAPABILITIES) {
    const row = markdown.split("\n").find((line) => line.startsWith("|") && line.includes(`\`${capability}`));
    assert(row, `security control-plane table missing ${capability}`);
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    assert(cells.length === 7, `security control-plane row for ${capability} must have 7 columns`);
    for (const [index, cell] of cells.entries()) {
      assert(cell.length > 0 && cell !== "---", `security control-plane row for ${capability} has empty column ${index + 1}`);
    }
  }
}

function assertChangelogShape(markdown: string): void {
  const section = getMarkdownSection(markdown, `## ${packageJson.version}`);
  assert(section, `CHANGELOG.md missing heading for ${packageJson.version}`);
  assert(/^\s*-\s+\S/m.test(section), `CHANGELOG.md ${packageJson.version} section needs at least one bullet`);
}

function assertLocalSmokeExampleShape(markdown: string): void {
  assert(markdown.includes("computer storage status --json"), "local smoke example missing storage status smoke");
  const denied = [
    /https?:\/\//i,
    /\b(?:OPENAI|ANTHROPIC|API)_KEY\s*=/i,
    /\b(?:TOKEN|PASSWORD|SECRET)\s*=/i,
    /\brm\s+-rf\b/i,
    /\b(?:curl|wget)\b.*\|\s*(?:sh|bash)\b/i,
    /\bosascript\b/i,
    /\bcomputer\s+(?:run|action|click|type|key|open-url)\b/i,
  ];
  for (const pattern of denied) {
    assert(!pattern.test(markdown), `local smoke example contains unsafe token: ${pattern}`);
  }
}

function getMarkdownSection(markdown: string, heading: string): string | null {
  const start = markdown.indexOf(heading);
  if (start === -1) return null;
  const rest = markdown.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s+/);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

type PackedFile = {
  path: string;
  size: number;
  mode: number | null;
};

type PackedArtifact = {
  path: string;
  files: PackedFile[];
  size: number;
  unpackedSize: number;
};

async function pack(destination: string): Promise<PackedArtifact> {
  const result = await run(["npm", "pack", "--json", "--pack-destination", destination], { quiet: true });
  const parsed = JSON.parse(result.stdout) as Array<{
    filename: string;
    size?: number;
    unpackedSize?: number;
    files?: Array<{ path?: string; size?: number; mode?: number }>;
  }>;
  const metadata = parsed[0];
  const filename = metadata?.filename;
  assert(filename, "npm pack did not return a filename");
  assert(Array.isArray(metadata.files), "npm pack did not return file metadata");
  return {
    path: join(destination, filename),
    files: metadata.files.map((file) => {
      assert(typeof file.path === "string" && file.path.length > 0, "npm pack returned a file without path metadata");
      return {
        path: `package/${file.path}`,
        size: typeof file.size === "number" ? file.size : 0,
        mode: typeof file.mode === "number" ? file.mode : null,
      };
    }),
    size: typeof metadata.size === "number" ? metadata.size : 0,
    unpackedSize: typeof metadata.unpackedSize === "number" ? metadata.unpackedSize : 0,
  };
}

async function listTarball(path: string): Promise<string[]> {
  const result = await run(["tar", "-tf", path], { quiet: true });
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function assertPackMetadataMatchesTarball(files: PackedFile[], tarFiles: string[]): void {
  const metadataSet = new Set(files.map((file) => file.path));
  const tarSet = new Set(tarFiles);
  for (const file of tarSet) {
    assert(metadataSet.has(file), `npm pack metadata missing tarball file ${file}`);
  }
  for (const file of metadataSet) {
    assert(tarSet.has(file), `tarball missing npm pack metadata file ${file}`);
  }
}

async function assertPackageContents(files: PackedFile[], packed: string, unpackedSize: number): Promise<void> {
  const set = new Set(files.map((file) => file.path));
  for (const file of REQUIRED_FILES) {
    assert(set.has(file), `packed artifact missing ${file}`);
  }
  assertPackageAllowedFileSet(files);
  assert(set.has("package/dashboard/dist/index.html"), "packed artifact missing dashboard entrypoint");
  assert(files.some((file) => /^package\/dashboard\/dist\/assets\/.+\.js$/.test(file.path)), "packed artifact missing dashboard JavaScript asset");
  assert(files.some((file) => /^package\/dashboard\/dist\/assets\/.+\.css$/.test(file.path)), "packed artifact missing dashboard CSS asset");

  for (const file of files) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert(!pattern.test(file.path), `packed artifact contains forbidden path ${file.path}`);
    }
    assert(
      file.size <= MAX_UNEXPECTED_FILE_BYTES || ALLOWED_LARGE_FILE_PATTERNS.some((pattern) => pattern.test(file.path)),
      `packed artifact contains unexpected large file ${file.path} (${file.size} bytes)`,
    );
  }
  const size = Bun.file(packed).size;
  assert(size <= MAX_PACKAGE_BYTES, `packed artifact is too large: ${size} bytes`);
  assert(unpackedSize <= MAX_PACKAGE_UNPACKED_BYTES, `packed artifact unpacked size is too large: ${unpackedSize} bytes`);
  assert(files.length <= MAX_PACKAGE_FILE_COUNT, `packed artifact has too many files: ${files.length}`);
  await assertDashboardAssetsAreReferenced(packed, set);
  await assertNoPackedSecretText(packed, files);
}

function assertPackageAllowedFileSet(files: PackedFile[]): void {
  for (const file of files) {
    assert(
      ALLOWED_PACKAGE_FILE_PATTERNS.some((pattern) => pattern.test(file.path)),
      `packed artifact contains unapproved path ${file.path}`,
    );
  }
}

async function assertDashboardAssetsAreReferenced(packed: string, files: Set<string>): Promise<void> {
  const indexHtml = await readPackedText(packed, "package/dashboard/dist/index.html");
  const referencedAssets = [...indexHtml.matchAll(/(?:src|href)=["'](?:\.?\/)?(?:dashboard\/)?assets\/([^"']+)["']/g)].map((match) => match[1]).filter(Boolean);
  assert(referencedAssets.some((asset) => asset.endsWith(".js")), "dashboard index.html does not reference a JavaScript asset");
  assert(referencedAssets.some((asset) => asset.endsWith(".css")), "dashboard index.html does not reference a CSS asset");
  for (const asset of referencedAssets) {
    assert(files.has(`package/dashboard/dist/assets/${asset}`), `dashboard index.html references missing asset ${asset}`);
  }
}

async function assertNoPackedSecretText(packed: string, files: PackedFile[]): Promise<void> {
  for (const file of files) {
    if (file.size > MAX_TEXT_SCAN_BYTES) continue;
    const bytes = await readPackedBytes(packed, file.path);
    const text = decodeMostlyText(bytes);
    if (text === null) continue;
    for (const pattern of SECRET_TEXT_PATTERNS) {
      assert(!pattern.test(text), `packed text file ${file.path} matches secret pattern ${pattern}`);
    }
  }
}

async function readPackedText(packed: string, file: string): Promise<string> {
  const result = await run(["tar", "-xOf", packed, file], { quiet: true });
  return result.stdout;
}

async function readPackedBytes(packed: string, file: string): Promise<Buffer> {
  const proc = Bun.spawn(["tar", "-xOf", packed, file], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Could not read ${file} from ${packed}: ${stderr}`);
  }
  return Buffer.from(stdout);
}

function decodeMostlyText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (!text) return "";
  let printable = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || code >= 32) printable += 1;
  }
  return printable / text.length >= 0.95 ? text : null;
}

async function smokeInstalledPackage(appDir: string, options: VerifyReleaseOptions): Promise<void> {
  const bin = (name: string) => join(appDir, "node_modules", ".bin", name);
  assertInstalledHelpers(appDir);
  assertHelperManifest(join(appDir, "node_modules", "@hasna", "computer"));
  await run(["bun", "-e", "import('@hasna/computer').then((m)=>{ if (!m.runTask || !m.executeAction) throw new Error('missing root exports') })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/computer/storage').then((m)=>{ if (!m.getStorageStatus || !m.storagePush) throw new Error('missing storage exports') })"], { cwd: appDir, quiet: true });
  await run([bin("computer"), "--version"], { cwd: appDir, quiet: true, expect: VERSION });
  await run([bin("computer-mcp"), "--help"], { cwd: appDir, quiet: true, expect: "Usage:" });
  await run([bin("computer-serve"), "--help"], { cwd: appDir, quiet: true, expect: "Usage:" });
  await smokeInstalledDashboard(appDir);
  await run([bin("computer"), "storage", "status", "--json"], { cwd: appDir, quiet: true, expect: "\"service\": \"computer\"" });
  const validation = await run([bin("computer"), "validate-machine", "--json", "--allow-failures", "--skip-screenshot"], { cwd: appDir, quiet: true });
  assertInstalledMachineSmoke(validation.stdout);
  if (options.installedSmokeOut) {
    mkdirSync(dirname(options.installedSmokeOut), { recursive: true });
    writeFileSync(options.installedSmokeOut, validation.stdout.endsWith("\n") ? validation.stdout : `${validation.stdout}\n`);
  }
}

function assertHelperManifest(packageRoot: string): void {
  const manifestPath = join(packageRoot, "helpers", "manifest.json");
  assert(existsSync(manifestPath), `helper manifest missing at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as HelperManifest;
  assert(manifest.schema_version === "open-computer.helper-manifest.v1", "helper manifest schema mismatch");
  for (const helper of HELPER_NAMES) {
    const entry = manifest.helpers?.[helper];
    assert(entry, `helper manifest missing ${helper}`);
    assert(entry.platform === "macos", `helper ${helper} manifest platform mismatch`);
    assert(entry.arch === "arm64", `helper ${helper} manifest arch mismatch`);
    assert(entry.binary_format === "mach-o", `helper ${helper} manifest binary format mismatch`);
    assert(entry.source === `helpers/${helper}.swift`, `helper ${helper} source path mismatch`);
    assert(entry.binary === `helpers/${helper}`, `helper ${helper} binary path mismatch`);
    const sourcePath = join(packageRoot, entry.source);
    const binaryPath = join(packageRoot, entry.binary);
    assert(existsSync(sourcePath), `helper ${helper} source missing`);
    assert(existsSync(binaryPath), `helper ${helper} binary missing`);
    assert(sha256File(sourcePath) === entry.source_sha256, `helper ${helper} source hash mismatch`);
    assert(sha256File(binaryPath) === entry.binary_sha256, `helper ${helper} binary hash mismatch`);
    const stat = statSync(binaryPath);
    assert(stat.isFile(), `helper ${helper} binary is not a file`);
    assert(process.platform === "win32" || (stat.mode & 0o111) !== 0, `helper ${helper} binary is not executable`);
    assert(isMachO(readFileSync(binaryPath)), `helper ${helper} binary is not Mach-O`);
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isMachO(bytes: Buffer): boolean {
  const magic = bytes.subarray(0, 4).toString("hex");
  return magic === "cffaedfe" || magic === "cafebabe" || magic === "cafebabf";
}

function assertInstalledHelpers(appDir: string): void {
  for (const helper of HELPER_NAMES) {
    const helperPath = join(appDir, "node_modules", "@hasna", "computer", "helpers", helper);
    assert(existsSync(helperPath), `installed package missing helper ${helper}`);
    const stat = statSync(helperPath);
    assert(stat.isFile(), `installed helper is not a file: ${helper}`);
    assert(process.platform === "win32" || (stat.mode & 0o111) !== 0, `installed helper is not executable: ${helper}`);
  }
}

async function smokeInstalledDashboard(appDir: string): Promise<void> {
  const port = 19_450 + Math.floor(Math.random() * 500);
  const dataRoot = join(tmpdir(), `computer-release-server-${port}`);
  const proc = Bun.spawn([join(appDir, "node_modules", ".bin", "computer-serve")], {
    cwd: appDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      COMPUTER_HOST: "127.0.0.1",
      COMPUTER_PORT: String(port),
      COMPUTER_ALLOW_UNAUTHENTICATED: "1",
      COMPUTER_DATA_DIR: dataRoot,
      COMPUTER_DB_PATH: join(dataRoot, "computer.db"),
    },
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  try {
    const health = await waitForServer(port, "/health");
    const healthPayload = await health.json() as { status?: string; name?: string; version?: string };
    assert(
      healthPayload.status === "ok" && healthPayload.name === "computer",
      `installed computer-serve health mismatch: ${JSON.stringify(healthPayload)}`,
    );
    const dashboard = await waitForServer(port, "/dashboard/");
    const html = await dashboard.text();
    assert(html.toLowerCase().includes("<!doctype html>"), "installed dashboard did not return HTML");
    const assets = [...html.matchAll(/(?:src|href)=["'](?:\.?\/)?(?:dashboard\/)?assets\/([^"']+)["']/g)].map((match) => match[1]).filter(Boolean);
    assert(assets.some((asset) => asset.endsWith(".js")), "installed dashboard missing JS asset reference");
    assert(assets.some((asset) => asset.endsWith(".css")), "installed dashboard missing CSS asset reference");
    for (const asset of assets) {
      const response = await waitForServer(port, `/dashboard/assets/${asset}`);
      const body = await response.text();
      assert(body.length > 0, `installed dashboard asset ${asset} is empty`);
    }
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await Promise.all([stdout, stderr]).catch(() => undefined);
  }
}

async function waitForServer(port: number, path: string): Promise<Response> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }
  throw lastError instanceof Error ? lastError : new Error(`computer-serve ${path} timed out`);
}

function assertInstalledMachineSmoke(stdout: string): void {
  const report = JSON.parse(stdout) as {
    schema_version?: string;
    package?: { name?: string; version?: string };
    checks?: Array<{ id?: string; status?: string; data?: unknown }>;
    readiness?: { ready?: boolean; blockers?: unknown[] };
  };
  assert(report.schema_version === "open-computer.installed-machine-smoke.v1", "validate-machine returned the wrong schema");
  assert(report.package?.name === PACKAGE_NAME, "validate-machine returned the wrong package name");
  assert(report.package?.version === VERSION, "validate-machine returned the wrong package version");
  const checks = report.checks ?? [];
  assert(checks.some((check) => check.id === "local-headless-status" && check.status === "passed"), "validate-machine missing passed local-headless-status check");
  assert(checks.some((check) => check.id === "native-tools" && check.status === "passed"), "validate-machine missing passed native-tools check");
  assert(checks.some((check) => check.id === "packaged-helpers" && check.status === "passed"), "validate-machine missing passed packaged-helpers check");
  assert(checks.some((check) => check.id === "local-screenshot" && check.status === "skipped"), "validate-machine skip-screenshot smoke did not skip local-screenshot");
  assert(report.readiness?.ready === false, "validate-machine --skip-screenshot should not report ready");
  assert(Array.isArray(report.readiness?.blockers) && report.readiness.blockers.length > 0, "validate-machine should report blockers when screenshot is skipped");
}

async function maybeNpmView(pkg: string, field: string): Promise<string | null> {
  const result = await run(["npm", "view", pkg, field], { quiet: true, allowFailure: true });
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}

async function run(
  cmd: string[],
  options: { cwd?: string; quiet?: boolean; expect?: string; allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (cmd[0] === "bun" && cmd[1] === "init") {
    mkdirSync(options.cwd ?? ".", { recursive: true });
    await Bun.write(join(options.cwd ?? ".", "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      COMPUTER_DATA_DIR: join(tmpdir(), "computer-release-data"),
      COMPUTER_DB_PATH: join(tmpdir(), "computer-release-data", "computer.db"),
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
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
