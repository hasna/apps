#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" assert { type: "json" };

type PackedFile = {
  path: string;
  size: number;
};

const PACKAGE_NAME = "@hasna/todos-sdk";
const MAX_PACKAGE_BYTES = 512 * 1024;
const MAX_PACKAGE_UNPACKED_BYTES = 1024 * 1024;
const MAX_PACKAGE_FILE_COUNT = 20;

const REQUIRED_FILES = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/schemas.js",
  "package/dist/schemas.d.ts",
  "package/dist/client.d.ts",
  "package/dist/types.d.ts",
];

const ALLOWED_PATTERNS = [
  /^package\/package\.json$/,
  /^package\/README\.md$/,
  /^package\/LICENSE$/,
  /^package\/dist\/(?:index|schemas)\.(?:js|d\.ts)$/,
  /^package\/dist\/(?:client|types)\.d\.ts$/,
];

const FORBIDDEN_PATTERNS = [
  /^package\/src\//,
  /^package\/scripts\//,
  /^package\/.*(?:\.test|\.spec)\.(?:js|mjs|cjs|d\.ts)(?:\.map)?$/i,
  /^package\/.*\.map$/i,
  /^package\/.*(?:^|\/)(?:fixtures?|mocks?|testing|test-utils)\//i,
  /^package\/.*(?:^|\/)\.env(?:\.|$)/i,
  /^package\/.*(?:^|\/)\.npmrc$/i,
  /^package\/.*\.(?:pem|key|p12|pfx|crt|cer)$/i,
  /^package\/.*(?:secret|token|credential|password)/i,
];

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /[A-Za-z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*\s*=\s*['"][^'"]{12,}/,
];

async function main(): Promise<void> {
  assertPackageMetadata();

  const tmp = mkdtempSync(join(tmpdir(), "todos-sdk-release-"));
  try {
    const packed = await pack(tmp);
    const tarFiles = await listTarball(packed.path);
    assertPackMetadataMatchesTarball(packed.files, tarFiles);
    await assertPackageContents(packed.files, packed.path, packed.unpackedSize);

    const appDir = join(tmp, "app");
    mkdirSync(appDir, { recursive: true });
    await Bun.write(join(appDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
    await run(["npm", "install", "--omit=dev", "--ignore-scripts", packed.path], { cwd: appDir, quiet: true });
    await smokeInstalledPackage(appDir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("todos SDK release verification passed");
}

function assertPackageMetadata(): void {
  assert(packageJson.name === PACKAGE_NAME, `package name must be ${PACKAGE_NAME}`);
  assert(isSemver(packageJson.version), "package version must be semver");
  assert(packageJson.license === "Apache-2.0", "package license must be Apache-2.0");
  assert(packageJson.main === "dist/index.js", "main must point at dist/index.js");
  assert(packageJson.types === "dist/index.d.ts", "types must point at dist/index.d.ts");
  assert(packageJson.publishConfig?.access === "public", "publishConfig.access must be public");

  const scripts = packageJson.scripts ?? {};
  assert(
    scripts.build === "rm -rf dist && bun build src/index.ts --outdir dist --target bun && bun build src/schemas.ts --outdir dist --target bun && tsc --emitDeclarationOnly --outDir dist",
    "build script must clean dist before emitting package files",
  );
  assert(
    scripts["verify:release"] === "bun run typecheck && bun run test && bun run build && npm pack --dry-run && bun run scripts/verify-release.ts",
    "verify:release must run typecheck, tests, build, npm pack dry-run, and the SDK release verifier",
  );
  assert(scripts.prepublishOnly === "bun run verify:release", "prepublishOnly must run verify:release");

  const files = new Set(packageJson.files ?? []);
  for (const file of ["dist", "LICENSE", "README.md"]) {
    assert(files.has(file), `package files missing ${file}`);
  }

  const exportsMap = packageJson.exports ?? {};
  assert(exportsMap["."]?.import === "./dist/index.js", "root export import must point at dist/index.js");
  assert(exportsMap["."]?.types === "./dist/index.d.ts", "root export types must point at dist/index.d.ts");
  assert(exportsMap["./schemas"]?.import === "./dist/schemas.js", "schemas export import must point at dist/schemas.js");
  assert(exportsMap["./schemas"]?.types === "./dist/schemas.d.ts", "schemas export types must point at dist/schemas.d.ts");
}

type PackResult = {
  path: string;
  files: PackedFile[];
  unpackedSize: number;
};

async function pack(destination: string): Promise<PackResult> {
  const result = await run(["npm", "pack", "--json", "--pack-destination", destination], { quiet: true });
  const parsed = JSON.parse(result.stdout) as Array<{
    filename?: string;
    files?: Array<{ path?: string; size?: number }>;
    unpackedSize?: number;
  }>;
  const metadata = parsed[0];
  assert(metadata?.filename, "npm pack did not return a filename");
  assert(Array.isArray(metadata.files), "npm pack did not return file metadata");
  return {
    path: join(destination, metadata.filename),
    files: metadata.files.map((file) => {
      assert(typeof file.path === "string" && file.path.length > 0, "npm pack returned a file without path metadata");
      return { path: `package/${file.path}`, size: file.size ?? 0 };
    }),
    unpackedSize: metadata.unpackedSize ?? 0,
  };
}

async function listTarball(path: string): Promise<string[]> {
  const result = await run(["tar", "-tf", path], { quiet: true });
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function assertPackMetadataMatchesTarball(files: PackedFile[], tarFiles: string[]): void {
  const metadataSet = new Set(files.map((file) => file.path));
  const tarSet = new Set(tarFiles);
  for (const file of tarSet) assert(metadataSet.has(file), `npm pack metadata missing tarball file ${file}`);
  for (const file of metadataSet) assert(tarSet.has(file), `tarball missing npm pack metadata file ${file}`);
}

async function assertPackageContents(files: PackedFile[], packed: string, unpackedSize: number): Promise<void> {
  const set = new Set(files.map((file) => file.path));
  for (const file of REQUIRED_FILES) assert(set.has(file), `packed artifact missing ${file}`);

  for (const file of files) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert(!pattern.test(file.path), `packed artifact contains forbidden path ${file.path}`);
    }
    assert(ALLOWED_PATTERNS.some((pattern) => pattern.test(file.path)), `packed artifact contains unapproved path ${file.path}`);
  }

  const size = Bun.file(packed).size;
  assert(size <= MAX_PACKAGE_BYTES, `packed artifact is too large: ${size} bytes`);
  assert(unpackedSize <= MAX_PACKAGE_UNPACKED_BYTES, `packed artifact unpacked size is too large: ${unpackedSize} bytes`);
  assert(files.length <= MAX_PACKAGE_FILE_COUNT, `packed artifact has too many files: ${files.length}`);
  await assertNoPackedSecretText(packed, files);
}

async function assertNoPackedSecretText(packed: string, files: PackedFile[]): Promise<void> {
  for (const file of files) {
    if (!/\.(json|md|js|mjs|cjs|d\.ts|html|css|sh)$/.test(file.path)) continue;
    const text = await readPackedText(packed, file.path);
    for (const pattern of SECRET_PATTERNS) {
      assert(!pattern.test(text), `packed text file ${file.path} matches secret pattern ${pattern}`);
    }
  }
}

async function readPackedText(packed: string, file: string): Promise<string> {
  const result = await run(["tar", "-xOf", packed, file], { quiet: true });
  return result.stdout;
}

async function smokeInstalledPackage(appDir: string): Promise<void> {
  await run([
    "bun",
    "-e",
    "import('@hasna/todos-sdk').then((m)=>{ if (!m.TodosClient || !m.todosTools || !Array.isArray(m.todosTools)) throw new Error('missing root exports'); new m.TodosClient({ baseUrl: 'http://127.0.0.1:9' }); })",
  ], { cwd: appDir, quiet: true });
  await run([
    "bun",
    "-e",
    "import('@hasna/todos-sdk/schemas').then((m)=>{ if (!Array.isArray(m.todosTools) || !m.todosTools.some((tool)=>tool.name === 'todos_create_task')) throw new Error('missing schemas export') })",
  ], { cwd: appDir, quiet: true });
}

async function run(
  cmd: string[],
  options: { cwd?: string; quiet?: boolean; allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`Command failed (${exitCode}): ${cmd.join(" ")}\n${stdout}\n${stderr}`);
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

function isSemver(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
