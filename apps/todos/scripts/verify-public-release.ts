#!/usr/bin/env bun
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  validateNpmView,
  validateBunReleaseToolchain,
  getNpmPackArgs,
  getInstallSmokeCommands,
  validatePackedPackageFiles,
  validatePackedProvenanceMetadata,
  validateInstallSmokeCommands,
  validatePublicTextSurfaces,
  validateReleaseArtifactIntegrity,
  validateReleaseGateArguments,
  classifyReleaseGateAuthority,
  isPackedTextContent,
  resolveReleaseProvenanceTimestamp,
  validateExpectedReleaseCommit,
  validatePackedBinaryFile,
  validateReleaseIndexFlags,
  validateReproducibleArtifactIntegrity,
  validateTrackedWorktreeProof,
  isPublicReleaseTextSurface,
  validateReleaseProvenanceMetadata,
  validateReleaseRepositoryState,
  validateRootPackageMetadata,
  validateSdkPackageMetadata,
  type PackageJson,
  type ReleaseGateFailure,
  type ReleaseSourceIdentity,
  type TextFile,
  type TrackedWorktreeProof,
} from "../src/lib/public-release-gate";

type PackResult = {
  filename: string;
  files: Array<{ path: string; size?: number; mode?: number }>;
  integrity?: string;
};

const root = resolve(import.meta.dir, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

main();

function main(): void {
  const failures: ReleaseGateFailure[] = [];
  const toolchainFailures = validateBunReleaseToolchain(process.versions.bun);
  if (toolchainFailures.length > 0) failReleaseGate(toolchainFailures);
  const expectedCommitFromEnvironment = process.env["HASNA_TODOS_EXPECTED_COMMIT"];
  const lifecycleEvent = process.env["npm_lifecycle_event"];
  const authority = classifyReleaseGateAuthority(rawArgs, expectedCommitFromEnvironment, lifecycleEvent);
  const argumentFailures = validateReleaseGateArguments(rawArgs, {
    expectedCommit: expectedCommitFromEnvironment,
    lifecycleEvent,
  });
  if (argumentFailures.length > 0) failReleaseGate(argumentFailures);
  const repositoryState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (repositoryState.status !== 0) {
    failReleaseGate([{ check: "release-worktree-state", message: repositoryState.stderr || "git status failed" }]);
  }
  const repositoryFailures = validateReleaseRepositoryState(repositoryState.stdout);
  if (repositoryFailures.length > 0) failReleaseGate(repositoryFailures);

  const indexFlags = runCapture("git", ["ls-files", "-v"]);
  if (indexFlags.status !== 0) failReleaseGate([{ check: "release-index-flags", message: indexFlags.stderr || "git ls-files -v failed" }]);
  const indexFlagFailures = validateReleaseIndexFlags(indexFlags.stdout);
  if (indexFlagFailures.length > 0) failReleaseGate(indexFlagFailures);

  const trackedProofFailures = verifyTrackedWorktreeAgainstHead();
  if (trackedProofFailures.length > 0) failReleaseGate(trackedProofFailures);

  const sourceIdentity = readReleaseSourceIdentity();
  if (authority.mode === "publish") {
    const expectedCommitFailures = validateExpectedReleaseCommit(authority.expectedCommit!, sourceIdentity.gitCommit);
    if (expectedCommitFailures.length > 0) failReleaseGate(expectedCommitFailures);
  }
  const commitEpochResult = runCapture("git", ["show", "-s", "--format=%ct", "HEAD"]);
  if (commitEpochResult.status !== 0) failReleaseGate([{ check: "release-commit-time", message: commitEpochResult.stderr || "could not read commit timestamp" }]);
  const provenanceTimestamp = resolveReleaseProvenanceTimestamp(undefined, commitEpochResult.stdout.trim());
  process.env["SOURCE_DATE_EPOCH"] = `${Math.floor(Date.parse(provenanceTimestamp) / 1000)}`;
  const packageJson = readJson<PackageJson>("package.json");
  const sdkPackageJson = readJson<PackageJson>("sdk/package.json");
  const sourceLogo = readFileSync(join(root, "dashboard", "public", "logo.jpg"));

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
  writeReleaseProvenance(packageJson, sourceIdentity, provenanceTimestamp);

  const postBuildState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (postBuildState.status !== 0) {
    failReleaseGate([{ check: "release-worktree-state", message: postBuildState.stderr || "git status after build failed" }]);
  }
  const postBuildFailures = validateReleaseRepositoryState(postBuildState.stdout);
  if (postBuildFailures.length > 0) failReleaseGate(postBuildFailures);

  const tempDir = mkdtempSync(join(tmpdir(), "todos-release-"));
  let tarballIntegrity = "";
  try {
    const firstPackDir = join(tempDir, "first");
    const secondPackDir = join(tempDir, "second");
    mkdirSync(firstPackDir, { recursive: true });
    mkdirSync(secondPackDir, { recursive: true });
    const pack = npmPack(firstPackDir);
    const tarball = join(firstPackDir, pack.filename);
    const firstManifest = createPackedPayloadManifest(pack, tarball, join(tempDir, "first-payload"));
    tarballIntegrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
    failures.push(...validateReleaseArtifactIntegrity(pack.integrity, tarballIntegrity));
    const packedPackageJson = readPackedPackageJson(tarball);
    failures.push(...validatePackedPackageFiles(pack.files.map((file) => `package/${file.path}`), packedPackageJson));
    failures.push(...validatePackedProvenanceMetadata(packedPackageJson, packageJson));
    failures.push(...validateReleaseProvenanceMetadata(readPackedReleaseProvenance(tarball), packageJson, sourceIdentity));
    failures.push(...scanPackedText(tarball, sourceLogo));

    runOrExit("bun", ["run", "build"]);
    writeReleaseProvenance(packageJson, sourceIdentity, provenanceTimestamp);
    const secondPack = npmPack(secondPackDir);
    const secondTarball = join(secondPackDir, secondPack.filename);
    const secondManifest = createPackedPayloadManifest(secondPack, secondTarball, join(tempDir, "second-payload"));
    const secondIntegrity = `sha512-${createHash("sha512").update(readFileSync(secondTarball)).digest("base64")}`;
    failures.push(...validateReleaseArtifactIntegrity(secondPack.integrity, secondIntegrity));
    failures.push(...validateReproducibleArtifactIntegrity(tarballIntegrity, secondIntegrity, firstManifest, secondManifest));
    const secondPackedPackageJson = readPackedPackageJson(secondTarball);
    failures.push(...validatePackedPackageFiles(secondPack.files.map((file) => `package/${file.path}`), secondPackedPackageJson));
    failures.push(...validatePackedProvenanceMetadata(secondPackedPackageJson, packageJson));
    failures.push(...validateReleaseProvenanceMetadata(readPackedReleaseProvenance(secondTarball), packageJson, sourceIdentity));
    failures.push(...scanPackedText(secondTarball, sourceLogo));

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
    authoritative: authority.authoritative,
    skipped_checks: authority.skipped,
  }));
  console.log(authority.authoritative
    ? "Public release gate passed (AUTHORITATIVE)."
    : "Public release verification completed (NON-AUTHORITATIVE)."
  );
}

function writeReleaseProvenance(
  packageJson: PackageJson,
  sourceIdentity: ReleaseSourceIdentity,
  generatedAt: string,
): void {
  writeFileSync(
    join(root, "dist", "release-provenance.json"),
    `${JSON.stringify({
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      repository: packageJson.repository?.url,
      gitCommit: sourceIdentity.gitCommit,
      gitTree: sourceIdentity.gitTree,
      sourceTreeSha256: sourceIdentity.sourceTreeSha256,
      generatedAt,
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

function gitBlobObject(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`, "utf8");
  return createHash("sha1").update(header).update(content).digest("hex");
}

function verifyTrackedWorktreeAgainstHead(): ReleaseGateFailure[] {
  const listing = runCaptureBuffer("git", ["ls-tree", "-r", "--full-tree", "-z", "HEAD"]);
  if (listing.status !== 0) {
    return [{ check: "release-tracked-proof", message: listing.stderr.toString("utf8") || "could not enumerate HEAD" }];
  }
  const proof: TrackedWorktreeProof[] = [];
  for (const record of listing.stdout.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    if (!match) return [{ check: "release-tracked-proof", message: "could not parse git ls-tree output" }];
    const [, headMode, headType, headObject, path] = match;
    const absolute = join(root, path!);
    let actualType: TrackedWorktreeProof["actualType"] = "missing";
    let actualMode: string | null = null;
    let actualObject: string | null = null;
    try {
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) {
        actualType = "symlink";
        actualMode = "120000";
        actualObject = gitBlobObject(Buffer.from(readlinkSync(absolute), "utf8"));
      } else if (stats.isFile()) {
        actualType = "blob";
        actualMode = (stats.mode & 0o111) !== 0 ? "100755" : "100644";
        actualObject = gitBlobObject(readFileSync(absolute));
      } else {
        actualType = "other";
      }
    } catch {
      actualType = "missing";
    }
    proof.push({ path: path!, headType: headType!, headMode: headMode!, headObject: headObject!, actualType, actualMode, actualObject });
  }
  return validateTrackedWorktreeProof(proof);
}

function failReleaseGate(failures: ReleaseGateFailure[]): never {
  console.error("Public release gate failed:");
  for (const failure of failures) console.error(`- ${failure.check}: ${failure.message}`);
  process.exit(1);
}

function npmPack(destination: string): PackResult {
  const result = runCapture("npm", getNpmPackArgs(destination));
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "npm pack failed");
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

function createPackedPayloadManifest(pack: PackResult, tarball: string, destination: string): string {
  mkdirSync(destination, { recursive: true });
  const extract = runCapture("tar", ["-xf", tarball, "-C", destination]);
  if (extract.status !== 0) {
    failReleaseGate([{ check: "payload-manifest", message: extract.stderr || "could not extract packed payload" }]);
  }
  const entries = pack.files.map((file) => {
    const path = `package/${file.path}`;
    const absolute = join(destination, path);
    const stats = lstatSync(absolute);
    const type = stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
    const content = stats.isSymbolicLink()
      ? Buffer.from(readlinkSync(absolute), "utf8")
      : stats.isFile()
        ? readFileSync(absolute)
        : Buffer.alloc(0);
    return {
      path,
      type,
      mode: file.mode ?? (stats.mode & 0o7777),
      size: file.size ?? content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(entries);
}

function installSmoke(tarball: string): void {
  const installRoot = mkdtempSync(join(tmpdir(), "todos-install-smoke-"));
  try {
    writeFileSync(join(installRoot, "package.json"), `${JSON.stringify({ private: true })}\n`);
    const commands = getInstallSmokeCommands(tarball, "19600", installRoot);
    const failures = validateInstallSmokeCommands(commands);
    if (failures.length > 0) {
      console.error("Install smoke plan is invalid:");
      for (const failure of failures) console.error(`- ${failure.check}: ${failure.message}`);
      process.exit(1);
    }
    const isolatedEnv = {
      ...process.env,
      HOME: installRoot,
      BUN_INSTALL: join(installRoot, ".bun"),
      XDG_CACHE_HOME: join(installRoot, ".cache"),
    };
    for (const step of commands) {
      if (step.command.endsWith("/todos-serve")) {
        expectServeStartup(step.command, isolatedEnv);
        continue;
      }
      const result = run(step.command, step.args, isolatedEnv);
      if (step.required !== false && result.status !== 0) process.exit(result.status || 1);
    }
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
}

function expectServeStartup(command: string, env: NodeJS.ProcessEnv): void {
  const port = `${19600 + Math.floor(Math.random() * 1000)}`;
  console.log(`$ timeout 3 ${command} --port=${port} --host 127.0.0.1 --no-open`);
  const result = runCapture("timeout", ["3", command, `--port=${port}`, "--host", "127.0.0.1", "--no-open"], env);
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

function scanPackedText(tarball: string, sourceLogo: Buffer): ReleaseGateFailure[] {
  const list = runCapture("tar", ["-tf", tarball]);
  if (list.status !== 0) {
    return [{ check: "pack-list", message: list.stderr || "Could not list packed tarball" }];
  }

  const files: TextFile[] = [];
  const failures: ReleaseGateFailure[] = [];
  for (const path of list.stdout.split("\n").filter(Boolean)) {
    if (path.endsWith("/")) continue;
    const content = runCaptureBuffer("tar", ["-xOf", tarball, path]);
    if (content.status !== 0) {
      failures.push({ check: "pack-read", message: content.stderr.toString("utf8") || `Could not read ${path}` });
      continue;
    }
    if (isPackedTextContent(content.stdout)) {
      files.push({ path, text: content.stdout.toString("utf8") });
    } else {
      failures.push(...validatePackedBinaryFile(path, content.stdout, sourceLogo));
      files.push({ path, text: content.stdout.toString("latin1") });
    }
  }
  return [...failures, ...validatePublicTextSurfaces(files)];
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

function run(command: string, commandArgs: string[], env: NodeJS.ProcessEnv = process.env): ReturnType<typeof spawnSync> {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  return spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env });
}

function runCapture(command: string, commandArgs: string[], env: NodeJS.ProcessEnv = process.env): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runCaptureBuffer(command: string, commandArgs: string[]): { status: number; stdout: Buffer; stderr: Buffer } {
  const result = spawnSync(command, commandArgs, { cwd: root, env: process.env });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
  };
}
