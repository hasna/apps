#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, statSync, readdirSync, writeFileSync } from "node:fs";
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
    failures.push(...validatePackedPackageFiles(pack.files.map((file) => `package/${file.path}`)));
    failures.push(...validatePackedProvenanceMetadata(readPackedPackageJson(join(tempDir, pack.filename))));
    failures.push(...validateReleaseProvenanceMetadata(readPackedReleaseProvenance(join(tempDir, pack.filename)), packageJson));
    failures.push(...scanPackedText(join(tempDir, pack.filename)));

    if (!args.has("--skip-install-smoke")) {
      installSmoke(join(tempDir, pack.filename));
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

function installSmoke(tarball: string): void {
  const failures = validateInstallSmokeCommands(getInstallSmokeCommands(tarball, "19600"));
  if (failures.length > 0) {
    console.error("Install smoke plan is invalid:");
    for (const failure of failures) console.error(`- ${failure.check}: ${failure.message}`);
    process.exit(1);
  }

  for (const step of getInstallSmokeCommands(tarball, "19600")) {
    if (step.command === "todos-serve") {
      expectServeStartup();
      continue;
    }
    const args = withInternalPackageInstallOverride(step.command, step.args);
    if (step.required === false) run(step.command, args);
    else runOrExit(step.command, args);
  }
}

function withInternalPackageInstallOverride(command: string, args: string[]): string[] {
  if (command !== "bun") return args;
  if (args[0] !== "install" || !args.includes("-g")) return args;
  if (args.some((arg) => arg.startsWith("--minimum-release-age"))) return args;
  return [...args, "--minimum-release-age=0"];
}

function expectServeStartup(): void {
  const port = `${19600 + Math.floor(Math.random() * 1000)}`;
  console.log(`$ timeout 3 todos-serve --port=${port} --host 127.0.0.1 --no-open`);
  const result = runCapture("timeout", ["3", "todos-serve", `--port=${port}`, "--host", "127.0.0.1", "--no-open"]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes("Todos Dashboard running at")) {
    console.error(output);
    console.error("todos-serve did not print a startup URL during install smoke.");
    process.exit(result.status || 1);
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

function runOrExit(command: string, commandArgs: string[]): void {
  const result = run(command, commandArgs);
  if (result.status !== 0) process.exit(result.status || 1);
}

function run(command: string, commandArgs: string[]): ReturnType<typeof spawnSync> {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  return spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env: process.env });
}

function runCapture(command: string, commandArgs: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
