#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  validateNpmView,
  getInstallSmokeCommands,
  validatePackedPackageFiles,
  validatePackedProvenanceMetadata,
  validateInstallSmokeCommands,
  validatePublicTextSurfaces,
  validateReleaseArtifactIntegrity,
  validateReleaseGateArguments,
  isPublicReleaseTextSurface,
  validateReleaseProvenanceMetadata,
  validateReleaseRepositoryState,
  validateRootPackageMetadata,
  validateSdkPackageMetadata,
  type PackageJson,
  type ReleaseGateFailure,
  type ReleaseSourceIdentity,
  type TextFile,
} from "../src/lib/public-release-gate";

type PackResult = {
  filename: string;
  files: Array<{ path: string }>;
  integrity?: string;
};

const root = resolve(import.meta.dir, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

main();

function main(): void {
  const failures: ReleaseGateFailure[] = [];
  const argumentFailures = validateReleaseGateArguments(rawArgs);
  if (argumentFailures.length > 0) failReleaseGate(argumentFailures);
  const repositoryState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (repositoryState.status !== 0) {
    failReleaseGate([{ check: "release-worktree-state", message: repositoryState.stderr || "git status failed" }]);
  }
  const repositoryFailures = validateReleaseRepositoryState(repositoryState.stdout);
  if (repositoryFailures.length > 0) failReleaseGate(repositoryFailures);

  const sourceIdentity = readReleaseSourceIdentity();
  const packageJson = readJson<PackageJson>("package.json");
  const sdkPackageJson = readJson<PackageJson>("sdk/package.json");

  failures.push(...validateRootPackageMetadata(packageJson));
  failures.push(...validateSdkPackageMetadata(sdkPackageJson));
  failures.push(...validatePublicTextSurfaces(collectPublicTextSurfaces(root)));

  if (!args.has("--skip-npm-view")) {
    const registryView = runCapture("npm", ["view", "@hasna/todos", "name", "version", "--json"]);
    if (registryView.status === 0) {
      failures.push(...validateNpmView("@hasna/todos", registryView.stdout));
    } else {
      const bunView = runCapture("bun", ["pm", "view", "@hasna/todos", "--json"]);
      if (bunView.status === 0) failures.push(...validateNpmView("@hasna/todos", bunView.stdout));
      else failures.push({ check: "npm-view", message: registryView.stderr || bunView.stderr || "registry view @hasna/todos failed" });
    }
  }

  runOrExit("bun", ["run", "build"]);
  writeReleaseProvenance(packageJson, sourceIdentity);

  const postBuildState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (postBuildState.status !== 0) {
    failReleaseGate([{ check: "release-worktree-state", message: postBuildState.stderr || "git status after build failed" }]);
  }
  const postBuildFailures = validateReleaseRepositoryState(postBuildState.stdout);
  if (postBuildFailures.length > 0) failReleaseGate(postBuildFailures);

  const tempDir = mkdtempSync(join(tmpdir(), "todos-release-"));
  let tarballIntegrity = "";
  try {
    const pack = npmPack(tempDir);
    const tarball = join(tempDir, pack.filename);
    tarballIntegrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
    failures.push(...validateReleaseArtifactIntegrity(pack.integrity, tarballIntegrity));
    failures.push(...validatePackedPackageFiles(pack.files.map((file) => `package/${file.path}`)));
    failures.push(...validatePackedProvenanceMetadata(readPackedPackageJson(tarball), packageJson));
    failures.push(...validateReleaseProvenanceMetadata(readPackedReleaseProvenance(tarball), packageJson, sourceIdentity));
    failures.push(...scanPackedText(tarball));

    if (!args.has("--skip-install-smoke")) {
      installSmoke(tarball);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const postPackState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (postPackState.status !== 0) {
    failures.push({ check: "release-worktree-state", message: postPackState.stderr || "git status after pack failed" });
  } else {
    failures.push(...validateReleaseRepositoryState(postPackState.stdout));
  }

  if (failures.length > 0) failReleaseGate(failures);

  console.log(JSON.stringify({
    package: `${packageJson.name}@${packageJson.version}`,
    git_commit: sourceIdentity.gitCommit,
    git_tree: sourceIdentity.gitTree,
    source_tree_sha256: sourceIdentity.sourceTreeSha256,
    tarball_integrity: tarballIntegrity,
  }));
  console.log("Public release gate passed.");
}

function writeReleaseProvenance(packageJson: PackageJson, sourceIdentity: ReleaseSourceIdentity): void {
  writeFileSync(
    join(root, "dist", "release-provenance.json"),
    `${JSON.stringify({
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      repository: packageJson.repository?.url,
      gitCommit: sourceIdentity.gitCommit,
      gitTree: sourceIdentity.gitTree,
      sourceTreeSha256: sourceIdentity.sourceTreeSha256,
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

function readReleaseSourceIdentity(): ReleaseSourceIdentity {
  const commit = runCapture("git", ["rev-parse", "HEAD"]);
  const tree = runCapture("git", ["rev-parse", "HEAD^{tree}"]);
  const listing = spawnSync("git", ["ls-tree", "-r", "--full-tree", "-z", "HEAD"], {
    cwd: root,
    env: process.env,
  });
  if (commit.status !== 0 || tree.status !== 0 || listing.status !== 0 || !listing.stdout) {
    failReleaseGate([{
      check: "release-source-identity",
      message: commit.stderr || tree.stderr || listing.stderr?.toString("utf8") || "could not resolve clean source identity",
    }]);
  }
  return {
    gitCommit: commit.stdout.trim(),
    gitTree: tree.stdout.trim(),
    sourceTreeSha256: createHash("sha256").update(listing.stdout).digest("hex"),
  };
}

function failReleaseGate(failures: ReleaseGateFailure[]): never {
  console.error("Public release gate failed:");
  for (const failure of failures) console.error(`- ${failure.check}: ${failure.message}`);
  process.exit(1);
}

function npmPack(destination: string): PackResult {
  const result = runCapture("npm", ["pack", "--json", "--pack-destination", destination]);
  if (result.status !== 0) return bunPack(destination);

  const parsed = JSON.parse(result.stdout) as PackResult[];
  const pack = parsed[0];
  if (!pack?.filename || !Array.isArray(pack.files)) {
    console.error("npm pack did not return package file metadata.");
    process.exit(1);
  }
  return pack;
}

function bunPack(destination: string): PackResult {
  const result = runCapture("bun", ["pm", "pack", "--destination", destination, "--quiet"]);
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "bun pm pack failed");
    process.exit(result.status || 1);
  }
  const filename = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!filename) {
    console.error("bun pm pack did not return a tarball path.");
    process.exit(1);
  }
  const tarball = filename.startsWith("/") ? filename : join(destination, filename);
  const list = runCapture("tar", ["-tf", tarball]);
  if (list.status !== 0) {
    console.error(list.stderr || `Could not list packed tarball: ${tarball}`);
    process.exit(list.status || 1);
  }
  return {
    filename: relative(destination, tarball),
    files: list.stdout
      .split("\n")
      .filter((path) => path.startsWith("package/") && path !== "package/")
      .map((path) => ({ path: path.slice("package/".length) })),
  };
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
  gitTree?: string;
  sourceTreeSha256?: string;
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
    if ([".git", ".codewith", ".hasna", ".takumi", "node_modules", "dist", "coverage", ".tmp"].includes(entry)) return [];
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return collectPublicTextSurfaces(path);
    if (!/\.(md|json|ya?ml|sh|ts|tsx)$/.test(path)) return [];
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return [];
    const publicPath = relative(root, path);
    if (!isPublicReleaseTextSurface(publicPath)) return [];
    return [{ path: publicPath, text: readFileSync(path, "utf8") }];
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
