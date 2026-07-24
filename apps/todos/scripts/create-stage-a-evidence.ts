#!/usr/bin/env bun
/** Create a self-contained, provenance-bound, network-isolated Stage A evidence package. */
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import {
  DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES,
  resolveTrustedExecutable,
  runPinnedCommand,
  type ExecutableIdentity,
  type PinnedCommandResult,
} from "./stage-a-process.js";
import {
  ARTIFACT_REPLAY_POLICY,
  CANONICAL_BASE_ENVIRONMENT,
  NETWORK_PROBE_POLICY,
  SOURCE_REPLAY_POLICY,
  assertArchiveExtractionClosed,
  assertCommandRecordMatchesPolicy,
  type CanonicalCommandPolicy,
} from "./stage-a-verifier-policy.js";
import {
  STAGE_A_CANDIDATE_IDENTITY_VERSION,
  canonicalCandidateFromGitInputs,
  canonicalSortedPathBytes,
  decodeCanonicalCandidateInput,
  readCanonicalUntrackedIdentity,
  type CanonicalCandidate,
} from "./stage-a-candidate-identity.js";
import {
  scanTextForSecrets,
  secretScanByteProjections,
} from "../src/lib/secret-redaction.js";

const BASE_REF = "31988ba7a1ca3d42f50cb2fab894a3581f8e568f";
const SCHEMA_VERSION = 4;
const MAX_INVENTORY_ENTRIES = 200_000;
const MAX_TREE_REGULAR_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TREE_DEPTH = 256;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const HOST_COMMAND_DEADLINE_MS = 120_000;
const SANDBOX_COMMAND_DEADLINE_MS = 300_000;
const repository = resolve(import.meta.dir, "..");
const repositoryDescriptor = openSync(repository, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
let outputDescriptor: number | undefined;
let evidenceRoot: string | undefined;

interface InventoryEntry {
  path: string;
  type: "directory" | "file" | "symlink";
  mode: string;
  size: number;
  sha256: string;
  target?: string;
}

interface FileIdentity {
  path: string;
  mode: string;
  size: number;
  sha256: string;
}

interface ToolIdentity extends FileIdentity {
  role: string;
  version?: string;
}

interface CommandEvidence {
  index: number;
  label: string;
  argv: string[];
  launch_argv: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: "ignore";
  deadline_ms: number;
  output_limit_bytes: number;
  termination: "exit";
  timed_out: false;
  output_limited: false;
  expected_exit: number;
  exit_code: number;
  stdout: FileIdentity;
  stderr: FileIdentity;
  authority_floor_occurrences: number;
  expected_authority_floor_occurrences: number;
  tripwire_absent: boolean;
  network_isolated: true;
  toolchain_inventory_sha256: string;
  tools: FileIdentity[];
  preloads: FileIdentity[];
  inputs: FileIdentity[];
  replayable: boolean;
  replay_omission?: string;
  output_comparison: {
    mode: "exact-bytes" | "normalized-text-v1";
    rules: Array<"duration-tokens" | "namespace-inode">;
  };
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const expectedDigest = argument("--expected-digest");
const outputArgument = argument("--output");
const dependencySourceArgument = argument("--dependency-source");
if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error("--expected-digest must be a lowercase SHA-256");
if (!isAbsolute(outputArgument)) throw new Error("--output must be absolute");
if (!isAbsolute(dependencySourceArgument)) throw new Error("--dependency-source must be absolute");
const output = resolve(outputArgument);
const dependencySource = resolve(dependencySourceArgument);
const dependencySourceDescriptor = openSync(
  dependencySource,
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
);
const outputParent = dirname(output);
const outputLeaf = output.slice(outputParent.length + 1);
if (!outputLeaf || outputLeaf.includes(sep)) throw new Error("--output must name one new evidence-root child");
const outputParentDescriptor = openSync(
  outputParent,
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
);
const outputFromRepository = relative(repository, output);
if (outputFromRepository === "" || (!outputFromRepository.startsWith(`..${sep}`) && outputFromRepository !== "..")) {
  throw new Error("--output must be outside the repository");
}
if (existsSync(output)) throw new Error("--output must not already exist");

function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeAnchoredPath(path: string): string[] {
  if (!path || isAbsolute(path) || path.includes("\0") || path.includes("\\")) throw new Error(`unsafe anchored path: ${path}`);
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`unsafe anchored path: ${path}`);
  return parts;
}

function openAnchoredRegular(rootDescriptor: number, path: string): number {
  const parts = safeAnchoredPath(path);
  let directoryDescriptor = rootDescriptor;
  try {
    for (const part of parts.slice(0, -1)) {
      const next = openSync(
        `/proc/self/fd/${directoryDescriptor}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      if (directoryDescriptor !== rootDescriptor) closeSync(directoryDescriptor);
      directoryDescriptor = next;
    }
    return openSync(
      `/proc/self/fd/${directoryDescriptor}/${parts.at(-1)!}`,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } finally {
    if (directoryDescriptor !== rootDescriptor) closeSync(directoryDescriptor);
  }
}

function openAnchoredRegularFollowingInternalLinks(rootDescriptor: number, path: string): number {
  const canonicalPath = safeAnchoredPath(path).join("/");
  const descriptorRoot = `/proc/self/fd/${rootDescriptor}`;
  const resolvedRoot = realpathSync(descriptorRoot);
  const requestedPath = `${descriptorRoot}/${canonicalPath}`;
  const resolvedPath = realpathSync(requestedPath);
  const fromRoot = relative(resolvedRoot, resolvedPath);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`anchored symlink resolution escapes its private root: ${path}`);
  }
  const descriptor = openSync(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (realpathSync(requestedPath) !== resolvedPath || realpathSync(`/proc/self/fd/${descriptor}`) !== resolvedPath) {
      throw new Error(`anchored symlink resolution changed before binding: ${path}`);
    }
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function openAnchoredDirectory(rootDescriptor: number, path: string): number {
  const parts = safeAnchoredPath(path);
  let directoryDescriptor = rootDescriptor;
  try {
    for (const part of parts) {
      const next = openSync(
        `/proc/self/fd/${directoryDescriptor}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      if (directoryDescriptor !== rootDescriptor) closeSync(directoryDescriptor);
      directoryDescriptor = next;
    }
    return directoryDescriptor;
  } catch (error) {
    if (directoryDescriptor !== rootDescriptor) closeSync(directoryDescriptor);
    throw error;
  }
}

function readAnchoredRegular(rootDescriptor: number, path: string, maxBytes = 512 * 1024 * 1024): Buffer {
  const descriptor = openAnchoredRegular(rootDescriptor, path);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > maxBytes) throw new Error(`anchored input is not a bounded regular file: ${path}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.byteLength !== after.size) {
      throw new Error(`anchored input changed while read: ${path}`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function readAnchoredSource(path: string, maxBytes = 512 * 1024 * 1024): { bytes: Buffer; mode: number; size: number } {
  const descriptor = openAnchoredRegular(repositoryDescriptor, path);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > maxBytes) throw new Error(`candidate input is not a bounded regular file: ${path}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.byteLength !== after.size) {
      throw new Error(`candidate input changed while read: ${path}`);
    }
    return { bytes, mode: before.mode, size: before.size };
  } finally {
    closeSync(descriptor);
  }
}

function anchoredDirectoryMode(path: string): number {
  const descriptor = openAnchoredDirectory(repositoryDescriptor, path);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isDirectory()) throw new Error(`candidate parent is not a directory: ${path}`);
    return stat.mode;
  } finally {
    closeSync(descriptor);
  }
}

function sha256File(path: string): string {
  if (outputDescriptor !== undefined) {
    try {
      return sha256Bytes(readAnchoredRegular(outputDescriptor, relativeEvidencePath(path)));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("path is outside evidence root:")) throw error;
    }
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > 512 * 1024 * 1024) throw new Error(`file is not a bounded regular file: ${path}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) throw new Error(`file changed while read: ${path}`);
    return sha256Bytes(bytes);
  } finally {
    closeSync(descriptor);
  }
}

function byteSort(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function modeString(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function relativeEvidencePath(path: string): string {
  if (evidenceRoot !== undefined) {
    const descriptorPrefix = `${evidenceRoot}/`;
    if (path.startsWith(descriptorPrefix)) {
      const anchoredResult = path.slice(descriptorPrefix.length);
      if (!anchoredResult || anchoredResult.startsWith("../") || isAbsolute(anchoredResult)) {
        throw new Error(`path is outside evidence root: ${path}`);
      }
      return anchoredResult.split(sep).join("/");
    }
  }
  const result = relative(output, path);
  if (!result || result.startsWith("..") || isAbsolute(result)) throw new Error(`path is outside evidence root: ${path}`);
  return result.split(sep).join("/");
}

function fileIdentity(path: string): FileIdentity {
  if (outputDescriptor === undefined) throw new Error("evidence root descriptor is not initialized");
  const relativePath = relativeEvidencePath(path);
  const descriptor = openAnchoredRegularFollowingInternalLinks(outputDescriptor, relativePath);
  let stat: ReturnType<typeof fstatSync>;
  let bytes: Buffer;
  try {
    stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error(`expected bounded regular file: ${path}`);
    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size || bytes.byteLength !== after.size) {
      throw new Error(`evidence file changed while read: ${relativePath}`);
    }
  } finally {
    closeSync(descriptor);
  }
  return {
    path: relativePath,
    mode: modeString(stat.mode),
    size: stat.size,
    sha256: sha256Bytes(bytes),
  };
}

function openEvidenceFileMatchingIdentity(identity: FileIdentity, label: string): number {
  if (outputDescriptor === undefined) throw new Error("evidence root descriptor is not initialized");
  const descriptor = openAnchoredRegular(outputDescriptor, identity.path);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > 512 * 1024 * 1024) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || bytes.byteLength !== after.size
      || modeString(before.mode) !== identity.mode
      || before.size !== identity.size
      || sha256Bytes(bytes) !== identity.sha256
    ) {
      throw new Error(`${label} changed before descriptor binding`);
    }
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function inventoryTree(root: string, exclude: (path: string) => boolean = () => false): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  let totalRegularBytes = 0;
  const visit = (directoryDescriptor: number, prefix: string, depth: number): void => {
    if (depth > MAX_TREE_DEPTH) throw new Error("filesystem inventory depth bound exceeded");
    const directoryPath = `/proc/self/fd/${directoryDescriptor}`;
    for (const name of readdirSync(directoryPath).sort(byteSort)) {
      if (name === "." || name === ".." || name.includes("/") || name.includes("\0")) throw new Error("invalid directory entry name");
      const absolute = `${directoryPath}/${name}`;
      const path = prefix ? `${prefix}/${name}` : name;
      if (exclude(path)) continue;
      const before = lstatSync(absolute);
      if (before.isDirectory()) {
        const childDescriptor = openSync(absolute, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          const stat = fstatSync(childDescriptor);
          if (stat.dev !== before.dev || stat.ino !== before.ino) throw new Error(`directory changed during inventory: ${path}`);
          entries.push({ path, type: "directory", mode: modeString(stat.mode), size: 0, sha256: sha256Bytes("") });
          if (entries.length > MAX_INVENTORY_ENTRIES) throw new Error("filesystem inventory entry bound exceeded");
          visit(childDescriptor, path, depth + 1);
        } finally {
          closeSync(childDescriptor);
        }
      } else if (before.isFile()) {
        const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = fstatSync(descriptor);
          if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error(`file changed during inventory: ${path}`);
          totalRegularBytes += stat.size;
          if (stat.size > 512 * 1024 * 1024 || totalRegularBytes > MAX_TREE_REGULAR_BYTES) throw new Error("filesystem inventory byte bound exceeded");
          const bytes = readFileSync(descriptor);
          const after = fstatSync(descriptor);
          if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || bytes.byteLength !== stat.size) throw new Error(`file changed while inventoried: ${path}`);
          entries.push({ path, type: "file", mode: modeString(stat.mode), size: stat.size, sha256: sha256Bytes(bytes) });
          if (entries.length > MAX_INVENTORY_ENTRIES) throw new Error("filesystem inventory entry bound exceeded");
        } finally {
          closeSync(descriptor);
        }
      } else if (before.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        const after = lstatSync(absolute);
        if (!after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino) throw new Error(`symlink changed during inventory: ${path}`);
        entries.push({
          path,
          type: "symlink",
          mode: modeString(before.mode),
          size: Buffer.byteLength(target),
          sha256: sha256Bytes(target),
          target,
        });
        if (entries.length > MAX_INVENTORY_ENTRIES) throw new Error("filesystem inventory entry bound exceeded");
      } else {
        throw new Error(`unsupported filesystem entry in inventory: ${absolute}`);
      }
    }
  };
  const descriptorPrefixes = [`/proc/${process.pid}/fd/`, "/proc/self/fd/"];
  const descriptorPrefix = descriptorPrefixes.find((prefix) => root.startsWith(prefix));
  const descriptorSuffix = descriptorPrefix ? root.slice(descriptorPrefix.length) : "";
  const borrowedRootDescriptor = /^[0-9]+$/.test(descriptorSuffix)
    ? Number.parseInt(descriptorSuffix, 10)
    : undefined;
  const rootDescriptor = borrowedRootDescriptor ?? openSync(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const rootBefore = fstatSync(rootDescriptor);
  if (!rootBefore.isDirectory()) throw new Error("inventory root is not a directory");
  try {
    visit(rootDescriptor, "", 0);
  } finally {
    const rootAfter = fstatSync(rootDescriptor);
    if (rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino || !rootAfter.isDirectory()) {
      throw new Error("inventory root descriptor changed");
    }
    if (borrowedRootDescriptor === undefined) closeSync(rootDescriptor);
  }
  return entries.sort((left, right) => byteSort(left.path, right.path));
}

function assertNoHardlinks(rootDescriptor: number, inventory: readonly InventoryEntry[], label: string): void {
  for (const entry of inventory) {
    if (entry.type !== "file") continue;
    const descriptor = openAnchoredRegular(rootDescriptor, entry.path);
    try {
      if (fstatSync(descriptor).nlink !== 1) throw new Error(`${label} contains a hardlinked regular file: ${entry.path}`);
    } finally {
      closeSync(descriptor);
    }
  }
}

function writeJson(path: string, value: unknown): FileIdentity {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return fileIdentity(path);
}

const hostToolNamesForExecution = [
  "awk", "bash", "bwrap", "git", "gitleaks", "gzip", "ldd", "rm", "sha256sum", "sh", "sort", "tar",
] as const;
const hostExecutables: Record<string, ExecutableIdentity> = Object.fromEntries(hostToolNamesForExecution.map((name) => [
  name,
  resolveTrustedExecutable(name),
])) as Record<string, ExecutableIdentity>;
hostExecutables.bun = resolveTrustedExecutable("bun");
const hostChildExecutables = Object.fromEntries([
  "awk", "git", "gzip", "rm", "sha256sum", "sh", "sort",
].map((name) => [name, hostExecutables[name]!])) as Record<string, ExecutableIdentity>;

function resolveExecutable(name: string): string {
  const executable = hostExecutables[name as keyof typeof hostExecutables] ?? resolveTrustedExecutable(name);
  return executable.path;
}

async function runHost(
  argv: string[],
  cwd = repository,
  env: Record<string, string> = {},
  expectedExits: readonly number[] = [0],
): Promise<PinnedCommandResult> {
  const command = argv[0];
  if (!command) throw new Error("host command argv is empty");
  const executable = isAbsolute(command)
    ? Object.values(hostExecutables).find((candidate) => candidate.path === realpathSync(command))
    : hostExecutables[command as keyof typeof hostExecutables] ?? resolveTrustedExecutable(command);
  if (!executable) throw new Error(`absolute host executable was not identity-pinned at startup: ${command}`);
  const result = await runPinnedCommand({
    executable,
    args: argv.slice(1),
    cwd,
    env: { LANG: "C.UTF-8", LC_ALL: "C", ...env },
    stdin: "ignore",
    deadlineMs: HOST_COMMAND_DEADLINE_MS,
    outputLimitBytes: MAX_COMMAND_OUTPUT_BYTES,
    pathBindings: hostChildExecutables,
  });
  if (!expectedExits.includes(result.exitCode)) {
    throw new Error(`${argv.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().slice(0, 2_000)}`);
  }
  return result;
}

async function assertPreflight(): Promise<void> {
  const head = (await runHost(["git", "rev-parse", "HEAD"])).stdout.toString().trim();
  if (head !== BASE_REF) throw new Error(`HEAD mismatch: expected ${BASE_REF}, received ${head}`);
  const staged = await runHost(["git", "diff", "--cached", "--quiet", "--exit-code"], repository, {}, [0, 1]);
  if (staged.exitCode !== 0) throw new Error("staged file count must be zero");
}

async function canonicalCandidate(): Promise<CanonicalCandidate> {
  const [trackedDiff, rawUntrackedPaths, rawTrackedPaths, rawIgnoredPaths] = await Promise.all([
    runHost(["git", "diff", "--binary", "--full-index", "--no-ext-diff", BASE_REF, "--"]),
    runHost(["git", "ls-files", "--others", "--exclude-standard", "-z"]),
    runHost(["git", "ls-files", "-z"]),
    runHost(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]),
  ]);
  return canonicalCandidateFromGitInputs(
    repositoryDescriptor,
    trackedDiff.stdout,
    rawUntrackedPaths.stdout,
    rawTrackedPaths.stdout,
    rawIgnoredPaths.stdout,
  );
}

async function candidateDigest(): Promise<string> {
  return (await canonicalCandidate()).digest;
}

await assertPreflight();
const sourceCandidateBefore = await canonicalCandidate();
const sourceDigestBefore = sourceCandidateBefore.digest;
if (sourceDigestBefore !== expectedDigest) {
  throw new Error(`canonical source digest mismatch: expected ${expectedDigest}, received ${sourceDigestBefore}`);
}

mkdirSync(`/proc/self/fd/${outputParentDescriptor}/${outputLeaf}`, { recursive: false, mode: 0o775 });
outputDescriptor = openSync(
  `/proc/self/fd/${outputParentDescriptor}/${outputLeaf}`,
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
);
evidenceRoot = `/proc/${process.pid}/fd/${outputDescriptor}`;
closeSync(outputParentDescriptor);
function assertOutputBinding(): void {
  const lexicalDescriptor = openSync(output, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const anchored = fstatSync(outputDescriptor!);
    const lexical = fstatSync(lexicalDescriptor);
    if (!anchored.isDirectory() || anchored.dev !== lexical.dev || anchored.ino !== lexical.ino) {
      throw new Error("lexical evidence root no longer names the descriptor-anchored directory");
    }
  } finally {
    closeSync(lexicalDescriptor);
  }
}
assertOutputBinding();
let evidenceComplete = false;
process.once("exit", () => {
  if (evidenceComplete || outputDescriptor === undefined) return;
  try {
    assertOutputBinding();
    rmSync(output, { recursive: true, force: true });
  } catch {
    // A rebound lexical path is never followed during cleanup.
  }
});
const workspace = join(evidenceRoot, "workspace");
const artifactRoot = join(evidenceRoot, "artifact");
const runtimeHome = join(evidenceRoot, "runtime-home");
const provenanceRoot = join(evidenceRoot, "provenance");
const dependenciesRoot = join(evidenceRoot, "dependencies");
const toolsRoot = join(evidenceRoot, "tools");
const sandboxRootfs = join(toolsRoot, "sandbox-root");
const executionsRoot = join(evidenceRoot, "executions");
for (const path of [workspace, artifactRoot, runtimeHome, provenanceRoot, dependenciesRoot, toolsRoot, sandboxRootfs, executionsRoot]) {
  mkdirSync(path, { recursive: true });
}
async function trackedAndUntrackedPaths(): Promise<string[]> {
  const raw = (await runHost(["git", "ls-files", "-co", "--exclude-standard", "-z"])).stdout;
  return raw.toString().split("\0").filter(Boolean).sort(byteSort);
}

async function copyCandidateSource(): Promise<void> {
  const directories = new Set<string>();
  for (const sourcePath of await trackedAndUntrackedPaths()) {
    const source = readAnchoredSource(sourcePath);
    let parent = dirname(sourcePath);
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
    const to = join(workspace, sourcePath);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, source.bytes);
    chmodSync(to, source.mode & 0o777);
  }
  for (const directory of [...directories].sort((left, right) => left.split("/").length - right.split("/").length || byteSort(left, right))) {
    chmodSync(join(workspace, directory), anchoredDirectoryMode(directory) & 0o777);
  }
}

await copyCandidateSource();
const sourceInventoryExclude = (path: string): boolean => path === "dist" || path.startsWith("dist/")
  || path === "node_modules" || path.startsWith("node_modules/")
  || path === "dashboard/node_modules" || path.startsWith("dashboard/node_modules/");
const sourceInventoryBefore = inventoryTree(workspace, sourceInventoryExclude);
const sourceInventoryBeforeFile = writeJson(join(provenanceRoot, "copied-source-before.json"), sourceInventoryBefore);

const baseCommitBytes = Buffer.from((await runHost(["git", "cat-file", "commit", BASE_REF])).stdout);
const baseCommitPath = join(provenanceRoot, "base-commit.txt");
writeFileSync(baseCommitPath, baseCommitBytes);
const baseCommitIdentity = fileIdentity(baseCommitPath);
const commitObjectHash = createHash("sha1")
  .update(`commit ${baseCommitBytes.byteLength}\0`)
  .update(baseCommitBytes)
  .digest("hex");
if (commitObjectHash !== BASE_REF) throw new Error("base commit bytes do not hash to BASE_REF");
const treeMatch = baseCommitBytes.toString().match(/^tree ([0-9a-f]{40})$/m);
if (!treeMatch) throw new Error("base commit does not declare a tree");
const baseTree = treeMatch[1]!;
const resolvedBaseTree = (await runHost(["git", "rev-parse", `${BASE_REF}^{tree}`])).stdout.toString().trim();
if (resolvedBaseTree !== baseTree) throw new Error("base tree identity mismatch");

const baseArchivePath = join(provenanceRoot, "base-tree.tar");
await runHost(["git", "archive", "--format=tar", `--output=${baseArchivePath}`, BASE_REF]);
const baseArchiveIdentity = fileIdentity(baseArchivePath);

const binaryDiffPath = join(provenanceRoot, "candidate.diff");
const binaryDiffBytes = sourceCandidateBefore.trackedDiff;
writeFileSync(binaryDiffPath, binaryDiffBytes);
const binaryDiffIdentity = fileIdentity(binaryDiffPath);

const sortedUntrackedPathBytes = canonicalSortedPathBytes(sourceCandidateBefore.sortedUntrackedPaths);
const sortedUntrackedPathsFile = join(provenanceRoot, "untracked-paths-v5.nul");
writeFileSync(sortedUntrackedPathsFile, sortedUntrackedPathBytes);
const sortedUntrackedPathsIdentity = fileIdentity(sortedUntrackedPathsFile);
const untrackedPaths = sourceCandidateBefore.sortedUntrackedPaths;
const untrackedRoot = join(provenanceRoot, "untracked-files");
mkdirSync(untrackedRoot, { recursive: true });
const untrackedInventory: Array<{
  path: string;
  evidence_path: string;
  type: "regular-file";
  mode: string;
  size: number;
  sha256: string;
}> = [];
for (const expectedIdentity of sourceCandidateBefore.untracked) {
  const path = expectedIdentity.path;
  const source = readCanonicalUntrackedIdentity(repositoryDescriptor, path);
  if (JSON.stringify(source.identity) !== JSON.stringify(expectedIdentity)) {
    throw new Error(`candidate untracked identity changed before evidence copy: ${path}`);
  }
  const destination = join(untrackedRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source.bytes);
  chmodSync(destination, Number.parseInt(source.identity.mode, 8));
  untrackedInventory.push({
    path,
    evidence_path: relativeEvidencePath(destination),
    type: "regular-file",
    mode: source.identity.mode,
    size: source.identity.size,
    sha256: source.identity.sha256,
  });
}
const untrackedInventoryFile = writeJson(join(provenanceRoot, "untracked-identities-v5.json"), untrackedInventory);

const digestInputBytes = sourceCandidateBefore.input;
const decodedCandidateInput = decodeCanonicalCandidateInput(digestInputBytes);
if (!decodedCandidateInput.trackedDiff.equals(binaryDiffBytes)) throw new Error("canonical candidate tracked diff mismatch");
const canonicalInputPath = join(provenanceRoot, "canonical-candidate-v5.bin");
writeFileSync(canonicalInputPath, digestInputBytes);
const canonicalInputIdentity = fileIdentity(canonicalInputPath);
if (canonicalInputIdentity.sha256 !== expectedDigest) throw new Error("preserved canonical digest input mismatch");
const untrackedRecordsPath = join(provenanceRoot, "untracked-records-v5.bin");
writeFileSync(untrackedRecordsPath, sourceCandidateBefore.untrackedRecords);
const untrackedRecordsIdentity = fileIdentity(untrackedRecordsPath);

function sourceInventoryJson(root: string): InventoryEntry[] {
  return inventoryTree(root);
}

const reconstructionRoot = join(evidenceRoot, ".candidate-reconstruction");
mkdirSync(reconstructionRoot);
await runHost(["tar", "-xf", baseArchivePath, "-C", reconstructionRoot], evidenceRoot);
if (binaryDiffBytes.length > 0) await runHost(["git", "apply", "--binary", "--whitespace=nowarn", binaryDiffPath], reconstructionRoot);
for (const entry of untrackedInventory) {
  const destination = join(reconstructionRoot, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(evidenceRoot, entry.evidence_path), destination);
  chmodSync(destination, Number.parseInt(entry.mode, 8));
}
const reconstructedInventory = sourceInventoryJson(reconstructionRoot);
if (JSON.stringify(reconstructedInventory) !== JSON.stringify(sourceInventoryBefore)) {
  throw new Error("base archive + binary diff + untracked inputs do not reconstruct the copied candidate source");
}
const reconstructedInventoryFile = writeJson(join(provenanceRoot, "reconstructed-source.json"), reconstructedInventory);
rmSync(reconstructionRoot, { recursive: true, force: false });

const DEPENDENCY_SOURCE_SCRATCH_EXCLUSIONS = [
  "node_modules/.cache",
  "node_modules/.old_modules-*",
  "dashboard/node_modules/.vite-temp",
] as const;

function isDependencySourceScratch(path: string): boolean {
  return path === "node_modules/.cache" || path.startsWith("node_modules/.cache/")
    || /^node_modules\/\.old_modules-[^/]+(?:\/|$)/.test(path)
    || path === "dashboard/node_modules/.vite-temp"
    || path.startsWith("dashboard/node_modules/.vite-temp/");
}

function dependencyInventory(root: string, excludeSourceScratch = false): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  const dashboardNodeModules = join(root, "dashboard", "node_modules");
  if (existsSync(dashboardNodeModules)) {
    const dashboardStat = lstatSync(join(root, "dashboard"));
    if (!dashboardStat.isDirectory()) throw new Error("dashboard dependency parent is not a directory");
    entries.push({
      path: "dashboard",
      type: "directory",
      mode: modeString(dashboardStat.mode),
      size: 0,
      sha256: sha256Bytes(""),
    });
  }
  for (const prefix of ["node_modules", "dashboard/node_modules"]) {
    const absolute = join(root, prefix);
    if (!existsSync(absolute)) continue;
    const rootStat = lstatSync(absolute);
    entries.push({
      path: prefix,
      type: "directory",
      mode: modeString(rootStat.mode),
      size: 0,
      sha256: sha256Bytes(""),
    });
    for (const entry of inventoryTree(absolute, (path) => excludeSourceScratch && isDependencySourceScratch(`${prefix}/${path}`))) {
      entries.push({ ...entry, path: `${prefix}/${entry.path}` });
    }
  }
  return entries.sort((left, right) => byteSort(left.path, right.path));
}

let repositoryDependencyInventory!: InventoryEntry[];
let dependencyInventoryIdentity!: FileIdentity;
let dependencyArchiveIdentity!: FileIdentity;
const dependencyArchiveTar = join(dependenciesRoot, "node-modules.tar");
const dependencyArchivePath = `${dependencyArchiveTar}.gz`;
if (process.versions.bun !== "1.3.14") throw new Error("Stage A evidence requires Bun 1.3.14");

async function lddFiles(executable: string): Promise<string[]> {
  const outputText = (await runHost(["ldd", executable])).stdout.toString();
  const paths = new Set<string>();
  for (const line of outputText.split("\n")) {
    const arrow = line.match(/=>\s+(\/[^(\s]+)\s+\(/);
    const direct = line.match(/^\s*(\/[^(\s]+)\s+\(/);
    const path = arrow?.[1] ?? direct?.[1];
    if (path) paths.add(path);
    if (line.includes("not found")) throw new Error(`unresolved dynamic dependency: ${line.trim()}`);
  }
  return [...paths].sort(byteSort);
}

const executableSources = {
  bash: resolveExecutable("bash"),
  bun: resolveExecutable("bun"),
  bwrap: resolveExecutable("bwrap"),
  git: resolveExecutable("git"),
  sh: resolveExecutable("sh"),
  rm: resolveExecutable("rm"),
};
const runtimeFiles = new Set<string>();
for (const executable of Object.values(executableSources)) {
  for (const path of await lddFiles(executable)) runtimeFiles.add(path);
}
const loaderSource = [...runtimeFiles].find((path) => /\/ld-linux[^/]*\.so(?:\.\d+)*$/.test(path));
if (!loaderSource) throw new Error("could not identify the ELF runtime loader");
for (const directory of ["bin", "dev", "home", "lib", "mnt", "opt/bin", "proc", "srv", "tmp", "usr", "cache"]) {
  mkdirSync(join(sandboxRootfs, directory), { recursive: true });
}

function copyRootfsFile(source: string, absoluteDestination: string): FileIdentity {
  if (!absoluteDestination.startsWith("/")) throw new Error(`rootfs destination must be absolute: ${absoluteDestination}`);
  const destination = join(sandboxRootfs, absoluteDestination.slice(1));
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, statSync(source).mode & 0o777);
  return fileIdentity(destination);
}

const sandboxRuntimeIdentities: FileIdentity[] = [];
for (const source of [...runtimeFiles].sort(byteSort)) {
  sandboxRuntimeIdentities.push(copyRootfsFile(source, source));
}
const bunIdentity = copyRootfsFile(executableSources.bun, "/opt/bin/bun");
const gitIdentity = copyRootfsFile(executableSources.git, "/opt/bin/git");
const shellIdentity = copyRootfsFile(executableSources.sh, "/bin/sh");
const rmIdentity = copyRootfsFile(executableSources.rm, "/bin/rm");
const loaderIdentity = sandboxRuntimeIdentities.find((identity) => identity.path.endsWith(loaderSource));
if (!loaderIdentity) throw new Error("sandbox loader identity is missing");

const hostToolNames = ["bash", "bwrap", "git", "gitleaks", "gzip", "ldd", "sha256sum", "sort", "tar"];
const hostToolsRoot = join(toolsRoot, "host");
mkdirSync(hostToolsRoot);
const hostTools: ToolIdentity[] = [];
for (const name of hostToolNames) {
  const pinnedSource = hostExecutables[name]!;
  const sourcePath = pinnedSource.path;
  const destination = join(hostToolsRoot, name);
  copyFileSync(sourcePath, destination);
  chmodSync(destination, lstatSync(sourcePath).mode & 0o777);
  const stat = statSync(destination);
  const copiedSha256 = sha256File(destination);
  if (modeString(stat.mode) !== pinnedSource.mode || stat.size !== pinnedSource.size || copiedSha256 !== pinnedSource.sha256) {
    throw new Error(`host tool changed while copied: ${name}`);
  }
  const versionResult = await runHost([sourcePath, "--version"], repository, {}, [0, 1]);
  hostTools.push({
    role: `host-${name}`,
    path: relativeEvidencePath(destination),
    mode: modeString(stat.mode),
    size: stat.size,
    sha256: copiedSha256,
    version: `${versionResult.stdout.toString()}${versionResult.stderr.toString()}`.split("\n")[0]?.trim(),
  });
}
const hostBashIdentity = hostTools.find((identity) => identity.role === "host-bash");
if (!hostBashIdentity) throw new Error("host Bash identity is required");
const hostGitleaksIdentity = hostTools.find((identity) => identity.role === "host-gitleaks");
if (!hostGitleaksIdentity) throw new Error("host gitleaks identity is required");
const toolInventory = inventoryTree(toolsRoot);
const toolInventoryFile = writeJson(join(toolsRoot, "inventory.json"), toolInventory);
const toolchainInventorySha256 = toolInventoryFile.sha256;
const bwrapIdentity = hostTools.find((identity) => identity.role === "host-bwrap");
if (!bwrapIdentity) throw new Error("host bwrap identity is required");
const sandboxCommandTools = [
  hostBashIdentity,
  bunIdentity,
  shellIdentity,
  rmIdentity,
  gitIdentity,
  loaderIdentity,
  ...sandboxRuntimeIdentities.filter((identity) => identity.path !== loaderIdentity.path),
];
const sandboxRootfsPrefix = `${relativeEvidencePath(sandboxRootfs)}/`;
const sandboxRuntimeBindings = [...new Map(
  [bunIdentity, gitIdentity, shellIdentity, rmIdentity, ...sandboxRuntimeIdentities]
    .map((identity) => [identity.path, identity] as const),
).values()].sort((left, right) => byteSort(left.path, right.path));

function sandboxRuntimeDestination(identity: FileIdentity): string {
  if (!identity.path.startsWith(sandboxRootfsPrefix)) {
    throw new Error(`sandbox runtime identity is outside the minimal rootfs: ${identity.path}`);
  }
  return `/${identity.path.slice(sandboxRootfsPrefix.length)}`;
}

function openExternalFileMatchingIdentity(source: string, identity: FileIdentity, label: string): number {
  const resolvedSource = realpathSync(source);
  const descriptor = openSync(resolvedSource, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > 512 * 1024 * 1024) throw new Error(`${label} is not a bounded regular file`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.byteLength !== after.size) {
      throw new Error(`${label} changed while bound`);
    }
    if (before.size !== identity.size || modeString(before.mode) !== identity.mode || sha256Bytes(bytes) !== identity.sha256) {
      throw new Error(`${label} no longer matches its bundled identity`);
    }
    if (realpathSync(source) !== resolvedSource) throw new Error(`${label} path resolution changed while bound`);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertExternalFileMatchesIdentity(source: string, identity: FileIdentity, label: string): void {
  closeSync(openExternalFileMatchingIdentity(source, identity, label));
}

function assertHostSandboxRuntimeBinding(): void {
  assertExternalFileMatchesIdentity(executableSources.bash, hostBashIdentity, "canonical Bash launcher");
  assertExternalFileMatchesIdentity(executableSources.bwrap, bwrapIdentity, "canonical bwrap");
  for (const source of runtimeFiles) {
    const identity = sandboxRuntimeIdentities.find((candidate) => candidate.path.endsWith(source));
    if (!identity) throw new Error(`bundled runtime identity is missing for ${source}`);
    assertExternalFileMatchesIdentity(source, identity, `sandbox runtime ${source}`);
  }
}

const baseEnvironment: Record<string, string> = { ...CANONICAL_BASE_ENVIRONMENT };

function redactedEnvironment(environment: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).sort(([left], [right]) => byteSort(left, right)).map(([key, value]) => [
    key,
    /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY)/i.test(key) ? "[REDACTED]" : value,
  ]));
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function sandboxLaunchArgv(
  workspaceSource: string,
  rootfsSource: string,
  runtimeHomeSource: string,
  bwrapSource: string,
  environment: Record<string, string>,
  argv: string[],
  hostBwrap: string,
  readOnlyMounts: Array<[string, string]> = [],
): { actualArgs: string[]; recordedArgv: string[] } {
  const mountSources = [workspaceSource, rootfsSource, runtimeHomeSource, bwrapSource, ...readOnlyMounts.map(([source]) => source)];
  const childFd = (index: number): number => index + 3;
  const bwrapArguments = [
    "--die-with-parent", "--new-session", "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup-try", "--unshare-net",
    "--ro-bind-fd", String(childFd(1)), "/", "--proc", "/proc", "--dev", "/dev",
    "--bind-fd", String(childFd(0)), "/mnt", "--bind-fd", String(childFd(2)), "/srv",
    "--tmpfs", "/home", "--perms", "1777", "--tmpfs", "/tmp", "--clearenv",
  ];
  for (const [key, value] of Object.entries(environment).sort(([left], [right]) => byteSort(left, right))) {
    bwrapArguments.push("--setenv", key, value);
  }
  readOnlyMounts.forEach(([_source, sandbox], index) => {
    bwrapArguments.push("--ro-bind-fd", String(childFd(4 + index)), sandbox);
  });
  bwrapArguments.push("--chdir", "/mnt", "--", ...argv);
  const launcher = [
    "set -euo pipefail",
    "ulimit -f 65536",
    ...mountSources.map((_source, index) => `exec ${childFd(index)}<\"\${${index + 1}}\"`),
    `shift ${mountSources.length}`,
    'exec "$@"',
  ].join("\n");
  const prefix = ["-c", launcher, "stage-a-bwrap-launch", ...mountSources];
  const normalizedLaunchArgv = [
    "tools/host/bash",
    "-c",
    launcher,
    "stage-a-bwrap-launch",
    "<workspace-fd>",
    "<minimal-rootfs-fd>",
    "<runtime-home-fd>",
    "<bwrap-fd>",
    ...readOnlyMounts.map(([_source, sandbox]) => `<read-only-fd:${sandbox}>`),
    "tools/host/bwrap",
    ...bwrapArguments,
  ];
  return {
    actualArgs: [...prefix, `/proc/self/fd/${childFd(3)}`, ...bwrapArguments],
    recordedArgv: normalizedLaunchArgv,
  };
}

function identityForSandboxPath(hostWorkspace: string, sandboxPath: string): FileIdentity {
  const prefix = "/mnt/";
  if (!sandboxPath.startsWith(prefix)) throw new Error(`unsupported sandbox input path: ${sandboxPath}`);
  return fileIdentity(join(hostWorkspace, sandboxPath.slice(prefix.length)));
}

function policySandboxInputs(policyValue: CanonicalCommandPolicy, prefix: "workspace" | "artifact"): string[] {
  return policyValue.inputs.map((path) => {
    const expectedPrefix = `${prefix}/`;
    if (!path.startsWith(expectedPrefix)) throw new Error(`${policyValue.label} input is outside ${prefix}: ${path}`);
    return `/mnt/${path.slice(expectedPrefix.length)}`;
  });
}

let commandIndex = 0;
async function executeSandbox(
  label: string,
  argv: string[],
  expectedExit: number,
  extraEnvironment: Record<string, string> = {},
  options: {
    hostWorkspace?: string;
    identityWorkspace?: string;
    expectedAuthorityFloor?: number;
    inputPaths?: string[];
    commandTools?: FileIdentity[];
    readOnlyMounts?: Array<[string, string]>;
    outputComparisonRules?: Array<"duration-tokens" | "namespace-inode">;
    replayable?: boolean;
    replayOmission?: string;
  } = {},
): Promise<CommandEvidence> {
  const hostWorkspace = options.hostWorkspace ?? workspace;
  const identityWorkspace = options.identityWorkspace ?? hostWorkspace;
  const environment = { ...baseEnvironment, ...extraEnvironment };
  const logRoot = join(executionsRoot, `${String(commandIndex).padStart(3, "0")}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
  mkdirSync(logRoot, { recursive: true });
  const stdoutPath = join(logRoot, "stdout.bin");
  const stderrPath = join(logRoot, "stderr.bin");
  const heldDescriptors: number[] = [];
  const parentDescriptorPath = (descriptor: number): string => `/proc/${process.pid}/fd/${descriptor}`;
  let launch!: ReturnType<typeof sandboxLaunchArgv>;
  let result!: PinnedCommandResult;
  try {
    const workspaceDescriptor = openSync(hostWorkspace, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    heldDescriptors.push(workspaceDescriptor);
    heldDescriptors.push(openSync(sandboxRootfs, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW));
    heldDescriptors.push(openSync(runtimeHome, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW));
    heldDescriptors.push(openExternalFileMatchingIdentity(
      executableSources.bwrap,
      bwrapIdentity,
      "canonical bwrap",
    ));
    const descriptorMounts: Array<[string, string]> = [];
    for (const identity of sandboxRuntimeBindings) {
      const descriptor = openEvidenceFileMatchingIdentity(identity, `sandbox runtime ${identity.path}`);
      heldDescriptors.push(descriptor);
      descriptorMounts.push([parentDescriptorPath(descriptor), sandboxRuntimeDestination(identity)]);
    }
    for (const [relativePath, sandbox] of [
      ["node_modules", "/mnt/node_modules"],
      ["dashboard/node_modules", "/mnt/dashboard/node_modules"],
    ] as const) {
      try {
        const descriptor = openAnchoredDirectory(workspaceDescriptor, relativePath);
        heldDescriptors.push(descriptor);
        descriptorMounts.push([parentDescriptorPath(descriptor), sandbox]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const [host, sandbox] of options.readOnlyMounts ?? []) {
      const descriptor = openSync(host, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      heldDescriptors.push(descriptor);
      descriptorMounts.push([parentDescriptorPath(descriptor), sandbox]);
    }
    launch = sandboxLaunchArgv(
      parentDescriptorPath(heldDescriptors[0]!),
      parentDescriptorPath(heldDescriptors[1]!),
      parentDescriptorPath(heldDescriptors[2]!),
      parentDescriptorPath(heldDescriptors[3]!),
      environment,
      argv,
      executableSources.bwrap,
      descriptorMounts,
    );
    assertHostSandboxRuntimeBinding();
    result = await runPinnedCommand({
      executable: hostExecutables.bash!,
      args: launch.actualArgs,
      env: { LANG: "C.UTF-8", LC_ALL: "C" },
      stdin: "ignore",
      deadlineMs: SANDBOX_COMMAND_DEADLINE_MS,
      outputLimitBytes: DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES,
      outputCapture: "files",
    });
  } finally {
    for (const descriptor of heldDescriptors) {
      try {
        closeSync(descriptor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;
      }
    }
  }
  assertHostSandboxRuntimeBinding();
  writeFileSync(stdoutPath, result.stdout, { mode: 0o644, flag: "wx" });
  writeFileSync(stderrPath, result.stderr, { mode: 0o644, flag: "wx" });
  chmodSync(stdoutPath, 0o644);
  chmodSync(stderrPath, 0o644);
  const combined = `${result.stdout.toString()}\n${result.stderr.toString()}`;
  const authorityFloorOccurrences = countOccurrences(combined, "HOSTED_AUTHORITY_UNAVAILABLE");
  const expectedAuthorityFloor = options.expectedAuthorityFloor ?? 0;
  if (result.exitCode !== expectedExit) {
    throw new Error(`${label} exited ${result.exitCode}, expected ${expectedExit}: ${combined.slice(0, 2_000)}`);
  }
  if (authorityFloorOccurrences !== expectedAuthorityFloor) {
    throw new Error(`${label} emitted ${authorityFloorOccurrences} authority floors, expected ${expectedAuthorityFloor}`);
  }
  const tripwireAbsent = !combined.includes("STAGE_A_IMPORT_TRIPWIRE")
    && !combined.includes("STAGE_A_ENTRYPOINT_TRIPWIRE");
  if (!tripwireAbsent) throw new Error(`${label} reached a forbidden Stage A effect`);
  const preloads: FileIdentity[] = [];
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === "--preload") preloads.push(identityForSandboxPath(identityWorkspace, argv[index + 1]!));
  }
  const inputs = (options.inputPaths ?? []).map((path) => identityForSandboxPath(identityWorkspace, path));
  if (options.replayable === false && !options.replayOmission) throw new Error(`${label} requires an explicit replay omission contract`);
  const evidence: CommandEvidence = {
    index: commandIndex,
    label,
    argv,
    launch_argv: launch.recordedArgv,
    cwd: "/mnt",
    env: redactedEnvironment(environment),
    stdin: "ignore",
    deadline_ms: result.deadlineMs,
    output_limit_bytes: result.outputLimitBytes,
    termination: "exit",
    timed_out: false,
    output_limited: false,
    expected_exit: expectedExit,
    exit_code: result.exitCode,
    stdout: fileIdentity(stdoutPath),
    stderr: fileIdentity(stderrPath),
    authority_floor_occurrences: authorityFloorOccurrences,
    expected_authority_floor_occurrences: expectedAuthorityFloor,
    tripwire_absent: tripwireAbsent,
    network_isolated: true,
    toolchain_inventory_sha256: toolchainInventorySha256,
    tools: [
      bwrapIdentity,
      ...(options.commandTools ?? sandboxCommandTools),
    ],
    preloads,
    inputs,
    replayable: options.replayable ?? true,
    ...(options.replayable === false ? { replay_omission: options.replayOmission } : {}),
    output_comparison: options.outputComparisonRules?.length
      ? { mode: "normalized-text-v1", rules: options.outputComparisonRules }
      : { mode: "exact-bytes", rules: [] },
  };
  commandIndex += 1;
  return evidence;
}

async function executeCanonicalPolicy(
  policyValue: CanonicalCommandPolicy,
  prefix: "workspace" | "artifact",
  options: Parameters<typeof executeSandbox>[4] = {},
): Promise<CommandEvidence> {
  const evidence = await executeSandbox(
    policyValue.label,
    [...policyValue.argv],
    policyValue.expectedExit,
    { ...policyValue.env },
    {
      ...options,
      expectedAuthorityFloor: policyValue.expectedAuthorityFloor,
      inputPaths: policySandboxInputs(policyValue, prefix),
      outputComparisonRules: [...policyValue.outputComparisonRules],
    },
  );
  return evidence;
}

function materializeDependencyTree(rootPath: string): void {
  for (const path of regularFiles(rootPath)) {
    const stat = lstatSync(path);
    if (stat.nlink <= 1) continue;
    const replacement = `${path}.stage-a-unlinked`;
    copyFileSync(path, replacement);
    chmodSync(replacement, stat.mode & 0o777);
    renameSync(replacement, path);
  }
  for (const entry of inventoryTree(rootPath)) {
    if (entry.type !== "file" && entry.type !== "directory" && entry.type !== "symlink") {
      throw new Error(`dependency closure contains a special entry: ${entry.path}`);
    }
  }
  for (const path of regularFiles(rootPath)) {
    if (lstatSync(path).nlink !== 1) throw new Error(`dependency closure retains a hardlink: ${path}`);
  }
}

function assertDependencySymlinkClosure(inventory: readonly InventoryEntry[]): void {
  const entries = new Map(inventory.map((entry) => [entry.path, entry]));
  for (const entry of inventory) {
    if (entry.type !== "symlink") continue;
    if (typeof entry.target !== "string" || isAbsolute(entry.target) || entry.target.includes("\0") || entry.target.includes("\\")) {
      throw new Error(`dependency symlink has an unsafe target: ${entry.path}`);
    }
    let candidate = posix.normalize(posix.join(posix.dirname(entry.path), entry.target));
    const seen = new Set<string>();
    let closed = false;
    for (let pass = 0; pass < MAX_TREE_DEPTH; pass += 1) {
      if (!candidate || candidate === "." || candidate === ".." || candidate.startsWith("../") || isAbsolute(candidate)) {
        throw new Error(`dependency symlink escapes the closed inventory: ${entry.path}`);
      }
      if (seen.has(candidate)) throw new Error(`dependency symlink cycle: ${entry.path}`);
      seen.add(candidate);
      const parts = candidate.split("/");
      let substituted = false;
      for (let index = 1; index <= parts.length; index += 1) {
        const prefix = parts.slice(0, index).join("/");
        const prefixEntry = entries.get(prefix);
        if (prefixEntry?.type !== "symlink") continue;
        candidate = posix.normalize(posix.join(
          posix.dirname(prefix),
          prefixEntry.target!,
          ...parts.slice(index),
        ));
        substituted = true;
        break;
      }
      if (substituted) continue;
      if (!entries.has(candidate)) throw new Error(`dependency symlink target is absent from the closed inventory: ${entry.path}`);
      closed = true;
      break;
    }
    if (!closed) throw new Error(`dependency symlink resolution depth exceeded: ${entry.path}`);
  }
}

const lockfileBeforeDependencies = fileIdentity(join(workspace, "bun.lock"));
const dependencySourceDescriptorPath = `/proc/self/fd/${dependencySourceDescriptor}`;
const dependencySourceInventoryBefore = dependencyInventory(dependencySourceDescriptorPath, true);
if (!dependencySourceInventoryBefore.some((entry) => entry.path === "node_modules")) {
  throw new Error("existing dependency source does not contain node_modules");
}
const dependencySourceCanonical = realpathSync(dependencySourceDescriptorPath);
for (const entry of dependencySourceInventoryBefore) {
  if (entry.type !== "symlink") continue;
  if (typeof entry.target !== "string" || isAbsolute(entry.target) || entry.target.includes("\0") || entry.target.includes("\\")) {
    throw new Error(`existing dependency source contains an unsafe symlink target: ${entry.path}`);
  }
  const resolvedTarget = realpathSync(join(dependencySourceDescriptorPath, entry.path));
  const relativeTarget = relative(dependencySourceCanonical, resolvedTarget);
  if (relativeTarget === "" || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
    throw new Error(`existing dependency source symlink escapes its descriptor root: ${entry.path}`);
  }
}
const dependencySourceInventoryIdentity = writeJson(
  join(dependenciesRoot, "existing-source-inventory.json"),
  dependencySourceInventoryBefore,
);
for (const relativePath of ["node_modules", "dashboard/node_modules"] as const) {
  let descriptor: number | undefined;
  try {
    descriptor = openAnchoredDirectory(dependencySourceDescriptor, relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && relativePath === "dashboard/node_modules") continue;
    throw error;
  }
  try {
    const destination = join(workspace, relativePath);
    if (existsSync(destination)) throw new Error(`candidate workspace already contains dependency path: ${relativePath}`);
    const sourceRoot = `/proc/self/fd/${descriptor}`;
    const sourceRootStat = fstatSync(descriptor);
    mkdirSync(destination, { recursive: true, mode: sourceRootStat.mode & 0o777 });
    chmodSync(destination, sourceRootStat.mode & 0o777);
    for (const name of readdirSync(sourceRoot).sort(byteSort)) {
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
        throw new Error(`existing dependency source contains an unsafe root entry: ${relativePath}`);
      }
      if (isDependencySourceScratch(`${relativePath}/${name}`)) continue;
      cpSync(join(sourceRoot, name), join(destination, name), {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        preserveTimestamps: true,
        errorOnExist: true,
      });
    }
  } finally {
    closeSync(descriptor);
  }
}

for (const dependencyRoot of [join(workspace, "node_modules"), join(workspace, "dashboard", "node_modules")]) {
  if (existsSync(dependencyRoot)) materializeDependencyTree(dependencyRoot);
}
const dependencySourceInventoryAfter = dependencyInventory(dependencySourceDescriptorPath, true);
if (JSON.stringify(dependencySourceInventoryAfter) !== JSON.stringify(dependencySourceInventoryBefore)) {
  throw new Error("existing dependency source changed while copied");
}
closeSync(dependencySourceDescriptor);
const lockfileAfterDependencies = fileIdentity(join(workspace, "bun.lock"));
if (
  lockfileBeforeDependencies.sha256 !== lockfileAfterDependencies.sha256
  || lockfileBeforeDependencies.size !== lockfileAfterDependencies.size
) {
  throw new Error("existing dependency copy changed bun.lock");
}
repositoryDependencyInventory = dependencyInventory(workspace);
if (repositoryDependencyInventory.some((entry) => entry.type !== "file" && entry.type !== "directory" && entry.type !== "symlink")) {
  throw new Error("clean dependency inventory contains a special entry");
}
assertDependencySymlinkClosure(repositoryDependencyInventory);
dependencyInventoryIdentity = writeJson(join(dependenciesRoot, "inventory.json"), repositoryDependencyInventory);
assertArchiveExtractionClosed(repositoryDependencyInventory);
const dependencyArchiveInputs = ["node_modules"];
if (existsSync(join(workspace, "dashboard", "node_modules"))) {
  dependencyArchiveInputs.push("--no-recursion", "dashboard", "--recursion", "dashboard/node_modules");
}
await runHost([
  "tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
  "--hard-dereference", "--format=gnu", "-cf", dependencyArchiveTar,
  "-C", workspace, ...dependencyArchiveInputs,
], evidenceRoot);
await runHost(["gzip", "-n", dependencyArchiveTar], evidenceRoot);
if (!existsSync(dependencyArchivePath)) throw new Error("dependency archive compression did not produce the expected path");
const dependencyMemberListing = (await runHost(["tar", "-tvzf", dependencyArchivePath], evidenceRoot)).stdout.toString();
for (const line of dependencyMemberListing.split("\n").filter(Boolean)) {
  if (line[0] !== "-" && line[0] !== "d" && line[0] !== "l") throw new Error(`dependency archive contains a special member: ${line.slice(0, 80)}`);
}
dependencyArchiveIdentity = fileIdentity(dependencyArchivePath);
const dependencyExtractionRoot = join(evidenceRoot, ".dependency-extraction-smoke");
mkdirSync(dependencyExtractionRoot);
await runHost(["tar", "--same-permissions", "-xzf", dependencyArchivePath, "-C", dependencyExtractionRoot], evidenceRoot);
const extractedDependencyInventory = dependencyInventory(dependencyExtractionRoot);
assertArchiveExtractionClosed(extractedDependencyInventory);
assertDependencySymlinkClosure(extractedDependencyInventory);
if (JSON.stringify(extractedDependencyInventory) !== JSON.stringify(repositoryDependencyInventory)) {
  throw new Error("clean dependency archive does not match the lock-bound inventory");
}
rmSync(dependencyExtractionRoot, { recursive: true, force: false });

const networkProbe = await executeCanonicalPolicy(NETWORK_PROBE_POLICY, "workspace");
assertCommandRecordMatchesPolicy(networkProbe, NETWORK_PROBE_POLICY, "created network probe record");
const networkProbeOutput = `${readAnchoredRegular(outputDescriptor!, networkProbe.stdout.path).toString("utf8")}\n${readAnchoredRegular(outputDescriptor!, networkProbe.stderr.path).toString("utf8")}`;
const parentNetworkNamespace = readlinkSync("/proc/self/ns/net");
const childNetworkNamespace = networkProbeOutput.match(/namespace=(net:\[[0-9]+\])/)?.[1];
if (!childNetworkNamespace || childNetworkNamespace === parentNetworkNamespace) throw new Error("network probe did not prove a distinct network namespace");
const childInterfaces = networkProbeOutput.match(/^interfaces=(.*)$/m)?.[1];
const childRouteCount = networkProbeOutput.match(/^routes=(\d+)$/m)?.[1];
const childSocketCount = networkProbeOutput.match(/^socket_fds=(\d+)$/m)?.[1];
const childDirectoryCount = networkProbeOutput.match(/^directory_fds=(\d+)$/m)?.[1];
if (childInterfaces !== "lo" || childRouteCount !== "0" || childSocketCount !== "0" || childDirectoryCount !== "0") {
  throw new Error(
    `network probe did not prove the isolated interface and descriptor floor: interfaces=${JSON.stringify(childInterfaces)} routes=${JSON.stringify(childRouteCount)} sockets=${JSON.stringify(childSocketCount)} directories=${JSON.stringify(childDirectoryCount)}`,
  );
}
const routeProbeResult = networkProbeOutput.match(/^route_error=(.+)$/m)?.[1];
if (!routeProbeResult) throw new Error("network probe did not prove a denied external route");
const networkProbeOldRoot = dirname(join(evidenceRoot, networkProbe.stdout.path));
const networkProbeRoot = join(executionsRoot, "network-namespace-denial-probe");
renameSync(networkProbeOldRoot, networkProbeRoot);
networkProbe.stdout = fileIdentity(join(networkProbeRoot, "stdout.bin"));
networkProbe.stderr = fileIdentity(join(networkProbeRoot, "stderr.bin"));
commandIndex = 0;

const generatedSdkPath = join(workspace, "src", "sdk", "v1.generated.ts");
const generatedSdkBefore = fileIdentity(generatedSdkPath);
const containmentSmokes: CommandEvidence[] = [];
containmentSmokes.push(await executeCanonicalPolicy(SOURCE_REPLAY_POLICY[0]!, "workspace"));
const generatedSdkAfter = fileIdentity(generatedSdkPath);
if (generatedSdkBefore.sha256 !== generatedSdkAfter.sha256 || generatedSdkBefore.size !== generatedSdkAfter.size) {
  throw new Error("generated SDK output is not stable");
}

for (const policyValue of SOURCE_REPLAY_POLICY.slice(1)) {
  containmentSmokes.push(await executeCanonicalPolicy(policyValue, "workspace"));
}
if (containmentSmokes.length !== 29) throw new Error(`unexpected containment smoke count: ${containmentSmokes.length}`);
for (const [index, policyValue] of SOURCE_REPLAY_POLICY.entries()) {
  assertCommandRecordMatchesPolicy(containmentSmokes[index], policyValue, `created source record ${index}`);
}

const dependencyInventoryAfterCommands = dependencyInventory(workspace);
if (JSON.stringify(dependencyInventoryAfterCommands) !== JSON.stringify(repositoryDependencyInventory)) {
  throw new Error("network-isolated commands mutated the bound dependency tree");
}
const dependencyAfterFile = writeJson(join(dependenciesRoot, "inventory-after.json"), dependencyInventoryAfterCommands);
const declarationToolIdentity = containmentSmokes[2]!.inputs.find((entry) => entry.path.endsWith("node_modules/typescript/bin/tsc"));
const declarationPackageIdentity = containmentSmokes[2]!.inputs.find((entry) => entry.path.endsWith("node_modules/typescript/package.json"));
if (!declarationToolIdentity || !declarationPackageIdentity) throw new Error("declaration dependency identities are incomplete");

const sourceInventoryAfter = inventoryTree(workspace, sourceInventoryExclude);
const sourceInventoryAfterFile = writeJson(join(provenanceRoot, "copied-source-after.json"), sourceInventoryAfter);
if (JSON.stringify(sourceInventoryAfter) !== JSON.stringify(sourceInventoryBefore)) {
  throw new Error("copied candidate source changed during generation/build/smoke execution");
}

cpSync(join(workspace, "dist"), join(artifactRoot, "dist"), { recursive: true, preserveTimestamps: true });
copyFileSync(join(workspace, "package.json"), join(artifactRoot, "package.json"));
mkdirSync(join(artifactRoot, "verification"), { recursive: true });
copyFileSync(join(workspace, "src", "test", "stage-a-import-tripwire-preload.ts"), join(artifactRoot, "verification", "import-preload.ts"));
copyFileSync(join(workspace, "src", "test", "stage-a-entrypoint-preload.ts"), join(artifactRoot, "verification", "entrypoint-preload.ts"));

const artifactInventory = inventoryTree(artifactRoot);
if (artifactInventory.some((entry) => entry.type === "symlink")) throw new Error("artifact must not contain symlinks");
for (const path of regularFiles(artifactRoot)) {
  if (lstatSync(path).nlink !== 1) throw new Error(`artifact contains a hardlinked regular file: ${relative(artifactRoot, path)}`);
}
const artifactDatastoreFiles = regularFiles(artifactRoot).flatMap((path) => {
  const relativePath = relative(artifactRoot, path).split(sep).join("/");
  const bytes = readAnchoredRegular(outputDescriptor!, relativeEvidencePath(path));
  const pathMatch = /(?:\.db|\.sqlite)(?:-(?:wal|shm))?$|-(?:wal|shm)$/.test(relativePath);
  const sqliteHeader = bytes.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"));
  const walHeader = bytes.length >= 4 && (bytes.readUInt32BE(0) === 0x377f0682 || bytes.readUInt32BE(0) === 0x377f0683);
  return pathMatch || sqliteHeader || walHeader
    ? [{ path: relativePath, reason: pathMatch ? "path" : sqliteHeader ? "sqlite-header" : "wal-header" }]
    : [];
});
if (artifactDatastoreFiles.length !== 0) throw new Error("artifact contains datastore/runtime content");
const packageJsonBytes = readAnchoredRegular(outputDescriptor!, relativeEvidencePath(join(artifactRoot, "package.json")), 4 * 1024 * 1024);
const packageJson = JSON.parse(packageJsonBytes.toString("utf8")) as { bin: Record<string, string> };
const binInventory = Object.entries(packageJson.bin).map(([name, target]) => {
  const entry = artifactInventory.find((candidate) => candidate.type === "file" && candidate.path === target);
  if (!entry) throw new Error(`artifact bin target missing: ${name} -> ${target}`);
  return { name, target, mode: entry.mode, size: entry.size, sha256: entry.sha256 };
});
const artifactArchiveTar = join(evidenceRoot, "todos-stage-a-artifact.tar");
const artifactArchivePath = `${artifactArchiveTar}.gz`;
await runHost([
  "tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
  "--hard-dereference", "--format=ustar",
  "-cf", artifactArchiveTar, "-C", artifactRoot, ...readdirSync(artifactRoot).sort(byteSort),
], evidenceRoot);
await runHost(["gzip", "-n", artifactArchiveTar], evidenceRoot);
const artifactMemberListing = (await runHost(["tar", "-tvzf", artifactArchivePath], evidenceRoot)).stdout.toString();
for (const line of artifactMemberListing.split("\n").filter(Boolean)) {
  if (line[0] !== "-" && line[0] !== "d") throw new Error(`artifact archive contains a special member: ${line.slice(0, 80)}`);
}
const artifactArchiveIdentity = fileIdentity(artifactArchivePath);

const extractedArtifactRoot = join(evidenceRoot, ".artifact-extraction-smoke");
mkdirSync(extractedArtifactRoot);
await runHost(["tar", "-xzf", artifactArchivePath, "-C", extractedArtifactRoot], evidenceRoot);
if (existsSync(join(extractedArtifactRoot, "node_modules")) || existsSync(join(extractedArtifactRoot, "src"))) {
  throw new Error("artifact extraction is not isolated from source and node_modules");
}
const extractedArtifactInventory = inventoryTree(extractedArtifactRoot);
if (JSON.stringify(extractedArtifactInventory) !== JSON.stringify(artifactInventory)) {
  throw new Error("artifact extraction inventory does not match the source artifact inventory");
}

const artifactSmokes: CommandEvidence[] = [];
for (const policyValue of ARTIFACT_REPLAY_POLICY) {
  artifactSmokes.push(await executeCanonicalPolicy(
    policyValue,
    "artifact",
    {
      hostWorkspace: extractedArtifactRoot,
      identityWorkspace: artifactRoot,
    },
  ));
}
if (artifactSmokes.length !== 13) throw new Error(`unexpected extracted artifact smoke count: ${artifactSmokes.length}`);
for (const [index, policyValue] of ARTIFACT_REPLAY_POLICY.entries()) {
  assertCommandRecordMatchesPolicy(artifactSmokes[index], policyValue, `created artifact record ${index}`);
}
rmSync(extractedArtifactRoot, { recursive: true, force: false });

function regularFiles(root: string): string[] {
  return inventoryTree(root)
    .filter((entry) => entry.type === "file")
    .map((entry) => join(root, entry.path));
}

function scanCredentialBytes(path: string): string[] {
  const bytes = readAnchoredRegular(outputDescriptor!, relativeEvidencePath(path));
  const categories = new Set<string>();
  for (const projection of secretScanByteProjections(bytes)) {
    for (const match of scanTextForSecrets(projection.text).matches) categories.add(`${projection.name}:${match.pattern}`);
  }
  return [...categories].sort(byteSort);
}

const closureScanRoots = [workspace, artifactRoot, provenanceRoot];
const provenanceScans = closureScanRoots.flatMap((scanRoot) => regularFiles(scanRoot)).map((path) => ({
  path: relativeEvidencePath(path),
  sha256: sha256File(path),
  heuristic_categories: scanCredentialBytes(path),
}));
const isLowConfidenceCredentialCategory = (category: string): boolean => {
  const pattern = category.slice(category.lastIndexOf(":") + 1);
  return pattern === "generic_credential_assignment" || pattern === "encoded_generic_credential_assignment";
};
const highConfidenceCredentialCategories = (categories: string[]): string[] =>
  categories.filter((category) => !isLowConfidenceCredentialCategory(category));
const isPublishedExamplePath = (path: string): boolean =>
  /(?:^|\/)(?:test|tests|fixtures?|examples?|docs?)(?:\/|$)|\.(?:test|spec)\.[^.]+$|\.d\.ts$|\.(?:md|mdx)$/i.test(path);
const isApprovedHighConfidenceCredentialPath = (path: string): boolean => {
  if (path.startsWith("workspace/")) return isPublishedExamplePath(path.slice("workspace/".length));
  if (path.startsWith("provenance/untracked-files/")) {
    return isPublishedExamplePath(path.slice("provenance/untracked-files/".length));
  }
  return [
    "provenance/base-tree.tar",
    "provenance/candidate.diff",
    "provenance/canonical-candidate-v5.bin",
    "provenance/untracked-records-v5.bin",
  ].includes(path);
};
const unapprovedHeuristicFiles = provenanceScans.filter((entry) =>
  highConfidenceCredentialCategories(entry.heuristic_categories).length > 0
  && !isApprovedHighConfidenceCredentialPath(entry.path));
if (unapprovedHeuristicFiles.length > 0) {
  throw new Error(`fixed-point credential projections found unapproved closure files: ${unapprovedHeuristicFiles.slice(0, 20).map((entry) => entry.path).join(", ")}`);
}
const lowConfidenceHeuristicFileCount = provenanceScans.filter((entry) =>
  entry.heuristic_categories.some(isLowConfidenceCredentialCategory)).length;
const approvedHighConfidenceHeuristicFileCount = provenanceScans.filter((entry) =>
  highConfidenceCredentialCategories(entry.heuristic_categories).length > 0).length;

interface RedactedGitleaksFinding {
  rule: string;
  file: string;
  line: number;
  classification: "synthetic_test_fixture";
}

interface NormalPathGitleaksRun {
  label: "primary" | "independent-replay";
  result: PinnedCommandResult;
  argv: string[];
  findings: RedactedGitleaksFinding[];
}

function materializeScannerSnapshot(snapshotPath: string): void {
  const copyInventory = (prefix: "workspace" | "artifact", inventory: readonly InventoryEntry[]): void => {
    const targetRoot = join(snapshotPath, prefix);
    mkdirSync(targetRoot, { mode: 0o700 });
    for (const entry of inventory) {
      const destination = join(targetRoot, entry.path);
      if (entry.type === "directory") {
        mkdirSync(destination, { recursive: true, mode: Number.parseInt(entry.mode, 8) });
        chmodSync(destination, Number.parseInt(entry.mode, 8));
      } else if (entry.type === "file") {
        mkdirSync(dirname(destination), { recursive: true });
        const bytes = readAnchoredRegular(outputDescriptor!, `${prefix}/${entry.path}`);
        if (bytes.byteLength !== entry.size || sha256Bytes(bytes) !== entry.sha256) {
          throw new Error(`gitleaks snapshot source identity changed: ${prefix}/${entry.path}`);
        }
        writeFileSync(destination, bytes, { mode: Number.parseInt(entry.mode, 8), flag: "wx" });
        chmodSync(destination, Number.parseInt(entry.mode, 8));
      } else {
        throw new Error(`gitleaks snapshot rejects linked input: ${prefix}/${entry.path}`);
      }
    }
  };
  copyInventory("workspace", sourceInventoryBefore);
  copyInventory("artifact", artifactInventory);
}

async function runNormalPathGitleaks(label: NormalPathGitleaksRun["label"]): Promise<NormalPathGitleaksRun> {
  const privateRoot = mkdtempSync(join(tmpdir(), `todos-stage-a-gitleaks-${label}-`));
  chmodSync(privateRoot, 0o700);
  const snapshotPath = join(privateRoot, "gitleaks-normal-path-snapshot");
  const gitleaksReportPath = join(privateRoot, "report.json");
  mkdirSync(snapshotPath, { mode: 0o700 });
  materializeScannerSnapshot(snapshotPath);
  const snapshotDescriptor = openSync(snapshotPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const lexicalBefore = statSync(snapshotPath);
    const anchoredBefore = fstatSync(snapshotDescriptor);
    if (!anchoredBefore.isDirectory() || anchoredBefore.dev !== lexicalBefore.dev || anchoredBefore.ino !== lexicalBefore.ino) {
      throw new Error("gitleaks normal-path snapshot is not descriptor anchored");
    }
    const snapshotInventoryBefore = inventoryTree(snapshotPath);
    const actualArgs = [
      "dir", snapshotPath,
      "--no-banner", "--no-color", "--log-level", "error", "--redact=100",
      "--max-archive-depth", "2", "--max-decode-depth", "32", "--max-target-megabytes", "1024",
      "--timeout", "120", "--report-format", "json", "--report-path", gitleaksReportPath,
    ];
    const argv = [
      "tools/host/gitleaks", "dir", "<private-normal-path-snapshot>",
      "--no-banner", "--no-color", "--log-level", "error", "--redact=100",
      "--max-archive-depth", "2", "--max-decode-depth", "32", "--max-target-megabytes", "1024",
      "--timeout", "120", "--report-format", "json", "--report-path", "<private-report>",
    ];
    const result = await runPinnedCommand({
      executable: {
        path: join(evidenceRoot!, hostGitleaksIdentity.path),
        mode: hostGitleaksIdentity.mode,
        size: hostGitleaksIdentity.size,
        sha256: hostGitleaksIdentity.sha256,
      },
      args: actualArgs,
      cwd: privateRoot,
      env: { LANG: "C.UTF-8", LC_ALL: "C" },
      stdin: "ignore",
      deadlineMs: 180_000,
      outputLimitBytes: MAX_COMMAND_OUTPUT_BYTES,
    });
    if ((result.exitCode !== 0 && result.exitCode !== 1) || !existsSync(gitleaksReportPath)) {
      throw new Error(`gitleaks ${label} scan exited outside the bounded policy`);
    }
    const reportDescriptor = openSync(gitleaksReportPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let reportBytes: Buffer;
    try {
      const before = fstatSync(reportDescriptor);
      if (!before.isFile() || before.size > 32 * 1024 * 1024) throw new Error("gitleaks report is not a bounded regular file");
      reportBytes = readFileSync(reportDescriptor);
      const after = fstatSync(reportDescriptor);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || reportBytes.byteLength !== after.size) {
        throw new Error("gitleaks report changed while read");
      }
    } finally {
      closeSync(reportDescriptor);
    }
    const rawFindings = JSON.parse(reportBytes.toString("utf8")) as Array<{
      RuleID?: unknown;
      File?: unknown;
      StartLine?: unknown;
    }>;
    if (!Array.isArray(rawFindings) || rawFindings.length > 100_000) throw new Error("gitleaks report finding bound exceeded");
    const prefixes = [`${snapshotPath}${sep}`, `${realpathSync(snapshotPath)}${sep}`];
    const findings = rawFindings.map((finding): RedactedGitleaksFinding => {
      if (typeof finding.RuleID !== "string" || typeof finding.File !== "string" || !Number.isSafeInteger(finding.StartLine)) {
        throw new Error("gitleaks emitted invalid redacted metadata");
      }
      const prefix = prefixes.find((candidate) => (finding.File as string).startsWith(candidate));
      if (!prefix) throw new Error("gitleaks emitted a finding outside the normal-path snapshot");
      const file = finding.File.slice(prefix.length).split(sep).join("/");
      const syntheticFixture = file.startsWith("workspace/")
        && isPublishedExamplePath(file.slice("workspace/".length));
      if (!syntheticFixture) throw new Error(`gitleaks found an unapproved credential-like value in ${file}`);
      return {
        rule: finding.RuleID,
        file,
        line: finding.StartLine as number,
        classification: "synthetic_test_fixture",
      };
    }).sort((left, right) => byteSort(`${left.file}\0${left.line}\0${left.rule}`, `${right.file}\0${right.line}\0${right.rule}`));
    const lexicalAfter = statSync(snapshotPath);
    const anchoredAfter = fstatSync(snapshotDescriptor);
    if (
      lexicalAfter.dev !== anchoredBefore.dev
      || lexicalAfter.ino !== anchoredBefore.ino
      || anchoredAfter.dev !== anchoredBefore.dev
      || anchoredAfter.ino !== anchoredBefore.ino
      || JSON.stringify(inventoryTree(snapshotPath)) !== JSON.stringify(snapshotInventoryBefore)
    ) {
      throw new Error("gitleaks normal-path snapshot changed during traversal");
    }
    return { label, result, argv, findings };
  } finally {
    closeSync(snapshotDescriptor);
    rmSync(privateRoot, { recursive: true, force: true });
  }
}

const gitleaksPrimary = await runNormalPathGitleaks("primary");
const gitleaksReplay = await runNormalPathGitleaks("independent-replay");
if (
  gitleaksPrimary.result.exitCode !== gitleaksReplay.result.exitCode
  || Buffer.compare(gitleaksPrimary.result.stdout, gitleaksReplay.result.stdout) !== 0
  || Buffer.compare(gitleaksPrimary.result.stderr, gitleaksReplay.result.stderr) !== 0
  || JSON.stringify(gitleaksPrimary.findings) !== JSON.stringify(gitleaksReplay.findings)
) {
  throw new Error("independent normal-path gitleaks replay differs from the primary scan");
}
const gitleaksFindings = gitleaksPrimary.findings;
const auditsRoot = join(evidenceRoot, "audits");
mkdirSync(auditsRoot);
const gitleaksStdoutPath = join(auditsRoot, "gitleaks-primary.stdout.bin");
const gitleaksStderrPath = join(auditsRoot, "gitleaks-primary.stderr.bin");
const gitleaksReplayStdoutPath = join(auditsRoot, "gitleaks-independent-replay.stdout.bin");
const gitleaksReplayStderrPath = join(auditsRoot, "gitleaks-independent-replay.stderr.bin");
writeFileSync(gitleaksStdoutPath, gitleaksPrimary.result.stdout);
writeFileSync(gitleaksStderrPath, gitleaksPrimary.result.stderr);
writeFileSync(gitleaksReplayStdoutPath, gitleaksReplay.result.stdout);
writeFileSync(gitleaksReplayStderrPath, gitleaksReplay.result.stderr);
const provenanceScanFile = writeJson(join(auditsRoot, "provenance-credential-scan.json"), {
  clean_of_unapproved_gitleaks_findings: true,
  clean_of_unapproved_high_confidence_heuristic_findings: true,
  scan_scope: ["workspace-source-and-lock-closure", "artifact", "provenance"],
  projections: ["raw-utf8", "printable-bytes", "compact-ascii", "utf16le", "utf16be"],
  max_percent_decode_passes: 32,
  low_confidence_policy: "retain and report every generic assignment category; do not treat lexical key-name matches as credential values",
  high_confidence_approval_policy: "strong signatures may occur only in published tests, fixtures, examples, docs, declarations, or byte-identical provenance containers independently represented by the workspace scan",
  low_confidence_heuristic_file_count: lowConfidenceHeuristicFileCount,
  approved_high_confidence_heuristic_file_count: approvedHighConfidenceHeuristicFileCount,
  unapproved_high_confidence_heuristic_file_count: 0,
  files_scanned: provenanceScans.length,
  files: provenanceScans,
  gitleaks: {
    tool: hostGitleaksIdentity,
    scan_scope: ["workspace-candidate-source", "artifact"],
    scan_root: "<private-normal-path-snapshot>",
    normal_path: true,
    descriptor_anchored_snapshot: true,
    descriptor_path_scan_root: false,
    argv: gitleaksPrimary.argv,
    cwd: "<private-scan-root>",
    expected_exit: [0, 1],
    stdin: "ignore",
    deadline_ms: gitleaksPrimary.result.deadlineMs,
    output_limit_bytes: gitleaksPrimary.result.outputLimitBytes,
    primary: {
      exit_code: gitleaksPrimary.result.exitCode,
      termination: gitleaksPrimary.result.termination,
      stdout: fileIdentity(gitleaksStdoutPath),
      stderr: fileIdentity(gitleaksStderrPath),
    },
    independent_replay: {
      exit_code: gitleaksReplay.result.exitCode,
      termination: gitleaksReplay.result.termination,
      stdout: fileIdentity(gitleaksReplayStdoutPath),
      stderr: fileIdentity(gitleaksReplayStderrPath),
    },
    byte_outputs_equal: true,
    findings_equal: true,
    max_archive_depth: 2,
    max_decode_depth: 32,
    findings: gitleaksFindings,
    finding_fields_recorded: ["rule", "file", "line", "classification"],
    matched_values_recorded: false,
    approval_policy: "published synthetic test, fixture, example, declaration, or documentation paths only",
  },
});

rmSync(join(workspace, "node_modules"), { recursive: true, force: false });
if (existsSync(join(workspace, "dashboard", "node_modules"))) {
  rmSync(join(workspace, "dashboard", "node_modules"), { recursive: true, force: false });
}
const runtimeHomeRegularFiles = regularFiles(runtimeHome);
if (runtimeHomeRegularFiles.length !== 0) {
  throw new Error(`runtime home contains regular files: ${runtimeHomeRegularFiles.map(relativeEvidencePath).join(", ")}`);
}
const runtimeHomeInventory = inventoryTree(runtimeHome);
if (runtimeHomeInventory.length !== 0) throw new Error("runtime home contains compile/cache/runtime entries");

const verifierSource = join(workspace, "scripts", "verify-stage-a-evidence.ts");
if (!existsSync(verifierSource)) throw new Error("scripts/verify-stage-a-evidence.ts is required");
const verifierRoot = join(evidenceRoot, "verifier");
mkdirSync(verifierRoot);
const verifierSourceNames = [
  "verify-stage-a-evidence.ts",
  "stage-a-verifier-policy.ts",
  "stage-a-process.ts",
  "stage-a-candidate-identity.ts",
] as const;
const verifierSourceIdentities: FileIdentity[] = [];
for (const name of verifierSourceNames) {
  const source = join(workspace, "scripts", name);
  if (!existsSync(source)) throw new Error(`scripts/${name} is required`);
  const destination = join(verifierRoot, name);
  writeFileSync(destination, readAnchoredRegular(outputDescriptor, relativeEvidencePath(source), 16 * 1024 * 1024));
  chmodSync(destination, 0o644);
  verifierSourceIdentities.push(fileIdentity(destination));
}
const verifierBundlePath = join(verifierRoot, "verify-stage-a-evidence.js");
await runHost([
  executableSources.bun,
  "build",
  verifierSource,
  "--outfile",
  verifierBundlePath,
  "--target",
  "bun",
], workspace);
chmodSync(verifierBundlePath, 0o644);
const verifierIdentity = fileIdentity(verifierBundlePath);

// All repository-controlled source and verifier copies are now complete. This
// is the only candidate digest that may be blessed by the manifest.
const finalCandidateDigest = await candidateDigest();
if (finalCandidateDigest !== sourceDigestBefore) throw new Error("source candidate digest changed before final freeze");
const evidenceRootInventoryWithoutManifest = inventoryTree(evidenceRoot);
if (evidenceRootInventoryWithoutManifest.some((entry) => entry.type === "symlink")) {
  throw new Error("evidence root contains a symlink before manifest creation");
}
assertNoHardlinks(outputDescriptor, evidenceRootInventoryWithoutManifest, "evidence root");

const manifest = {
  schema_version: SCHEMA_VERSION,
  base_ref: BASE_REF,
  base_tree: baseTree,
  canonical_source_candidate_digest: finalCandidateDigest,
  source_digest_after: finalCandidateDigest,
  install_free: true,
  evidence_root: {
    manifest_path: "manifest.json",
    manifest_excluded_from_inventory: true,
    inventory_without_manifest: evidenceRootInventoryWithoutManifest,
    entry_count_without_manifest: evidenceRootInventoryWithoutManifest.length,
    regular_file_count_without_manifest: evidenceRootInventoryWithoutManifest.filter((entry) => entry.type === "file").length,
    symlink_count: 0,
    special_entry_count: 0,
    hardlink_count: 0,
  },
  network_isolation: {
    mechanism: "minimal-rootfs bwrap --unshare-user --unshare-pid --unshare-net with new proc",
    namespace_isolated: true,
    namespace_identifiers_recorded: false,
    namespace_output_normalization: "net:[NAMESPACE]",
    interfaces: ["lo"],
    interface_policy: "LOOPBACK_ONLY",
    routes: [],
    inherited_socket_descriptors: 0,
    inherited_mount_descriptors: 0,
    route_probe_result: routeProbeResult,
    sandbox_tool: bwrapIdentity,
    sandbox_execution_role: "trusted-host-bwrap",
    sandbox_execution_policy: "canonical AppArmor-authorized path with bundled byte, loader, and shared-library equality before and after every run",
    sandbox_launch_shell: hostBashIdentity,
    sandbox_launch_role: "trusted-host-bash",
    probe: networkProbe,
  },
  tools: {
    inventory: toolInventoryFile,
    inventory_sha256: toolchainInventorySha256,
    bundled: toolInventory,
    host: hostTools,
    actual_bun: bunIdentity,
    actual_bun_version: (await runHost([executableSources.bun, "--version"])).stdout.toString().trim(),
    runtime_closure: sandboxCommandTools,
    minimal_rootfs: relativeEvidencePath(sandboxRootfs),
  },
  dependencies: {
    archive: dependencyArchiveIdentity,
    inventory: dependencyInventoryIdentity,
    inventory_after: dependencyAfterFile,
    inventory_count: repositoryDependencyInventory.length,
    inventories_equal: true,
    existing_dependency_bytes: {
      version: "existing-dependency-bytes-v1",
      descriptor_anchored: true,
      source_path_recorded: false,
      read_only_source: true,
      source_inventory: dependencySourceInventoryIdentity,
      source_inventory_count: dependencySourceInventoryBefore.length,
      source_scratch_exclusions: DEPENDENCY_SOURCE_SCRATCH_EXCLUSIONS,
      source_unchanged: true,
      lockfile_unchanged: true,
    },
    special_member_count: 0,
    symlink_member_count: repositoryDependencyInventory.filter((entry) => entry.type === "symlink").length,
    hardlink_member_count: 0,
    extraction_root: ".",
    explicit_parent_entries: repositoryDependencyInventory.some((entry) => entry.path === "dashboard") ? ["dashboard"] : [],
    extraction_inventory_equal: true,
    lockfile: fileIdentity(join(workspace, "bun.lock")),
    typescript_script: declarationToolIdentity,
  },
  provenance: {
    base_commit: baseCommitIdentity,
    base_commit_object_sha1: commitObjectHash,
    base_tree_archive: baseArchiveIdentity,
    binary_diff: binaryDiffIdentity,
    sorted_untracked_paths: sortedUntrackedPathsIdentity,
    untracked_records: untrackedRecordsIdentity,
    untracked_inventory: untrackedInventoryFile,
    canonical_digest_input: canonicalInputIdentity,
    copied_source_before: sourceInventoryBeforeFile,
    copied_source_after: sourceInventoryAfterFile,
    reconstructed_source: reconstructedInventoryFile,
    inventories_equal: true,
    credential_scan: provenanceScanFile,
  },
  generated_sdk: { before: generatedSdkBefore, after: generatedSdkAfter, equal: true },
  declaration: {
    command_index: 2,
    tool: declarationToolIdentity,
    package: declarationPackageIdentity,
    dependency_inventory_sha256: dependencyInventoryIdentity.sha256,
  },
  containment_smokes: containmentSmokes,
  required_replay_indices: Array.from({ length: containmentSmokes.length }, (_value, index) => index),
  artifact: {
    archive: artifactArchiveIdentity,
    inventory: artifactInventory,
    bin_inventory: binInventory,
    extraction_inventory_equal: true,
    extraction_has_source: false,
    extraction_has_node_modules: false,
    datastore_files: artifactDatastoreFiles,
    smokes: artifactSmokes,
    special_member_count: 0,
    hardlink_member_count: 0,
  },
  runtime_home: {
    recursive_regular_file_count: runtimeHomeRegularFiles.length,
    regular_files: runtimeHomeRegularFiles,
    recursive_entry_count: runtimeHomeInventory.length,
    entries: runtimeHomeInventory,
  },
  verifier: verifierIdentity,
  verifier_sources: verifierSourceIdentities,
  runtime_topology_free: true,
};

if (manifest.artifact.datastore_files.length !== 0) throw new Error("artifact contains datastore/runtime files");
const manifestPath = join(evidenceRoot, "manifest.json");
if (await candidateDigest() !== finalCandidateDigest) {
  throw new Error("source candidate changed after final freeze; evidence run is abandoned without a manifest");
}
assertOutputBinding();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
try {
  assertOutputBinding();
  const completedEvidenceRootInventoryWithoutManifest = inventoryTree(evidenceRoot, (path) => path === "manifest.json");
  if (JSON.stringify(completedEvidenceRootInventoryWithoutManifest) !== JSON.stringify(evidenceRootInventoryWithoutManifest)) {
    throw new Error("evidence root changed while the manifest was written");
  }
  if (completedEvidenceRootInventoryWithoutManifest.some((entry) => entry.type === "symlink")) {
    throw new Error("evidence root contains a symlink after manifest creation");
  }
  assertNoHardlinks(outputDescriptor, inventoryTree(evidenceRoot), "completed evidence root");
  if (await candidateDigest() !== finalCandidateDigest) {
    throw new Error("source candidate changed while the manifest was written; evidence run is abandoned without a manifest");
  }
} catch (error) {
  rmSync(manifestPath, { force: true });
  throw error;
}
const manifestIdentity = fileIdentity(manifestPath);
evidenceComplete = true;

process.stdout.write(`${JSON.stringify({
  output,
  manifest_path: join(output, relativeEvidencePath(manifestPath)),
  manifest_sha256: manifestIdentity.sha256,
  archive_path: join(output, relativeEvidencePath(artifactArchivePath)),
  archive_sha256: artifactArchiveIdentity.sha256,
  dependency_archive_sha256: dependencyArchiveIdentity.sha256,
  canonical_source_candidate_digest: finalCandidateDigest,
})}\n`);
