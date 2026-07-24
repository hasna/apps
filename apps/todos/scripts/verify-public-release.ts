#!/usr/bin/env bun
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  resolveReleaseProvenanceTimestamp,
  validateExpectedReleaseCommit,
  validateReleaseIndexFlags,
  validateReproducibleArtifactIntegrity,
  validateTrackedWorktreeProof,
  validateReleaseProvenanceMetadata,
  validateReleaseRepositoryState,
  validateRootPackageMetadata,
  validateSdkPackageMetadata,
  type PackageJson,
  type ReleaseCandidateIdentity,
  type ReleaseGateFailure,
  type ReleaseSourceIdentity,
  type TrackedWorktreeProof,
} from "../src/lib/public-release-gate";
import { collectPublicTextSurfaces } from "../src/lib/public-release-files";
import { scanExtractedPackedFiles } from "../src/lib/release-packed-scan";
import { readPackedRegularFiles, scanPackedArchive } from "../src/lib/public-release-archive";

const MAX_STRUCTURED_JSON_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

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
  if (authority.mode === "publish") {
    const repositoryFailures = validateReleaseRepositoryState(repositoryState.stdout);
    if (repositoryFailures.length > 0) failReleaseGate(repositoryFailures);
  }

  const indexFlags = runCapture("git", ["ls-files", "-v"]);
  if (indexFlags.status !== 0) failReleaseGate([{ check: "release-index-flags", message: indexFlags.stderr || "git ls-files -v failed" }]);
  const indexFlagFailures = validateReleaseIndexFlags(indexFlags.stdout);
  if (indexFlagFailures.length > 0) failReleaseGate(indexFlagFailures);

  if (authority.mode === "publish") {
    const trackedProofFailures = verifyTrackedWorktreeAgainstHead();
    if (trackedProofFailures.length > 0) failReleaseGate(trackedProofFailures);
  }

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
  const candidateIdentity = resolveCandidateIdentity(sourceIdentity.gitCommit);
  writeReleaseProvenance(packageJson, sourceIdentity, candidateIdentity, provenanceTimestamp);

  const postBuildState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (postBuildState.status !== 0) {
    failReleaseGate([{ check: "release-worktree-state", message: postBuildState.stderr || "git status after build failed" }]);
  }
  if (authority.mode === "publish") {
    const postBuildFailures = validateReleaseRepositoryState(postBuildState.stdout);
    if (postBuildFailures.length > 0) failReleaseGate(postBuildFailures);
  } else if (JSON.stringify(resolveCandidateIdentity(candidateIdentity.candidateBaseRef)) !== JSON.stringify(candidateIdentity)) {
    failReleaseGate([{
      check: "provenance-candidate-drift",
      message: "candidate bytes changed while release provenance was generated",
    }]);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "todos-release-"));
  let tarballIntegrity = "";
  try {
    const firstPackDir = join(tempDir, "first");
    const secondPackDir = join(tempDir, "second");
    mkdirSync(firstPackDir, { recursive: true });
    mkdirSync(secondPackDir, { recursive: true });
    const pack = npmPack(firstPackDir);
    const tarball = join(firstPackDir, pack.filename);
    const firstPayloadDir = join(tempDir, "first-payload");
    const firstManifest = createPackedPayloadManifest(pack, tarball, firstPayloadDir);
    tarballIntegrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
    failures.push(...validateReleaseArtifactIntegrity(pack.integrity, tarballIntegrity));
    const packedPackageJson = readPackedPackageJson(tarball);
    failures.push(...validatePackedPackageFiles(pack.files.map((file) => `package/${file.path}`), packedPackageJson));
    failures.push(...validatePackedProvenanceMetadata(packedPackageJson, packageJson));
    failures.push(...validateReleaseProvenanceMetadata(
      readPackedReleaseProvenance(tarball),
      packageJson,
      sourceIdentity,
      candidateIdentity,
    ));
    failures.push(...scanExtractedPackedFiles(pack.files, firstPayloadDir, sourceLogo));
    failures.push(...scanPackedArchive(tarball));

    runOrExit("bun", ["run", "build"]);
    const afterSecondBuild = resolveCandidateIdentity(candidateIdentity.candidateBaseRef);
    if (JSON.stringify(afterSecondBuild) !== JSON.stringify(candidateIdentity)) {
      failReleaseGate([{
        check: "provenance-candidate-drift",
        message: "candidate bytes changed during the deterministic rebuild",
      }]);
    }
    writeReleaseProvenance(packageJson, sourceIdentity, candidateIdentity, provenanceTimestamp);
    const secondPack = npmPack(secondPackDir);
    const secondTarball = join(secondPackDir, secondPack.filename);
    const secondPayloadDir = join(tempDir, "second-payload");
    const secondManifest = createPackedPayloadManifest(secondPack, secondTarball, secondPayloadDir);
    const secondIntegrity = `sha512-${createHash("sha512").update(readFileSync(secondTarball)).digest("base64")}`;
    failures.push(...validateReleaseArtifactIntegrity(secondPack.integrity, secondIntegrity));
    failures.push(...validateReproducibleArtifactIntegrity(tarballIntegrity, secondIntegrity, firstManifest, secondManifest));
    const secondPackedPackageJson = readPackedPackageJson(secondTarball);
    failures.push(...validatePackedPackageFiles(secondPack.files.map((file) => `package/${file.path}`), secondPackedPackageJson));
    failures.push(...validatePackedProvenanceMetadata(secondPackedPackageJson, packageJson));
    failures.push(...validateReleaseProvenanceMetadata(
      readPackedReleaseProvenance(secondTarball),
      packageJson,
      sourceIdentity,
      candidateIdentity,
    ));
    failures.push(...scanExtractedPackedFiles(secondPack.files, secondPayloadDir, sourceLogo));
    failures.push(...scanPackedArchive(secondTarball));

    const afterPack = resolveCandidateIdentity(candidateIdentity.candidateBaseRef);
    if (JSON.stringify(afterPack) !== JSON.stringify(candidateIdentity)) {
      failures.push({
        check: "provenance-candidate-drift",
        message: "candidate bytes changed after release provenance was frozen",
      });
    }

    if (!args.has("--skip-install-smoke")) {
      installSmoke(tarball);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const postPackState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (postPackState.status !== 0) {
    failures.push({ check: "release-worktree-state", message: postPackState.stderr || "git status after pack failed" });
  } else if (authority.mode === "publish") {
    failures.push(...validateReleaseRepositoryState(postPackState.stdout));
  } else if (JSON.stringify(resolveCandidateIdentity(candidateIdentity.candidateBaseRef)) !== JSON.stringify(candidateIdentity)) {
    failures.push({
      check: "provenance-candidate-drift",
      message: "candidate bytes changed during packing",
    });
  }

  if (failures.length > 0) failReleaseGate(failures);

  console.log(JSON.stringify({
    package: `${packageJson.name}@${packageJson.version}`,
    git_commit: sourceIdentity.gitCommit,
    git_tree: sourceIdentity.gitTree,
    source_tree_sha256: sourceIdentity.sourceTreeSha256,
    candidate_base_ref: candidateIdentity.candidateBaseRef,
    candidate_digest: candidateIdentity.candidateDigest,
    tracked_binary_diff_sha256: candidateIdentity.trackedBinaryDiffSha256,
    untracked_path_set_sha256: candidateIdentity.untrackedPathSetSha256,
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
  candidateIdentity: ReleaseCandidateIdentity,
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
      ...candidateIdentity,
      generatedAt,
    }, null, 2)}\n`,
  );
}

function resolveCandidateIdentity(baseRef: string): ReleaseCandidateIdentity {
  const script = join(root, "scripts", "candidate-digest.sh");
  const runDigest = (mode: "candidate" | "tracked" | "untracked"): string => {
    const result = runCapture("bash", [script, baseRef, mode]);
    const digest = result.stdout.trim();
    if (result.status !== 0 || !/^[0-9a-f]{64}$/.test(digest)) {
      console.error(result.stderr || `Could not compute ${mode} candidate digest.`);
      process.exit(result.status || 1);
    }
    return digest;
  };
  return Object.freeze({
    candidateBaseRef: baseRef,
    candidateDigest: runDigest("candidate"),
    trackedBinaryDiffSha256: runDigest("tracked"),
    untrackedPathSetSha256: runDigest("untracked"),
  });
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

  const parsed = parseStructuredJson<PackResult[]>(result.stdout, "npm pack metadata");
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
  candidateBaseRef?: string;
  candidateDigest?: string;
  trackedBinaryDiffSha256?: string;
  untrackedPathSetSha256?: string;
  generatedAt?: string;
} {
  return readPackedJson(tarball, "package/dist/release-provenance.json");
}

function readPackedJson<T>(tarball: string, path: string): T {
  const file = readPackedRegularFiles(tarball).find((entry) => entry.path === path);
  if (!file) throw new Error(`Packed archive is missing ${path}`);
  return parseStructuredJson<T>(file.bytes, path);
}

function readJson<T>(path: string): T {
  const absolute = join(root, path);
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > MAX_STRUCTURED_JSON_BYTES) {
      throw new Error(`${path} is not a bounded regular JSON file`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.byteLength !== after.size) {
      throw new Error(`${path} changed while it was read`);
    }
    return parseStructuredJson<T>(bytes, path);
  } finally {
    closeSync(descriptor);
  }
}

function parseStructuredJson<T>(value: string | Uint8Array, label: string): T {
  const size = typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
  if (size > MAX_STRUCTURED_JSON_BYTES) {
    throw new Error(`${label} exceeds ${MAX_STRUCTURED_JSON_BYTES} structured JSON bytes`);
  }
  const text = typeof value === "string" ? value : new TextDecoder("utf-8", { fatal: true }).decode(value);
  return JSON.parse(text) as T;
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
    maxBuffer: MAX_CAPTURE_BYTES,
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
