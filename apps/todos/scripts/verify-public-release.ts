#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  validateNpmView,
  getInstallSmokeCommands,
  validatePackedPackageFiles,
  validatePackedProvenanceMetadata,
  validateInstallSmokeCommands,
  validatePublicTextSurfaces,
  validateReleaseProvenanceMetadata,
  validateRootPackageMetadata,
  validateSdkPackageMetadata,
  type PackageJson,
  type ReleaseGateFailure,
  type TextFile,
} from "../src/lib/public-release-gate";

type PackResult = {
  filename: string;
  files: Array<{ path: string }>;
  unpackedSize?: number;
};

const root = resolve(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));

main();

function main(): void {
  const failures: ReleaseGateFailure[] = [];
  const packageJson = readJson<PackageJson>("package.json");
  const sdkPackageJson = readJson<PackageJson>("sdk/package.json");

  failures.push(...validateRootPackageMetadata(packageJson));
  failures.push(...validateSdkPackageMetadata(sdkPackageJson));
  failures.push(...validatePublicTextSurfaces(collectPublicTextSurfaces(root)));

  if (!args.has("--skip-npm-view")) {
    const npmView = runCapture("npm", ["view", "@hasna/todos", "name", "version", "--json"]);
    if (npmView.status === 0) {
      failures.push(...validateNpmView("@hasna/todos", npmView.stdout));
    } else {
      failures.push({ check: "npm-view", message: npmView.stderr || "npm view @hasna/todos failed" });
    }
  }

  if (!args.has("--skip-build")) {
    runOrExit("bun", ["run", "build"]);
  }
  writeReleaseProvenance(packageJson);

  const tempDir = mkdtempSync(join(tmpdir(), "todos-release-"));
  try {
    const pack = npmPack(tempDir);
    failures.push(...validatePackedPackageFiles(pack.files.map((file) => `package/${file.path}`), { unpackedSize: pack.unpackedSize }));
    failures.push(...validatePackedProvenanceMetadata(readPackedPackageJson(join(tempDir, pack.filename))));
    failures.push(...validateReleaseProvenanceMetadata(readPackedReleaseProvenance(join(tempDir, pack.filename)), packageJson));
    failures.push(...scanPackedText(join(tempDir, pack.filename)));

    if (!args.has("--skip-install-smoke")) {
      const appDir = join(tempDir, "app");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "package.json"), `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`);
      installSmoke(join(tempDir, pack.filename), appDir);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error("Public release gate failed:");
    for (const failure of failures) {
      console.error(`- ${failure.check}: ${failure.message}`);
    }
    process.exit(1);
  }

  console.log("Public release gate passed.");
}

function writeReleaseProvenance(packageJson: PackageJson): void {
  const commit = runCapture("git", ["rev-parse", "HEAD"]);
  if (commit.status !== 0) {
    console.error(commit.stderr || "Could not resolve git commit for release provenance.");
    process.exit(commit.status || 1);
  }

  writeFileSync(
    join(root, "dist", "release-provenance.json"),
    `${JSON.stringify({
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      repository: packageJson.repository?.url,
      gitCommit: commit.stdout.trim(),
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

function npmPack(destination: string): PackResult {
  const result = runCapture("npm", ["pack", "--json", "--pack-destination", destination]);
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }

  const parsed = JSON.parse(result.stdout) as PackResult[];
  const pack = parsed[0];
  if (!pack?.filename || !Array.isArray(pack.files)) {
    console.error("npm pack did not return package file metadata.");
    process.exit(1);
  }
  return pack;
}

function installSmoke(tarball: string, appDir: string): void {
  const failures = validateInstallSmokeCommands(getInstallSmokeCommands(tarball, "19600"));
  if (failures.length > 0) {
    console.error("Install smoke plan is invalid:");
    for (const failure of failures) console.error(`- ${failure.check}: ${failure.message}`);
    process.exit(1);
  }

  for (const step of getInstallSmokeCommands(tarball, "19600")) {
    if (step.command.endsWith("todos-serve")) {
      expectServeStartup(appDir);
      continue;
    }
    if (step.required === false) run(step.command, step.args, appDir);
    else runOrExit(step.command, step.args, appDir);
  }
  smokeInstalledExports(appDir);
}

function expectServeStartup(appDir: string): void {
  const port = `${19600 + Math.floor(Math.random() * 1000)}`;
  console.log(`$ timeout 3 ./node_modules/.bin/todos-serve --port=${port} --host 127.0.0.1 --no-open`);
  const result = runCapture("timeout", ["3", "./node_modules/.bin/todos-serve", `--port=${port}`, "--host", "127.0.0.1", "--no-open"], appDir);
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes("Todos Dashboard running at")) {
    console.error(output);
    console.error("todos-serve did not print a startup URL during install smoke.");
    process.exit(result.status || 1);
  }
}

function smokeInstalledExports(appDir: string): void {
  const checks = [
    [
      "@hasna/todos",
      "if (!m.TodosClient || !m.createClient || !m.TODOS_REGISTRY) throw new Error('missing root exports')",
    ],
    [
      "@hasna/todos/sdk",
      "if (!m.TodosClient || !m.createClient || !m.TodosAPIError) throw new Error('missing sdk exports')",
    ],
    [
      "@hasna/todos/mcp",
      "if (!m.createMcpManifest || !Array.isArray(m.getMcpToolNames())) throw new Error('missing mcp exports')",
    ],
    [
      "@hasna/todos/registry",
      "if (!m.createTodosRegistry || !Array.isArray(m.TODOS_PACKAGE_EXPORTS)) throw new Error('missing registry exports')",
    ],
    [
      "@hasna/todos/contracts",
      "if (!m.createContractsManifest || !m.TODOS_CONTRACTS) throw new Error('missing contracts exports')",
    ],
    [
      "@hasna/todos/storage",
      "if (!m.createLocalSqliteTodosStorageAdapter || !Array.isArray(m.TODOS_STORAGE_TABLES)) throw new Error('missing storage exports')",
    ],
  ];

  for (const [specifier, assertion] of checks) {
    runOrExit("bun", ["-e", `import(${JSON.stringify(specifier)}).then((m)=>{ ${assertion}; })`], appDir);
  }
}

function readPackedPackageJson(tarball: string): PackageJson {
  return readPackedJson<PackageJson>(tarball, "package/package.json");
}

function readPackedReleaseProvenance(tarball: string): {
  packageName?: string;
  packageVersion?: string;
  repository?: string;
  gitCommit?: string;
  generatedAt?: string;
} {
  return readPackedJson(tarball, "package/dist/release-provenance.json");
}

function readPackedJson<T>(tarball: string, path: string): T {
  const result = runCapture("tar", ["-xOf", tarball, path]);
  if (result.status !== 0) {
    console.error(result.stderr || `Could not read ${path} from packed tarball.`);
    process.exit(result.status || 1);
  }
  return JSON.parse(result.stdout) as T;
}

function scanPackedText(tarball: string): ReleaseGateFailure[] {
  const list = runCapture("tar", ["-tf", tarball]);
  if (list.status !== 0) {
    return [{ check: "pack-list", message: list.stderr || "Could not list packed tarball" }];
  }

  const files: TextFile[] = [];
  for (const path of list.stdout.split("\n").filter(Boolean)) {
    if (!/\.(json|md|js|mjs|cjs|d\.ts|html|css|sh)$/.test(path)) continue;
    const content = runCapture("tar", ["-xOf", tarball, path]);
    if (content.status === 0) files.push({ path, text: content.stdout });
  }
  return validatePublicTextSurfaces(files);
}

function collectPublicTextSurfaces(dir: string): TextFile[] {
  return readdirSync(dir).flatMap((entry) => {
    if ([".git", ".codewith", ".takumi", "node_modules", "dist", "coverage", ".tmp"].includes(entry)) return [];
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return collectPublicTextSurfaces(path);
    if (!/\.(md|json|ya?ml|sh|ts|tsx)$/.test(path)) return [];
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return [];
    return [{ path: relative(root, path), text: readFileSync(path, "utf8") }];
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

function runOrExit(command: string, commandArgs: string[], cwd = root): void {
  const result = run(command, commandArgs, cwd);
  if (result.status !== 0) process.exit(result.status || 1);
}

function run(command: string, commandArgs: string[], cwd = root): ReturnType<typeof spawnSync> {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  return spawnSync(command, commandArgs, { cwd, stdio: "inherit", env: process.env });
}

function runCapture(command: string, commandArgs: string[], cwd = root): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
