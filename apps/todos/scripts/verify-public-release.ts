#!/usr/bin/env bun
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  validateNpmView,
  validateBunReleaseToolchain,
  RELEASE_DEPENDENCY_INSTALL_COMMAND,
  getIsolatedReleaseInstallArgs,
  getNpmPackArgs,
  getInstallSmokeCommands,
  validatePackedPackageFiles,
  validatePackedProvenanceMetadata,
  validateInstallSmokeCommands,
  validateIsolatedReleaseInstall,
  validatePublicTextSurfaces,
  validateReleaseArtifactIntegrity,
  validateReleaseGateArguments,
  classifyReleaseGateAuthority,
  resolveReleaseProvenanceTimestamp,
  validateExpectedReleaseCommit,
  validateReleaseIndexFlags,
  validateReproducibleArtifactIntegrity,
  validateTrackedWorktreeProof,
  isPublicReleaseTextSurface,
  validateReleaseProvenanceMetadata,
  validateReleaseRepositoryState,
  validateRootPackageMetadata,
  validateSdkPackageMetadata,
  type PackageJson,
  type ReleaseBuildIdentity,
  type ReleaseGateFailure,
  type ReleaseSourceIdentity,
  type ReleaseProvenance,
  type TextFile,
  type TrackedWorktreeProof,
} from "../src/lib/public-release-gate";
import { withVerifiedArtifactPromotion } from "../src/lib/release-artifact-promotion";
import { scanExtractedPackedFiles } from "../src/lib/release-packed-scan";
import {
  createReleaseArtifactManifest,
  validateReleaseArtifactManifest,
} from "../src/lib/release-artifact-manifest";

type PackResult = {
  filename: string;
  files: Array<{ path: string; size?: number; mode?: number }>;
  integrity?: string;
};

const root = resolve(import.meta.dir, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

class ReleaseGateAbort extends Error {
  constructor(readonly failures: ReleaseGateFailure[]) {
    super("public release gate failed");
  }
}

try {
  main();
} catch (error) {
  console.error("Public release gate failed:");
  if (error instanceof ReleaseGateAbort) {
    for (const failure of error.failures) console.error(`- ${failure.check}: ${failure.message}`);
  } else {
    console.error(error instanceof Error ? `- release-runtime: ${error.message}` : `- release-runtime: ${String(error)}`);
  }
  process.exitCode = 1;
}

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
  const buildIdentity: ReleaseBuildIdentity = {
    bunVersion: process.versions.bun ?? "unknown",
    lockfileSha256: createHash("sha256").update(readFileSync(join(root, "bun.lock"))).digest("hex"),
    mode: authority.mode!,
    authoritative: authority.authoritative,
    skippedChecks: authority.skipped,
  };

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
  if (failures.length > 0) failReleaseGate(failures);

  const tempDir = mkdtempSync(join(tmpdir(), "todos-release-"));
  let tarballIntegrity = "";
  try {
    const firstSourceRoot = prepareIsolatedReleaseSource(
      tempDir,
      "first",
      packageJson,
      sourceIdentity,
      provenanceTimestamp,
      buildIdentity,
    );
    const firstPackDir = join(tempDir, "first");
    const secondPackDir = join(tempDir, "second");
    const finalPackDir = join(tempDir, "final");
    mkdirSync(firstPackDir, { recursive: true });
    mkdirSync(secondPackDir, { recursive: true });
    mkdirSync(finalPackDir, { recursive: true });
    const firstPack = npmPack(firstPackDir, firstSourceRoot);
    const firstTarball = join(firstPackDir, firstPack.filename);
    const firstPayloadDir = join(tempDir, "first-payload");
    const firstManifest = createPackedPayloadManifest(firstPack, firstTarball, firstPayloadDir);
    const firstIntegrity = `sha512-${createHash("sha512").update(readFileSync(firstTarball)).digest("base64")}`;
    failures.push(...validateReleaseArtifactIntegrity(firstPack.integrity, firstIntegrity));
    const packedPackageJson = readPackedPackageJson(firstTarball);
    failures.push(...validatePackedPackageFiles(firstPack.files.map((file) => `package/${file.path}`), packedPackageJson));
    failures.push(...validatePackedProvenanceMetadata(packedPackageJson, packageJson));
    failures.push(...validatePackedReleaseProvenance(
      firstTarball,
      firstPayloadDir,
      packageJson,
      sourceIdentity,
      buildIdentity,
    ));
    failures.push(...scanExtractedPackedFiles(firstPack.files, firstPayloadDir, sourceLogo));

    const secondSourceRoot = prepareIsolatedReleaseSource(
      tempDir,
      "second",
      packageJson,
      sourceIdentity,
      provenanceTimestamp,
      buildIdentity,
    );
    const secondPack = npmPack(secondPackDir, secondSourceRoot);
    const secondTarball = join(secondPackDir, secondPack.filename);
    const secondPayloadDir = join(tempDir, "second-payload");
    const secondManifest = createPackedPayloadManifest(secondPack, secondTarball, secondPayloadDir);
    const secondIntegrity = `sha512-${createHash("sha512").update(readFileSync(secondTarball)).digest("base64")}`;
    failures.push(...validateReleaseArtifactIntegrity(secondPack.integrity, secondIntegrity));
    failures.push(...validateReproducibleArtifactIntegrity(firstIntegrity, secondIntegrity, firstManifest, secondManifest));
    const secondPackedPackageJson = readPackedPackageJson(secondTarball);
    failures.push(...validatePackedPackageFiles(secondPack.files.map((file) => `package/${file.path}`), secondPackedPackageJson));
    failures.push(...validatePackedProvenanceMetadata(secondPackedPackageJson, packageJson));
    failures.push(...validatePackedReleaseProvenance(
      secondTarball,
      secondPayloadDir,
      packageJson,
      sourceIdentity,
      buildIdentity,
    ));
    failures.push(...scanExtractedPackedFiles(secondPack.files, secondPayloadDir, sourceLogo));

    if (failures.length > 0) failReleaseGate(failures);
    if (!args.has("--skip-install-smoke")) {
      installSmoke(firstTarball, packageJson);
    }

    withVerifiedArtifactPromotion(root, firstSourceRoot, ["dist", "dashboard/dist"], () => {
      const finalPack = npmPack(finalPackDir, root);
      const finalTarball = join(finalPackDir, finalPack.filename);
      const finalPayloadDir = join(tempDir, "final-payload");
      const finalManifest = createPackedPayloadManifest(finalPack, finalTarball, finalPayloadDir);
      tarballIntegrity = `sha512-${createHash("sha512").update(readFileSync(finalTarball)).digest("base64")}`;
      failures.push(...validateReleaseArtifactIntegrity(finalPack.integrity, tarballIntegrity));
      failures.push(...validateReproducibleArtifactIntegrity(firstIntegrity, tarballIntegrity, firstManifest, finalManifest));
      const finalPackedPackageJson = readPackedPackageJson(finalTarball);
      failures.push(...validatePackedPackageFiles(finalPack.files.map((file) => `package/${file.path}`), finalPackedPackageJson));
      failures.push(...validatePackedProvenanceMetadata(finalPackedPackageJson, packageJson));
      failures.push(...validatePackedReleaseProvenance(
        finalTarball,
        finalPayloadDir,
        packageJson,
        sourceIdentity,
        buildIdentity,
      ));
      failures.push(...scanExtractedPackedFiles(finalPack.files, finalPayloadDir, sourceLogo));

      const postPackState = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (postPackState.status !== 0) {
        failures.push({ check: "release-worktree-state", message: postPackState.stderr || "git status after pack failed" });
      } else {
        failures.push(...validateReleaseRepositoryState(postPackState.stdout));
      }
      if (failures.length > 0) failReleaseGate(failures);
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    package: `${packageJson.name}@${packageJson.version}`,
    git_commit: sourceIdentity.gitCommit,
    git_tree: sourceIdentity.gitTree,
    source_tree_sha256: sourceIdentity.sourceTreeSha256,
    tarball_integrity: tarballIntegrity,
    bun_version: buildIdentity.bunVersion,
    bun_lock_sha256: buildIdentity.lockfileSha256,
    dependency_install: RELEASE_DEPENDENCY_INSTALL_COMMAND,
    isolated_source_build: true,
    gate_mode: buildIdentity.mode,
    authoritative: authority.authoritative,
    skipped_checks: authority.skipped,
  }));
  console.log(authority.authoritative
    ? "Public release gate passed (AUTHORITATIVE)."
    : "Public release verification completed (NON-AUTHORITATIVE)."
  );
}

function writeReleaseProvenance(
  buildRoot: string,
  packageJson: PackageJson,
  sourceIdentity: ReleaseSourceIdentity,
  generatedAt: string,
  buildIdentity: ReleaseBuildIdentity,
): void {
  const artifacts = createReleaseArtifactManifest(buildRoot);
  writeFileSync(
    join(buildRoot, "dist", "release-provenance.json"),
    `${JSON.stringify({
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      repository: packageJson.repository?.url,
      gitCommit: sourceIdentity.gitCommit,
      gitTree: sourceIdentity.gitTree,
      sourceTreeSha256: sourceIdentity.sourceTreeSha256,
      generatedAt,
      toolchain: {
        bunVersion: buildIdentity.bunVersion,
      },
      dependencies: {
        lockfile: "bun.lock",
        lockfileSha256: buildIdentity.lockfileSha256,
        installCommand: RELEASE_DEPENDENCY_INSTALL_COMMAND,
        isolatedSource: true,
      },
      gate: {
        mode: buildIdentity.mode,
        authoritative: buildIdentity.authoritative,
        skippedChecks: buildIdentity.skippedChecks,
      },
      artifacts,
    }, null, 2)}\n`,
  );
}

function prepareIsolatedReleaseSource(
  tempDir: string,
  label: string,
  packageJson: PackageJson,
  sourceIdentity: ReleaseSourceIdentity,
  generatedAt: string,
  buildIdentity: ReleaseBuildIdentity,
): string {
  const sourceRoot = join(tempDir, `${label}-source`);
  const archive = join(tempDir, `${label}-source.tar`);
  mkdirSync(sourceRoot, { recursive: true });
  runOrExitAt("git", ["archive", "--format=tar", "--output", archive, "HEAD"], root);
  runOrExitAt("tar", ["-xf", archive, "-C", sourceRoot], root);
  if (existsSync(join(sourceRoot, "node_modules"))) {
    failReleaseGate([{ check: "release-install-isolation", message: "isolated source archive unexpectedly contains node_modules" }]);
  }

  const installArgs = getIsolatedReleaseInstallArgs();
  const installFailures = validateIsolatedReleaseInstall(process.execPath, installArgs, sourceRoot, root);
  if (installFailures.length > 0) failReleaseGate(installFailures);
  const archivedLockDigest = createHash("sha256").update(readFileSync(join(sourceRoot, "bun.lock"))).digest("hex");
  if (archivedLockDigest !== buildIdentity.lockfileSha256) {
    failReleaseGate([{ check: "release-lockfile-source", message: "isolated source bun.lock differs from the clean release commit" }]);
  }
  const isolatedEnv = createIsolatedEnvironment(join(tempDir, `${label}-home`));
  runOrExitAt(process.execPath, installArgs, sourceRoot, isolatedEnv);
  if (!existsSync(join(sourceRoot, "node_modules"))) {
    failReleaseGate([{ check: "release-install-output", message: "isolated frozen dependency install did not create node_modules" }]);
  }
  runOrExitAt(process.execPath, ["run", "build"], sourceRoot, isolatedEnv);
  runOrExitAt(process.execPath, ["--no-install", "scripts/verify-dist-server-runtime.ts"], sourceRoot, isolatedEnv);
  const postBuildLockDigest = createHash("sha256").update(readFileSync(join(sourceRoot, "bun.lock"))).digest("hex");
  if (postBuildLockDigest !== buildIdentity.lockfileSha256) {
    failReleaseGate([{ check: "release-lockfile-drift", message: "isolated install or build changed bun.lock" }]);
  }
  writeReleaseProvenance(sourceRoot, packageJson, sourceIdentity, generatedAt, buildIdentity);
  return sourceRoot;
}

function createIsolatedEnvironment(home: string): NodeJS.ProcessEnv {
  mkdirSync(home, { recursive: true });
  return {
    PATH: process.env.PATH,
    HOME: home,
    BUN_INSTALL: join(home, ".bun"),
    XDG_CACHE_HOME: join(home, ".cache"),
    NODE_ENV: "production",
    CI: "1",
    SOURCE_DATE_EPOCH: process.env["SOURCE_DATE_EPOCH"],
  };
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
  throw new ReleaseGateAbort(failures);
}

function npmPack(destination: string, cwd: string): PackResult {
  const result = runCaptureAt("npm", getNpmPackArgs(destination), cwd);
  if (result.status !== 0) {
    failReleaseGate([{
      check: "npm-pack",
      message: result.stderr || result.stdout || `npm pack failed with status ${result.status}`,
    }]);
  }

  const parsed = JSON.parse(result.stdout) as PackResult[];
  const pack = parsed[0];
  if (!pack?.filename || !Array.isArray(pack.files)) {
    failReleaseGate([{ check: "npm-pack-metadata", message: "npm pack did not return package file metadata" }]);
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

function installSmoke(tarball: string, packageJson: PackageJson): void {
  const installRoot = mkdtempSync(join(tmpdir(), "todos-install-smoke-"));
  try {
    writeFileSync(join(installRoot, "package.json"), `${JSON.stringify({ private: true })}\n`);
    const commands = getInstallSmokeCommands(tarball, "19600", installRoot, packageJson);
    const failures = validateInstallSmokeCommands(commands, packageJson);
    if (failures.length > 0) {
      failReleaseGate(failures);
    }
    const isolatedEnv = createIsolatedEnvironment(installRoot);
    for (const step of commands) {
      const command = step.command === "bun" ? process.execPath : step.command;
      const result = runAt(command, step.args, installRoot, isolatedEnv);
      if (step.required !== false && result.status !== 0) {
        failReleaseGate([{
          check: "install-smoke-command",
          message: `${command} ${step.args.join(" ")} failed with status ${result.status ?? "signal"}`,
        }]);
      }
    }
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
}

function readPackedPackageJson(tarball: string): PackageJson {
  return readPackedJson<PackageJson>(tarball, "package/package.json");
}

function readPackedReleaseProvenance(tarball: string): ReleaseProvenance {
  return readPackedJson(tarball, "package/dist/release-provenance.json");
}

function validatePackedReleaseProvenance(
  tarball: string,
  payloadRoot: string,
  packageJson: PackageJson,
  sourceIdentity: ReleaseSourceIdentity,
  buildIdentity: ReleaseBuildIdentity,
): ReleaseGateFailure[] {
  const provenance = readPackedReleaseProvenance(tarball);
  return [
    ...validateReleaseProvenanceMetadata(provenance, packageJson, sourceIdentity, buildIdentity),
    ...validateReleaseArtifactManifest(join(payloadRoot, "package"), provenance.artifacts),
  ];
}

function readPackedJson<T>(tarball: string, path: string): T {
  const result = runCapture("tar", ["-xOf", tarball, path]);
  if (result.status !== 0) {
    failReleaseGate([{
      check: "packed-json",
      message: result.stderr || `could not read ${path} from packed tarball`,
    }]);
  }
  return JSON.parse(result.stdout) as T;
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

function runOrExitAt(command: string, commandArgs: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = runAt(command, commandArgs, cwd, env);
  if (result.status !== 0) {
    failReleaseGate([{
      check: "release-command",
      message: `${command} ${commandArgs.join(" ")} failed with status ${result.status ?? "signal"}`,
    }]);
  }
}

function runAt(
  command: string,
  commandArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  return spawnSync(command, commandArgs, { cwd, stdio: "inherit", env });
}

function runCapture(command: string, commandArgs: string[], env: NodeJS.ProcessEnv = process.env): { status: number; stdout: string; stderr: string } {
  return runCaptureAt(command, commandArgs, root, env);
}

function runCaptureAt(
  command: string,
  commandArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, commandArgs, {
    cwd,
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
