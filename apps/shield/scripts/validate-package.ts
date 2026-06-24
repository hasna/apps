import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackedFile = {
  path: string;
};

type PackResult = {
  filename: string;
  files: PackedFile[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function npmPack(args: string[], cwd: string): PackResult[] {
  const output = execFileSync("npm", ["pack", "--json", ...args], {
    cwd,
    encoding: "utf-8",
  });
  return JSON.parse(output) as PackResult[];
}

function requirePackedFiles(files: Set<string>): void {
  const required = [
    "bin/shield.sh",
    "bin/shield-mcp.sh",
    "bin/shield-serve.sh",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/storage.js",
    "dist/storage.d.ts",
    "sdk/dist/index.js",
    "sdk/dist/index.d.ts",
    "sdk/dist/client.d.ts",
    "sdk/dist/schemas.js",
    "sdk/dist/schemas.d.ts",
    "sdk/dist/types.d.ts",
  ];

  const missing = required.filter((path) => !files.has(path));
  assert(missing.length === 0, `npm pack is missing required files: ${missing.join(", ")}`);
}

function validateBinMetadata(packageDir: string): void {
  const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf-8"));
  const bin = packageJson.bin ?? {};

  assert(bin.shield === "bin/shield.sh", "package bin must expose shield -> bin/shield.sh");
  assert(bin["shield-mcp"] === "bin/shield-mcp.sh", "package bin must expose shield-mcp");
  assert(bin["shield-serve"] === "bin/shield-serve.sh", "package bin must expose shield-serve");
  assert(!("security" in bin), "package bin should not expose the ambiguous security alias");
}

function unpackTarball(repoRoot: string, tempDir: string): string {
  const [pack] = npmPack(["--pack-destination", tempDir], repoRoot);
  assert(pack?.filename, "npm pack did not return a tarball filename");

  const tarballPath = isAbsolute(pack.filename)
    ? pack.filename
    : join(tempDir, basename(pack.filename));

  execFileSync("tar", ["-xzf", tarballPath, "-C", tempDir], { stdio: "pipe" });
  return join(tempDir, "package");
}

function findExecutable(name: string): string {
  return execFileSync("sh", ["-c", `command -v ${name}`], {
    encoding: "utf-8",
  }).trim();
}

function linkDependency(repoRoot: string, consumerDir: string, dependency: string): void {
  const source = join(repoRoot, "node_modules", dependency);
  assert(existsSync(source), `package dependency is not installed locally: ${dependency}`);

  const target = join(consumerDir, "node_modules", dependency);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target, "dir");
}

function installPackedPackage(repoRoot: string, packageDir: string, consumerDir: string): string {
  const scopeDir = join(consumerDir, "node_modules", "@hasna");
  mkdirSync(scopeDir, { recursive: true });
  const installedPackageDir = join(scopeDir, "shield");
  cpSync(packageDir, installedPackageDir, { recursive: true });

  const packageJson = JSON.parse(readFileSync(join(installedPackageDir, "package.json"), "utf-8"));
  for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
    linkDependency(repoRoot, consumerDir, dependency);
  }

  const binDir = join(consumerDir, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  symlinkSync("../@hasna/shield/bin/shield.sh", join(binDir, "shield"));

  return installedPackageDir;
}

function smokeTestImports(consumerDir: string): void {
  const smokeFile = join(consumerDir, "smoke.mjs");
  writeFileSync(
    smokeFile,
    `
const root = await import("@hasna/shield");
const storage = await import("@hasna/shield/storage");
const sdk = await import("@hasna/shield/sdk");

if (!root.ScannerType) throw new Error("root import did not expose ScannerType");
if (typeof storage.getStorageConfig !== "function") throw new Error("storage import did not expose getStorageConfig");
if (typeof sdk.OpenSecurityClient !== "function") throw new Error("sdk import did not expose OpenSecurityClient");

const db = root.getTestDb();
const row = db.prepare("SELECT 1 AS ok").get();
if (row.ok !== 1) throw new Error("root sqlite database helper did not execute under Node");
const status = storage.getStorageStatus(db);
if (!Array.isArray(status.tables)) throw new Error("storage status did not read sqlite tables");
db.close();
`,
    "utf-8",
  );

  execFileSync(findExecutable("node"), [smokeFile], {
    cwd: consumerDir,
    env: { ...process.env, SECURITY_DB: join(consumerDir, "shield.db") },
    stdio: "pipe",
  });
}

function smokeTestTypes(repoRoot: string, consumerDir: string): void {
  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify({ type: "module", private: true }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          types: [],
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    ),
    "utf-8",
  );
  writeFileSync(
    join(consumerDir, "smoke.ts"),
    `
import { ScannerType, getDb } from "@hasna/shield";
import { getStorageStatus, type StorageSyncResult } from "@hasna/shield/storage";
import { OpenSecurityClient } from "@hasna/shield/sdk";

const scanner: ScannerType = ScannerType.Secrets;
const getDatabase = getDb;
const storageStatus = getStorageStatus;
const client = new OpenSecurityClient("http://localhost:19428");
const syncResult: StorageSyncResult = { table: "projects", direction: "push", rowsRead: 0, rowsWritten: 0, errors: [] };

void scanner;
void getDatabase;
void storageStatus;
void client;
void syncResult;
`,
    "utf-8",
  );

  const tscBin = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  assert(existsSync(tscBin), "local TypeScript compiler is not installed");
  execFileSync(tscBin, ["--noEmit", "-p", consumerDir], {
    cwd: consumerDir,
    stdio: "pipe",
  });
}

function smokeTestCli(consumerDir: string, packageDir: string): void {
  const nodePath = findExecutable("node");
  const helpOutput = execFileSync(join(consumerDir, "node_modules", ".bin", "shield"), ["--help"], {
    cwd: consumerDir,
    encoding: "utf-8",
    env: { ...process.env, PATH: `${dirname(nodePath)}:/usr/bin:/bin` },
  });

  assert(helpOutput.includes("Usage: shield"), "packed shield bin did not print shield help");
  assert(!existsSync(join(packageDir, "bin", "security.sh")), "packed package should not include a security bin shim");
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [dryRun] = npmPack(["--dry-run"], repoRoot);
assert(dryRun, "npm pack --dry-run returned no package result");

const dryRunFiles = new Set(dryRun.files.map((file) => file.path));
requirePackedFiles(dryRunFiles);
validateBinMetadata(repoRoot);

const tempDir = mkdtempSync(join(tmpdir(), "shield-pack-"));
try {
  const packageDir = unpackTarball(repoRoot, tempDir);
  requirePackedFiles(
    new Set(
      Array.from(dryRunFiles).filter((path) => existsSync(join(packageDir, path))),
    ),
  );
  validateBinMetadata(packageDir);

  const consumerDir = join(tempDir, "consumer");
  const installedPackageDir = installPackedPackage(repoRoot, packageDir, consumerDir);
  smokeTestImports(consumerDir);
  smokeTestTypes(repoRoot, consumerDir);
  smokeTestCli(consumerDir, installedPackageDir);

  console.log(`Package validation passed (${dryRunFiles.size} files checked).`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
