#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" assert { type: "json" };

const PACKAGE_NAME = "@hasna/machines";
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
const MACHINES_BIN_NAMES = ["machines", "machines-mcp", "machines-agent", "machines-serve"] as const;
const DEPENDENCY_EVENT_BIN_NAMES = ["events", "hasna-events"] as const;
const REQUIRED_FILES = [
  "package/package.json",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/consumer.js",
  "package/dist/consumer.d.ts",
  "package/dist/storage.js",
  "package/dist/storage.d.ts",
  "package/dist/cli/index.js",
  "package/dist/mcp/index.js",
  "package/dist/agent/index.js",
  "package/schemas/machines-consumer.schema.json",
  "package/scripts/consumer-conformance.mjs",
  "package/LICENSE",
  "package/README.md",
  "package/CHANGELOG.md",
  "package/SECURITY.md",
  "package/CONTRIBUTING.md",
  "package/CODE_OF_CONDUCT.md",
];
const FORBIDDEN_PATTERNS = [
  /^package\/\.hasna\//,
  /^package\/test\//,
  /^package\/src\//,
  /^package\/scripts\/(?!consumer-conformance\.mjs$)/,
  /^package\/.*(?:\.test|\.spec)\.(?:js|mjs|cjs|d\.ts)(?:\.map)?$/i,
  /^package\/.*\.map$/i,
  /^package\/.*\.db$/,
  /^package\/.*\.sqlite$/,
  /^package\/.*\.env$/,
  /^package\/.*secret/i,
];

async function main(): Promise<void> {
  assertReleaseScripts();
  await assertVersionIsPublishable();
  const tmp = mkdtempSync(join(tmpdir(), "machines-release-"));
  try {
    const packed = await pack(tmp);
    const files = await listTarball(packed);
    assertPackageContents(files, packed);
    await assertPackedPackageBinBoundary(packed);

    const appDir = join(tmp, "app");
    mkdirSync(appDir, { recursive: true });
    await Bun.write(join(appDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
    await run(["bun", "add", "--production", "--ignore-scripts", "--no-save", packed], { cwd: appDir, quiet: true });
    await smokeInstalledPackage(appDir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("machines release verification passed");
}

async function assertVersionIsPublishable(): Promise<void> {
  const publishedVersions = await maybeNpmVersions(PACKAGE_NAME);
  if (publishedVersions.length === 0) return;
  assert(!publishedVersions.includes(packageJson.version), `${PACKAGE_NAME}@${packageJson.version} is already published`);
  const maxPublished = publishedVersions.reduce((max, version) => compareSemver(version, max) > 0 ? version : max, publishedVersions[0]!);
  assert(compareSemver(packageJson.version, maxPublished) > 0, `${PACKAGE_NAME}@${packageJson.version} must be greater than published ${maxPublished}`);
}

async function pack(destination: string): Promise<string> {
  const result = await run(["bun", "pm", "pack", "--destination", destination, "--ignore-scripts", "--quiet"], { quiet: true });
  const filename = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  assert(filename, "bun pm pack did not return a filename");
  const packed = filename.startsWith("/") ? filename : join(destination, filename);
  assert(existsSync(packed), `bun pm pack did not create ${packed}`);
  return packed;
}

async function listTarball(path: string): Promise<string[]> {
  const result = await run(["tar", "-tf", path], { quiet: true });
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function assertPackageContents(files: string[], packed: string): void {
  const set = new Set(files);
  for (const file of REQUIRED_FILES) {
    assert(set.has(file), `packed artifact missing ${file}`);
  }
  for (const file of files) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert(!pattern.test(file), `packed artifact contains forbidden path ${file}`);
    }
  }
  const size = Bun.file(packed).size;
  assert(size <= MAX_PACKAGE_BYTES, `packed artifact is too large: ${size} bytes`);
}

async function assertPackedPackageBinBoundary(packed: string): Promise<void> {
  const result = await run(["tar", "-xOf", packed, "package/package.json"], { quiet: true });
  const packedPackage = JSON.parse(result.stdout) as { bin?: Record<string, string> };
  assertMachinesOwnedBinBoundary(packedPackage.bin ?? {});
}

function assertReleaseScripts(): void {
  assertMachinesOwnedBinBoundary(packageJson.bin ?? {});
  const scripts = packageJson.scripts ?? {};
  assert(
    scripts["verify:release"] === "bun run typecheck && bun test && bun run build && bun run smoke:consumer-conformance && bun run scripts/verify-release.ts",
    "verify:release must run the exact release gate chain",
  );
  assert(scripts.prepublishOnly === "bun run verify:release", "prepublishOnly must run verify:release");

  const files = new Set(packageJson.files ?? []);
  for (const file of ["dist", "schemas", "scripts/consumer-conformance.mjs", "LICENSE", "README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"]) {
    assert(files.has(file), `package files missing ${file}`);
  }
  assert(!files.has("scripts"), "package files must not include the whole scripts directory");
}

async function smokeInstalledPackage(appDir: string): Promise<void> {
  await run(["bun", "-e", "import('@hasna/machines').then((m)=>{ if (!m.getPackageVersion || !m.checkMachineCompatibility || !m.resolveMachineWorkspace) throw new Error('missing root exports') })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/machines').then((m)=>{ for (const name of ['writeManifest','getDb','upsertHeartbeat','writeHeartbeat','watchTmuxPane','getStoragePg','PgAdapterAsync','createTrustedSdkMutationApproval']) if (name in m) throw new Error('raw root export: '+name); })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/machines/consumer').then((m)=>{ if (!m.resolveMachineWorkspace || !m.MACHINES_CONSUMER_CONTRACT_VERSION) throw new Error('missing consumer exports') })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/machines/storage').then((m)=>{ if (!m.getStorageStatus || !m.storagePush) throw new Error('missing storage exports') })"], { cwd: appDir, quiet: true });
  await run(["bun", "-e", "import('@hasna/machines/storage').then((m)=>{ for (const name of ['getStoragePg','PgAdapterAsync']) if (name in m) throw new Error('raw storage export: '+name); })"], { cwd: appDir, quiet: true });
  await run(["sh", "-lc", "command -v ./node_modules/.bin/machines ./node_modules/.bin/machines-mcp ./node_modules/.bin/machines-agent"], { cwd: appDir, quiet: true });
  assertInstalledDependencyBinBoundary(appDir);
  await run(["./node_modules/.bin/machines", "--version"], { cwd: appDir, quiet: true, expect: packageJson.version });
  await run(["./node_modules/.bin/machines", "--help"], { cwd: appDir, quiet: true, expect: "Usage:" });
  await run(["./node_modules/.bin/machines", "self-test", "--json"], { cwd: appDir, quiet: true, expect: "\"checks\"" });
  await run(["./node_modules/.bin/machines-mcp", "--version"], { cwd: appDir, quiet: true, expect: packageJson.version });
  await run(["./node_modules/.bin/machines-mcp", "--help"], { cwd: appDir, quiet: true, expect: "Usage:" });
  await run(["./node_modules/.bin/machines-agent", "--version"], { cwd: appDir, quiet: true, expect: packageJson.version });
  await run(["./node_modules/.bin/machines-agent", "--help"], { cwd: appDir, quiet: true, expect: "Usage:" });
  await run([
      "bun",
      join(appDir, "node_modules", "@hasna", "machines", "scripts", "consumer-conformance.mjs"),
    "--package-dir",
    join(appDir, "node_modules", "@hasna", "machines"),
    "--cli-command",
    join(appDir, "node_modules", ".bin", "machines"),
  ], { cwd: appDir, quiet: true, expect: "machines consumer conformance: ok" });
}

function assertMachinesOwnedBinBoundary(bin: Record<string, string>): void {
  const actual = Object.keys(bin).sort();
  assert(JSON.stringify(actual) === JSON.stringify([...MACHINES_BIN_NAMES].sort()), `package bin names must be machines-owned only, got ${actual.join(", ")}`);
  for (const name of DEPENDENCY_EVENT_BIN_NAMES) {
    assert(!(name in bin), `package bin must not expose dependency-owned ${name}`);
  }
  const scriptValues = Object.values(packageJson.scripts ?? {}).join("\n");
  assert(!/node_modules\/\.bin\/(?:events|hasna-events)\b/.test(scriptValues), "package scripts must not invoke dependency event bins by node_modules/.bin path");
  assert(!/(^|[\s;&|])events\s+(?:events|webhooks)\b/.test(scriptValues), "package scripts must not invoke dependency events CLI event/webhook subcommands");
  assert(!/(^|[\s;&|])hasna-events\s+(?:events|webhooks)\b/.test(scriptValues), "package scripts must not invoke dependency hasna-events event/webhook subcommands");
  assert(!/(^|[\s;&|])hasna-events(?:\s|$)/.test(scriptValues), "package scripts must not invoke hasna-events directly");
}

function assertInstalledDependencyBinBoundary(appDir: string): void {
  for (const name of DEPENDENCY_EVENT_BIN_NAMES) {
    const binPath = join(appDir, "node_modules", ".bin", name);
    if (!existsSync(binPath)) continue;
    const target = realpathSync(binPath);
    assert(target.includes(join("node_modules", "@hasna", "events")), `dependency-owned ${name} bin must resolve to @hasna/events, got ${target}`);
    assert(!target.includes(join("node_modules", "@hasna", "machines")), `dependency-owned ${name} bin must not resolve inside @hasna/machines`);
  }
}

async function maybeNpmVersions(pkg: string): Promise<string[]> {
  const result = await run(["bun", "pm", "view", pkg, "versions", "--json"], { quiet: true, allowFailure: true });
  if (result.exitCode !== 0) return [];
  const parsed = JSON.parse(result.stdout) as string[] | string;
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function run(
  cmd: string[],
  options: { cwd?: string; quiet?: boolean; expect?: string; allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const dataRoot = join(tmpdir(), "machines-release-data");
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HASNA_MACHINES_DIR: dataRoot,
      HASNA_MACHINES_DB_PATH: join(dataRoot, "machines.db"),
      HASNA_MACHINES_MANIFEST_PATH: join(dataRoot, "machines.json"),
      HASNA_MACHINES_NOTIFICATIONS_PATH: join(dataRoot, "notifications.json"),
      HASNA_MACHINES_MACHINE_ID: "release-smoke-local",
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
