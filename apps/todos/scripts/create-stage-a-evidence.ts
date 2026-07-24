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
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  scanTextForSecrets,
  secretScanByteProjections,
} from "../src/lib/secret-redaction.js";

const BASE_REF = "31988ba7a1ca3d42f50cb2fab894a3581f8e568f";
const SCHEMA_VERSION = 3;
const MAX_INVENTORY_ENTRIES = 200_000;
const MAX_TREE_REGULAR_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TREE_DEPTH = 256;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
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
  source_path?: string;
  version?: string;
}

interface CommandEvidence {
  index: number;
  label: string;
  argv: string[];
  launch_argv: string[];
  cwd: string;
  env: Record<string, string>;
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
if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error("--expected-digest must be a lowercase SHA-256");
if (!isAbsolute(outputArgument)) throw new Error("--output must be absolute");
const output = resolve(outputArgument);
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
  const descriptor = openAnchoredRegular(outputDescriptor, relativePath);
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
  const rootDescriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    visit(rootDescriptor, "", 0);
  } finally {
    closeSync(rootDescriptor);
  }
  return entries.sort((left, right) => byteSort(left.path, right.path));
}

function writeJson(path: string, value: unknown): FileIdentity {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return fileIdentity(path);
}

function runHost(argv: string[], cwd = repository, env: Record<string, string> = {}): ReturnType<typeof Bun.spawnSync> {
  const result = Bun.spawnSync(argv, {
    cwd,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${argv.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().slice(0, 2_000)}`);
  }
  return result;
}

function resolveExecutable(name: string): string {
  if (name === "bun") return realpathSync(process.execPath);
  const result = runHost(["bash", "-lc", `command -v -- ${name}`]);
  const path = result.stdout.toString().trim();
  if (!isAbsolute(path)) throw new Error(`could not resolve executable: ${name}`);
  return realpathSync(path);
}

function assertPreflight(): void {
  const head = runHost(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
  if (head !== BASE_REF) throw new Error(`HEAD mismatch: expected ${BASE_REF}, received ${head}`);
  const staged = Bun.spawnSync(["git", "diff", "--cached", "--quiet", "--exit-code"], {
    cwd: repository,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (staged.exitCode !== 0) throw new Error("staged file count must be zero");
}

function canonicalDigestInput(): Buffer {
  const script = String.raw`base_ref=31988ba7a1ca3d42f50cb2fab894a3581f8e568f
{
  git diff --binary --full-index --no-ext-diff "$base_ref" --
  while IFS= read -r -d '' candidate_path; do
    printf 'untracked\0%s\0' "$candidate_path"
    sha256sum -z -- "$candidate_path"
  done < <(git ls-files --others --exclude-standard -z | LC_ALL=C sort -z)
}`;
  return Buffer.from(runHost(["bash", "-lc", script]).stdout);
}

function candidateDigest(): string {
  const script = String.raw`base_ref=31988ba7a1ca3d42f50cb2fab894a3581f8e568f
candidate_digest() {
  {
    git diff --binary --full-index --no-ext-diff "$base_ref" --
    while IFS= read -r -d '' candidate_path; do
      printf 'untracked\0%s\0' "$candidate_path"
      sha256sum -z -- "$candidate_path"
    done < <(git ls-files --others --exclude-standard -z | LC_ALL=C sort -z)
  } | sha256sum | awk '{print $1}'
}
candidate_digest`;
  const digest = runHost(["bash", "-lc", script]).stdout.toString().trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("canonical candidate digest command failed");
  return digest;
}

assertPreflight();
const sourceDigestBefore = candidateDigest();
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
const workspaceCanonical = realpathSync(workspace);

function trackedAndUntrackedPaths(): string[] {
  const raw = runHost(["git", "ls-files", "-co", "--exclude-standard", "-z"]).stdout;
  return raw.toString().split("\0").filter(Boolean).sort(byteSort);
}

function copyCandidateSource(): void {
  const directories = new Set<string>();
  for (const sourcePath of trackedAndUntrackedPaths()) {
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

copyCandidateSource();
const sourceInventoryExclude = (path: string): boolean => path === "dist" || path.startsWith("dist/")
  || path === "node_modules" || path.startsWith("node_modules/")
  || path === "dashboard/node_modules" || path.startsWith("dashboard/node_modules/");
const sourceInventoryBefore = inventoryTree(workspace, sourceInventoryExclude);
const sourceInventoryBeforeFile = writeJson(join(provenanceRoot, "copied-source-before.json"), sourceInventoryBefore);

const baseCommitBytes = Buffer.from(runHost(["git", "cat-file", "commit", BASE_REF]).stdout);
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
const resolvedBaseTree = runHost(["git", "rev-parse", `${BASE_REF}^{tree}`]).stdout.toString().trim();
if (resolvedBaseTree !== baseTree) throw new Error("base tree identity mismatch");

const baseArchivePath = join(provenanceRoot, "base-tree.tar");
runHost(["git", "archive", "--format=tar", `--output=${baseArchivePath}`, BASE_REF]);
const baseArchiveIdentity = fileIdentity(baseArchivePath);

const binaryDiffPath = join(provenanceRoot, "candidate.diff");
const binaryDiffBytes = Buffer.from(runHost(["git", "diff", "--binary", "--full-index", "--no-ext-diff", BASE_REF, "--"]).stdout);
writeFileSync(binaryDiffPath, binaryDiffBytes);
const binaryDiffIdentity = fileIdentity(binaryDiffPath);

const sortedUntrackedPathBytes = Buffer.from(runHost([
  "bash", "-lc", "git ls-files --others --exclude-standard -z | LC_ALL=C sort -z",
]).stdout);
const sortedUntrackedPathsFile = join(provenanceRoot, "untracked-paths.nul");
writeFileSync(sortedUntrackedPathsFile, sortedUntrackedPathBytes);
const sortedUntrackedPathsIdentity = fileIdentity(sortedUntrackedPathsFile);
const untrackedPaths = sortedUntrackedPathBytes.toString().split("\0").filter(Boolean);
const untrackedRoot = join(provenanceRoot, "untracked-files");
mkdirSync(untrackedRoot, { recursive: true });
const untrackedInventory: Array<InventoryEntry & { evidence_path: string }> = [];
for (const path of untrackedPaths) {
  const source = readAnchoredSource(path);
  const destination = join(untrackedRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source.bytes);
  chmodSync(destination, source.mode & 0o777);
  untrackedInventory.push({
    path,
    evidence_path: relativeEvidencePath(destination),
    type: "file",
    mode: modeString(source.mode),
    size: source.size,
    sha256: sha256File(destination),
  });
}
const untrackedInventoryFile = writeJson(join(provenanceRoot, "untracked-inventory.json"), untrackedInventory);

const digestInputBytes = canonicalDigestInput();
if (!digestInputBytes.subarray(0, binaryDiffBytes.length).equals(binaryDiffBytes)) {
  throw new Error("canonical digest stream does not begin with the preserved binary diff");
}
const canonicalInputPath = join(provenanceRoot, "canonical-digest-input.bin");
writeFileSync(canonicalInputPath, digestInputBytes);
const canonicalInputIdentity = fileIdentity(canonicalInputPath);
if (canonicalInputIdentity.sha256 !== expectedDigest) throw new Error("preserved canonical digest input mismatch");
const untrackedRecordsPath = join(provenanceRoot, "untracked-records.bin");
writeFileSync(untrackedRecordsPath, digestInputBytes.subarray(binaryDiffBytes.length));
const untrackedRecordsIdentity = fileIdentity(untrackedRecordsPath);

function sourceInventoryJson(root: string): InventoryEntry[] {
  return inventoryTree(root);
}

const reconstructionRoot = join(evidenceRoot, ".candidate-reconstruction");
mkdirSync(reconstructionRoot);
runHost(["tar", "-xf", baseArchivePath, "-C", reconstructionRoot], evidenceRoot);
if (binaryDiffBytes.length > 0) runHost(["git", "apply", "--binary", "--whitespace=nowarn", binaryDiffPath], reconstructionRoot);
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

function dependencyInventory(root: string): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
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
    for (const entry of inventoryTree(absolute)) entries.push({ ...entry, path: `${prefix}/${entry.path}` });
  }
  return entries.sort((left, right) => byteSort(left.path, right.path));
}

let repositoryDependencyInventory!: InventoryEntry[];
let dependencyInventoryIdentity!: FileIdentity;
let dependencyArchiveIdentity!: FileIdentity;
let dependencyInstallEvidence!: CommandEvidence;
const dependencyArchiveTar = join(dependenciesRoot, "node-modules.tar");
const dependencyArchivePath = `${dependencyArchiveTar}.gz`;

function lddFiles(executable: string): string[] {
  const outputText = runHost(["ldd", executable]).stdout.toString();
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
  for (const path of lddFiles(executable)) runtimeFiles.add(path);
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
const hostTools: ToolIdentity[] = hostToolNames.map((name) => {
  const sourcePath = resolveExecutable(name);
  const destination = join(hostToolsRoot, name);
  copyFileSync(sourcePath, destination);
  chmodSync(destination, lstatSync(sourcePath).mode & 0o777);
  const stat = statSync(destination);
  const versionResult = Bun.spawnSync([sourcePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  return {
    role: `host-${name}`,
    path: relativeEvidencePath(destination),
    source_path: sourcePath,
    mode: modeString(stat.mode),
    size: stat.size,
    sha256: sha256File(destination),
    version: `${versionResult.stdout.toString()}${versionResult.stderr.toString()}`.split("\n")[0]?.trim(),
  };
});
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

function assertExternalFileMatchesIdentity(source: string, identity: FileIdentity, label: string): void {
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
  } finally {
    closeSync(descriptor);
  }
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

const baseEnvironment: Record<string, string> = {
  PATH: "/opt/bin:/bin",
  HOME: "/srv",
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C",
  CI: "1",
  NO_COLOR: "1",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  BUN_TMPDIR: "/tmp",
  BUN_INSTALL: "/tmp/bun-install",
  BUN_INSTALL_CACHE_DIR: "/tmp/bun-install-cache",
  XDG_CACHE_HOME: "/tmp/xdg-cache",
  HASNA_TODOS_STORAGE_MODE: "remote",
  TODOS_STORAGE_MODE: "remote",
  TODOS_DB_PATH: "/srv/tripwire.db",
  HASNA_TODOS_DB_PATH: "/srv/tripwire.db",
  TODOS_AUTO_PROJECT: "false",
};

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

function closeConsumedDescriptor(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;
  }
}

function sandboxLaunchArgv(
  workspaceSource: string,
  rootfsSource: string,
  runtimeHomeSource: string,
  environment: Record<string, string>,
  argv: string[],
  hostBwrap: string,
  readOnlyMounts: Array<[string, string]> = [],
): string[] {
  const mountSources = [workspaceSource, rootfsSource, runtimeHomeSource, ...readOnlyMounts.map(([source]) => source)];
  const childFd = (index: number): number => index + 3;
  const bwrapArgv = [
    hostBwrap,
    "--die-with-parent", "--new-session", "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup-try", "--unshare-net",
    "--ro-bind-fd", String(childFd(1)), "/", "--proc", "/proc", "--dev", "/dev",
    "--bind-fd", String(childFd(0)), "/mnt", "--bind-fd", String(childFd(2)), "/srv",
    "--tmpfs", "/home", "--perms", "1777", "--tmpfs", "/tmp", "--clearenv",
  ];
  for (const [key, value] of Object.entries(environment).sort(([left], [right]) => byteSort(left, right))) {
    bwrapArgv.push("--setenv", key, value);
  }
  readOnlyMounts.forEach(([_source, sandbox], index) => {
    bwrapArgv.push("--ro-bind-fd", String(childFd(3 + index)), sandbox);
  });
  bwrapArgv.push("--chdir", "/mnt", "--", ...argv);
  const launcher = [
    "set -euo pipefail",
    "ulimit -f 65536",
    ...mountSources.map((_source, index) => `exec ${childFd(index)}<\"\${${index + 1}}\"`),
    `shift ${mountSources.length}`,
    'exec "$@"',
  ].join("\n");
  return [executableSources.bash, "-c", launcher, "stage-a-bwrap-launch", ...mountSources, ...bwrapArgv];
}

function identityForSandboxPath(hostWorkspace: string, sandboxPath: string): FileIdentity {
  const prefix = "/mnt/";
  if (!sandboxPath.startsWith(prefix)) throw new Error(`unsupported sandbox input path: ${sandboxPath}`);
  return fileIdentity(join(hostWorkspace, sandboxPath.slice(prefix.length)));
}

let commandIndex = 0;
function executeSandbox(
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
): CommandEvidence {
  const hostWorkspace = options.hostWorkspace ?? workspace;
  const identityWorkspace = options.identityWorkspace ?? hostWorkspace;
  const environment = { ...baseEnvironment, ...extraEnvironment };
  const workspaceDescriptor = openSync(hostWorkspace, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const heldDescriptors = [
    workspaceDescriptor,
    openSync(sandboxRootfs, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW),
    openSync(runtimeHome, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW),
  ];
  const parentDescriptorPath = (descriptor: number): string => `/proc/${process.pid}/fd/${descriptor}`;
  const descriptorMounts: Array<[string, string]> = [];
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
  const launchArgv = sandboxLaunchArgv(
    parentDescriptorPath(heldDescriptors[0]!),
    parentDescriptorPath(heldDescriptors[1]!),
    parentDescriptorPath(heldDescriptors[2]!),
    environment,
    argv,
    executableSources.bwrap,
    descriptorMounts,
  );
  const logRoot = join(executionsRoot, `${String(commandIndex).padStart(3, "0")}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
  mkdirSync(logRoot, { recursive: true });
  const stdoutPath = join(logRoot, "stdout.bin");
  const stderrPath = join(logRoot, "stderr.bin");
  const stdoutDescriptor = openSync(stdoutPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  const stderrDescriptor = openSync(stderrPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  let spawned: ReturnType<typeof spawnSync>;
  assertHostSandboxRuntimeBinding();
  try {
    spawned = spawnSync(launchArgv[0]!, launchArgv.slice(1), {
      encoding: null,
      stdio: ["ignore", stdoutDescriptor, stderrDescriptor],
    });
  } finally {
    closeConsumedDescriptor(stdoutDescriptor);
    closeConsumedDescriptor(stderrDescriptor);
    for (const descriptor of heldDescriptors) closeConsumedDescriptor(descriptor);
  }
  assertHostSandboxRuntimeBinding();
  chmodSync(stdoutPath, 0o644);
  chmodSync(stderrPath, 0o644);
  const result = {
    exitCode: spawned.status ?? 1,
    stdout: readAnchoredRegular(outputDescriptor!, relativeEvidencePath(stdoutPath), MAX_COMMAND_OUTPUT_BYTES),
    stderr: readAnchoredRegular(outputDescriptor!, relativeEvidencePath(stderrPath), MAX_COMMAND_OUTPUT_BYTES),
  };
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
    launch_argv: launchArgv,
    cwd: "/mnt",
    env: redactedEnvironment(environment),
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

function materializeDependencyTree(rootPath: string): void {
  for (let pass = 0; pass < 16; pass += 1) {
    const symlinks = inventoryTree(rootPath)
      .filter((entry) => entry.type === "symlink")
      .sort((left, right) => right.path.split("/").length - left.path.split("/").length || byteSort(left.path, right.path));
    if (symlinks.length === 0) break;
    for (const entry of symlinks) {
      const link = join(rootPath, entry.path);
      const target = realpathSync(link);
      const targetFromWorkspace = relative(workspaceCanonical, target);
      if (targetFromWorkspace === "" || targetFromWorkspace.startsWith(`..${sep}`) || isAbsolute(targetFromWorkspace)) {
        throw new Error(`dependency symlink escapes the clean closure: ${entry.path}`);
      }
      const replacement = `${link}.stage-a-materialized`;
      const targetStat = statSync(target);
      if (targetStat.isDirectory()) {
        cpSync(target, replacement, { recursive: true, dereference: true, preserveTimestamps: true, errorOnExist: true });
      } else if (targetStat.isFile()) {
        copyFileSync(target, replacement);
        chmodSync(replacement, targetStat.mode & 0o777);
      } else {
        throw new Error(`dependency symlink resolves to a special file: ${entry.path}`);
      }
      rmSync(link, { force: false });
      renameSync(replacement, link);
    }
    if (pass === 15 && inventoryTree(rootPath).some((entry) => entry.type === "symlink")) {
      throw new Error("dependency symlink materialization did not reach a fixed point");
    }
  }

  for (const path of regularFiles(rootPath)) {
    const stat = lstatSync(path);
    if (stat.nlink <= 1) continue;
    const replacement = `${path}.stage-a-unlinked`;
    copyFileSync(path, replacement);
    chmodSync(replacement, stat.mode & 0o777);
    renameSync(replacement, path);
  }
  for (const entry of inventoryTree(rootPath)) {
    if (entry.type !== "file" && entry.type !== "directory") {
      throw new Error(`dependency closure contains a special entry: ${entry.path}`);
    }
  }
  for (const path of regularFiles(rootPath)) {
    if (lstatSync(path).nlink !== 1) throw new Error(`dependency closure retains a hardlink: ${path}`);
  }
}

const lockfileBeforeInstall = fileIdentity(join(workspace, "bun.lock"));
const bunCache = resolve(dirname(executableSources.bun), "..", "install", "cache");
if (!lstatSync(bunCache).isDirectory()) throw new Error(`Bun cache is unavailable for offline closure: ${bunCache}`);
dependencyInstallEvidence = executeSandbox(
  "offline frozen dependency closure",
  [
    "/opt/bin/bun", "install", "--frozen-lockfile", "--ignore-scripts",
    "--backend=copyfile", "--linker=hoisted", "--cache-dir=/cache", "--no-progress",
  ],
  0,
  {
    BUN_INSTALL_CACHE_DIR: "/cache",
  },
  {
    inputPaths: ["/mnt/package.json", "/mnt/bun.lock", "/mnt/dashboard/package.json"],
    readOnlyMounts: [[bunCache, "/cache"]],
    outputComparisonRules: ["duration-tokens"],
    replayable: false,
    replayOmission: "offline cache is intentionally excluded; lock bytes, closure inventory, deterministic archive, and extraction are independently verified",
  },
);
const lockfileAfterInstall = fileIdentity(join(workspace, "bun.lock"));
if (lockfileBeforeInstall.sha256 !== lockfileAfterInstall.sha256 || lockfileBeforeInstall.size !== lockfileAfterInstall.size) {
  throw new Error("offline dependency closure changed bun.lock");
}

for (const dependencyRoot of [join(workspace, "node_modules"), join(workspace, "dashboard", "node_modules")]) {
  if (existsSync(dependencyRoot)) materializeDependencyTree(dependencyRoot);
}
repositoryDependencyInventory = dependencyInventory(workspace);
if (repositoryDependencyInventory.some((entry) => entry.type !== "file" && entry.type !== "directory")) {
  throw new Error("clean dependency inventory contains a special entry");
}
dependencyInventoryIdentity = writeJson(join(dependenciesRoot, "inventory.json"), repositoryDependencyInventory);
const dependencyArchiveInputs = ["node_modules"];
if (existsSync(join(workspace, "dashboard", "node_modules"))) dependencyArchiveInputs.push("dashboard/node_modules");
runHost([
  "tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
  "--hard-dereference", "--format=ustar", "-cf", dependencyArchiveTar,
  "-C", workspace, ...dependencyArchiveInputs,
], evidenceRoot);
runHost(["gzip", "-n", dependencyArchiveTar], evidenceRoot);
if (!existsSync(dependencyArchivePath)) throw new Error("dependency archive compression did not produce the expected path");
const dependencyMemberListing = runHost(["tar", "-tvzf", dependencyArchivePath], evidenceRoot).stdout.toString();
for (const line of dependencyMemberListing.split("\n").filter(Boolean)) {
  if (line[0] !== "-" && line[0] !== "d") throw new Error(`dependency archive contains a special member: ${line.slice(0, 80)}`);
}
dependencyArchiveIdentity = fileIdentity(dependencyArchivePath);
const dependencyExtractionRoot = join(evidenceRoot, ".dependency-extraction-smoke");
mkdirSync(dependencyExtractionRoot);
runHost(["tar", "--same-permissions", "-xzf", dependencyArchivePath, "-C", dependencyExtractionRoot], evidenceRoot);
const extractedDependencyInventory = dependencyInventory(dependencyExtractionRoot);
if (JSON.stringify(extractedDependencyInventory) !== JSON.stringify(repositoryDependencyInventory)) {
  throw new Error("clean dependency archive does not match the lock-bound inventory");
}
rmSync(dependencyExtractionRoot, { recursive: true, force: false });

const networkProbe = executeSandbox(
  "network namespace denial probe",
  ["/opt/bin/bun", "-e", [
    'import { fstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";',
    'const namespace=readlinkSync("/proc/self/ns/net");',
    'const interfaces=readFileSync("/proc/net/dev","utf8").split("\\n").slice(2).map((line)=>line.split(":")[0]?.trim()).filter(Boolean);',
    'const routes=readFileSync("/proc/net/route","utf8").trim().split("\\n").slice(1).filter(Boolean);',
    'let socketFds=0; let directoryFds=0; for(const fd of readdirSync("/proc/self/fd")){ try { if(readlinkSync(`/proc/self/fd/${fd}`).startsWith("socket:[")) socketFds+=1; if(fstatSync(Number(fd)).isDirectory()) directoryFds+=1; } catch {} }',
    'let routeError=""; try { const socket=await Bun.connect({hostname:"192.0.2.1",port:9,socket:{data(){}}}); socket.end(); } catch(error) { routeError=(error instanceof Error?error.message:String(error)).replace(/[\\r\\n]+/g," "); }',
    'console.log(`namespace=${namespace}`); console.log(`interfaces=${interfaces.join(",")}`); console.log(`routes=${routes.length}`); console.log(`socket_fds=${socketFds}`); console.log(`directory_fds=${directoryFds}`); console.log(`route_error=${routeError}`);',
    'process.exit(routeError.length>0?1:2);',
  ].join("")],
  1,
  {},
  { outputComparisonRules: ["namespace-inode"] },
);
const networkProbeOutput = `${readAnchoredRegular(outputDescriptor!, networkProbe.stdout.path).toString("utf8")}\n${readAnchoredRegular(outputDescriptor!, networkProbe.stderr.path).toString("utf8")}`;
const parentNetworkNamespace = readlinkSync("/proc/self/ns/net");
const childNetworkNamespace = networkProbeOutput.match(/namespace=(net:\[[0-9]+\])/)?.[1];
if (!childNetworkNamespace || childNetworkNamespace === parentNetworkNamespace) throw new Error("network probe did not prove a distinct network namespace");
const childInterfaces = networkProbeOutput.match(/^interfaces=(.*)$/m)?.[1];
const childRouteCount = networkProbeOutput.match(/^routes=(\d+)$/m)?.[1];
if (childInterfaces !== "lo" || childRouteCount !== "0" || !networkProbeOutput.includes("socket_fds=0") || !networkProbeOutput.includes("directory_fds=0")) {
  throw new Error("network probe did not prove the isolated interface and descriptor floor");
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
containmentSmokes.push(executeSandbox(
  "generated SDK stability",
  ["/opt/bin/bun", "run", "generate:sdk"],
  0,
  {},
  { inputPaths: ["/mnt/scripts/generate-sdk.ts", "/mnt/src/server/openapi.ts"] },
));
const generatedSdkAfter = fileIdentity(generatedSdkPath);
if (generatedSdkBefore.sha256 !== generatedSdkAfter.sha256 || generatedSdkBefore.size !== generatedSdkAfter.size) {
  throw new Error("generated SDK output is not stable");
}

containmentSmokes.push(executeSandbox(
  "install-free build",
  ["/opt/bin/bun", "run", "build:server"],
  0,
  {},
  { inputPaths: ["/mnt/package.json", "/mnt/bun.lock"], outputComparisonRules: ["duration-tokens"] },
));
const tscScriptSandboxPath = `/mnt/${relative(workspaceCanonical, realpathSync(join(workspace, "node_modules", "typescript", "bin", "tsc"))).split(sep).join("/")}`;
const tscPackageSandboxPath = `/mnt/${relative(workspaceCanonical, realpathSync(join(workspace, "node_modules", "typescript", "package.json"))).split(sep).join("/")}`;
containmentSmokes.push(executeSandbox(
  "declaration build",
  ["/opt/bin/bun", tscScriptSandboxPath, "--emitDeclarationOnly", "--outDir", "dist"],
  0,
  {},
  {
    inputPaths: [tscScriptSandboxPath, tscPackageSandboxPath, "/mnt/tsconfig.json"],
    outputComparisonRules: ["duration-tokens"],
  },
));

const importPreload = "/mnt/src/test/stage-a-import-tripwire-preload.ts";
const entrypointPreload = "/mnt/src/test/stage-a-entrypoint-preload.ts";
const importExpression = [
  'process.argv[1]="stage-a-provenance-import";',
  "const first=await import(process.env.STAGE_A_TARGET);",
  "const second=await import(process.env.STAGE_A_TARGET);",
  'if(first!==second) throw new Error("warm import identity mismatch");',
  'console.log("STAGE_A_PROVENANCE_IMPORT_OK");',
].join("");
const sourceAndBuiltImports = [
  ["source root cold/warm import", "src/index.ts"],
  ["source contracts cold/warm import", "src/contracts.ts"],
  ["source MCP public cold/warm import", "src/mcp.ts"],
  ["source MCP constructor cold/warm import", "src/mcp/index.ts"],
  ["source MCP HTTP cold/warm import", "src/mcp/http.ts"],
  ["source registry cold/warm import", "src/registry.ts"],
  ["source SDK cold/warm import", "src/sdk/index.ts"],
  ["source storage cold/warm import", "src/storage.ts"],
  ["source direct storage cold/warm import", "src/storage/index.ts"],
  ["built root cold/warm import", "dist/index.js"],
  ["built contracts cold/warm import", "dist/contracts.js"],
  ["built MCP public cold/warm import", "dist/mcp.js"],
  ["built MCP constructor cold/warm import", "dist/mcp/index.js"],
  ["built MCP HTTP cold/warm import", "dist/mcp/http.js"],
  ["built registry cold/warm import", "dist/registry.js"],
  ["built SDK cold/warm import", "dist/sdk/index.js"],
  ["built storage cold/warm import", "dist/storage.js"],
  ["built direct storage cold/warm import", "dist/storage/index.js"],
] as const;
for (const [label, target] of sourceAndBuiltImports) {
  const sandboxTarget = `/mnt/${target}`;
  containmentSmokes.push(executeSandbox(
    label,
    ["/opt/bin/bun", "--preload", importPreload, "-e", importExpression],
    0,
    { STAGE_A_TARGET: pathToFileURL(sandboxTarget).href, STAGE_A_TRIPWIRE_IMPORTS: "1" },
    { inputPaths: [importPreload, sandboxTarget] },
  ));
}

const sourceAndBuiltEntries = [
  ["source CLI metadata", "src/cli/index.tsx", ["--help"], 0, 0],
  ["source CLI containment", "src/cli/index.tsx", ["--json", "list"], 1, 1],
  ["source MCP containment", "src/mcp/index.ts", [], 1, 1],
  ["source server containment", "src/server/index.ts", [], 1, 1],
  ["built CLI metadata", "dist/cli/index.js", ["--help"], 0, 0],
  ["built CLI containment", "dist/cli/index.js", ["--json", "list"], 1, 1],
  ["built MCP containment", "dist/mcp/index.js", [], 1, 1],
  ["built server containment", "dist/server/index.js", [], 1, 1],
] as const;
for (const [label, entry, args, expectedExit, authorityFloor] of sourceAndBuiltEntries) {
  const sandboxEntry = `/mnt/${entry}`;
  containmentSmokes.push(executeSandbox(
    label,
    ["/opt/bin/bun", "--preload", entrypointPreload, sandboxEntry, ...args],
    expectedExit,
    { STAGE_A_TRIPWIRE_IMPORTS: "1" },
    { expectedAuthorityFloor: authorityFloor, inputPaths: [entrypointPreload, sandboxEntry] },
  ));
}
if (containmentSmokes.length !== 29) throw new Error(`unexpected containment smoke count: ${containmentSmokes.length}`);

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
runHost([
  "tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
  "--hard-dereference", "--format=ustar",
  "-cf", artifactArchiveTar, "-C", artifactRoot, ...readdirSync(artifactRoot).sort(byteSort),
], evidenceRoot);
runHost(["gzip", "-n", artifactArchiveTar], evidenceRoot);
const artifactMemberListing = runHost(["tar", "-tvzf", artifactArchivePath], evidenceRoot).stdout.toString();
for (const line of artifactMemberListing.split("\n").filter(Boolean)) {
  if (line[0] !== "-" && line[0] !== "d") throw new Error(`artifact archive contains a special member: ${line.slice(0, 80)}`);
}
const artifactArchiveIdentity = fileIdentity(artifactArchivePath);

const extractedArtifactRoot = join(evidenceRoot, ".artifact-extraction-smoke");
mkdirSync(extractedArtifactRoot);
runHost(["tar", "-xzf", artifactArchivePath, "-C", extractedArtifactRoot], evidenceRoot);
if (existsSync(join(extractedArtifactRoot, "node_modules")) || existsSync(join(extractedArtifactRoot, "src"))) {
  throw new Error("artifact extraction is not isolated from source and node_modules");
}
const extractedArtifactInventory = inventoryTree(extractedArtifactRoot);
if (JSON.stringify(extractedArtifactInventory) !== JSON.stringify(artifactInventory)) {
  throw new Error("artifact extraction inventory does not match the source artifact inventory");
}

const artifactSmokes: CommandEvidence[] = [];
for (const [label, target] of sourceAndBuiltImports.slice(9)) {
  const artifactTarget = target.replace(/^dist\//, "dist/");
  const sandboxTarget = `/mnt/${artifactTarget}`;
  artifactSmokes.push(executeSandbox(
    `extracted artifact ${label}`,
    ["/opt/bin/bun", "--preload", "/mnt/verification/import-preload.ts", "-e", importExpression],
    0,
    { STAGE_A_TARGET: pathToFileURL(sandboxTarget).href, STAGE_A_TRIPWIRE_IMPORTS: "1" },
    { hostWorkspace: extractedArtifactRoot, identityWorkspace: artifactRoot, inputPaths: ["/mnt/verification/import-preload.ts", sandboxTarget] },
  ));
}
for (const [label, entry, args, expectedExit, authorityFloor] of sourceAndBuiltEntries.slice(4)) {
  const sandboxEntry = `/mnt/${entry}`;
  artifactSmokes.push(executeSandbox(
    `extracted artifact ${label}`,
    ["/opt/bin/bun", "--preload", "/mnt/verification/entrypoint-preload.ts", sandboxEntry, ...args],
    expectedExit,
    { STAGE_A_TRIPWIRE_IMPORTS: "1" },
    {
      hostWorkspace: extractedArtifactRoot,
      identityWorkspace: artifactRoot,
      expectedAuthorityFloor: authorityFloor,
      inputPaths: ["/mnt/verification/entrypoint-preload.ts", sandboxEntry],
    },
  ));
}
if (artifactSmokes.length !== 13) throw new Error(`unexpected extracted artifact smoke count: ${artifactSmokes.length}`);
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
    "provenance/canonical-digest-input.bin",
    "provenance/untracked-records.bin",
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

const gitleaksReportPath = join(evidenceRoot, ".gitleaks-unredacted-report.json");
const gitleaksToolDescriptor = openAnchoredRegular(outputDescriptor!, hostGitleaksIdentity.path);
const gitleaksProvenanceDescriptor = openAnchoredDirectory(outputDescriptor!, "provenance");
const gitleaksDescriptorPath = (descriptor: number): string => `/proc/${process.pid}/fd/${descriptor}`;
const gitleaksProvenancePath = gitleaksDescriptorPath(gitleaksProvenanceDescriptor);
const gitleaksProvenanceRealPath = realpathSync(gitleaksProvenancePath);
const gitleaksArgv = [
  gitleaksDescriptorPath(gitleaksToolDescriptor), "dir", gitleaksProvenancePath,
  "--no-banner", "--no-color", "--log-level", "error",
  "--max-archive-depth", "2", "--max-decode-depth", "32", "--max-target-megabytes", "1024",
  "--timeout", "120", "--report-format", "json", "--report-path", `${gitleaksDescriptorPath(outputDescriptor!)}/.gitleaks-unredacted-report.json`,
];
let gitleaksResult!: ReturnType<typeof spawnSync>;
try {
  gitleaksResult = spawnSync(gitleaksArgv[0]!, gitleaksArgv.slice(1), {
    cwd: gitleaksDescriptorPath(outputDescriptor!),
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
} finally {
  closeSync(gitleaksToolDescriptor);
  closeSync(gitleaksProvenanceDescriptor);
}
const gitleaksExitCode = gitleaksResult.status ?? 70;
if ((gitleaksExitCode !== 0 && gitleaksExitCode !== 1) || !existsSync(gitleaksReportPath)) {
  throw new Error(`gitleaks provenance scan exited ${gitleaksExitCode}, expected 0 or 1`);
}
const gitleaksReportBytes = readAnchoredRegular(outputDescriptor!, relativeEvidencePath(gitleaksReportPath), 32 * 1024 * 1024);
const gitleaksRawFindings = JSON.parse(gitleaksReportBytes.toString("utf8")) as Array<{
  RuleID?: unknown;
  File?: unknown;
  StartLine?: unknown;
  Secret?: unknown;
}>;
if (!Array.isArray(gitleaksRawFindings) || gitleaksRawFindings.length > 100_000) {
  throw new Error("gitleaks report finding bound exceeded");
}
rmSync(gitleaksReportPath, { force: false });
const gitleaksFindings = gitleaksRawFindings.map((finding) => {
  if (typeof finding.RuleID !== "string" || typeof finding.File !== "string" || !Number.isSafeInteger(finding.StartLine) || typeof finding.Secret !== "string" || finding.Secret.length === 0) {
    throw new Error("gitleaks emitted an invalid finding record");
  }
  const filePrefix = [`${gitleaksProvenancePath}${sep}`, `${gitleaksProvenanceRealPath}${sep}`]
    .find((prefix) => (finding.File as string).startsWith(prefix));
  if (!filePrefix) throw new Error("gitleaks emitted a finding outside provenance");
  const file = finding.File.slice(filePrefix.length).split(sep).join("/");
  const syntheticFixture = /(?:synthetic|fixture|example|redacted|your-api-key-here|test[-_])/i.test(finding.Secret)
    && /(?:\.test\.[^/!]+|(?:^|\/)(?:test|tests|fixtures?|examples?)(?:\/|$)|candidate\.diff|base-tree\.tar!.*\.test\.)/i.test(file);
  if (!syntheticFixture) throw new Error(`gitleaks found an unapproved credential-like value in ${file}`);
  const secretSha256 = sha256Bytes(finding.Secret);
  return {
    rule: finding.RuleID,
    file,
    line: finding.StartLine as number,
    value_digest: secretSha256,
    classification: "synthetic_test_fixture",
  };
}).sort((left, right) => byteSort(`${left.file}\0${left.line}\0${left.rule}`, `${right.file}\0${right.line}\0${right.rule}`));
const auditsRoot = join(evidenceRoot, "audits");
mkdirSync(auditsRoot);
const gitleaksStdoutPath = join(auditsRoot, "gitleaks.stdout.bin");
const gitleaksStderrPath = join(auditsRoot, "gitleaks.stderr.bin");
writeFileSync(gitleaksStdoutPath, Buffer.from(gitleaksResult.stdout ?? []));
writeFileSync(gitleaksStderrPath, Buffer.from(gitleaksResult.stderr ?? []));
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
    argv: gitleaksArgv,
    cwd: "descriptor-anchored evidence root",
    descriptor_anchored: true,
    expected_exit: [0, 1],
    exit_code: gitleaksExitCode,
    stdout: fileIdentity(gitleaksStdoutPath),
    stderr: fileIdentity(gitleaksStderrPath),
    max_archive_depth: 2,
    max_decode_depth: 32,
    findings: gitleaksFindings,
    approval_policy: "synthetic-or-fixture marker plus test-fixture path",
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
writeFileSync(
  join(verifierRoot, "verify-stage-a-evidence.ts"),
  readAnchoredRegular(outputDescriptor, relativeEvidencePath(verifierSource), 16 * 1024 * 1024),
);
chmodSync(join(verifierRoot, "verify-stage-a-evidence.ts"), 0o644);
const verifierIdentity = fileIdentity(join(verifierRoot, "verify-stage-a-evidence.ts"));

// All repository-controlled source and verifier copies are now complete. This
// is the only candidate digest that may be blessed by the manifest.
const finalCandidateDigest = candidateDigest();
if (finalCandidateDigest !== sourceDigestBefore) throw new Error("source candidate digest changed before final freeze");

const manifest = {
  schema_version: SCHEMA_VERSION,
  base_ref: BASE_REF,
  base_tree: baseTree,
  canonical_source_candidate_digest: finalCandidateDigest,
  source_digest_after: finalCandidateDigest,
  install_free: true,
  network_isolation: {
    mechanism: "minimal-rootfs bwrap --unshare-user --unshare-pid --unshare-net with new proc",
    parent_namespace: parentNetworkNamespace,
    child_namespace: childNetworkNamespace,
    interfaces: ["lo"],
    interface_policy: "LOOPBACK_ONLY",
    routes: [],
    inherited_socket_descriptors: 0,
    inherited_mount_descriptors: 0,
    route_probe_result: routeProbeResult,
    sandbox_tool: bwrapIdentity,
    sandbox_source_path: bwrapIdentity.path,
    sandbox_source_sha256: bwrapIdentity.sha256,
    sandbox_execution_path: executableSources.bwrap,
    sandbox_execution_policy: "canonical AppArmor-authorized path with bundled byte, loader, and shared-library equality before and after every run",
    sandbox_launch_shell: hostBashIdentity,
    sandbox_launch_shell_path: executableSources.bash,
    probe: networkProbe,
  },
  tools: {
    inventory: toolInventoryFile,
    inventory_sha256: toolchainInventorySha256,
    bundled: toolInventory,
    host: hostTools,
    actual_bun: bunIdentity,
    actual_bun_version: runHost([executableSources.bun, "--version"]).stdout.toString().trim(),
    runtime_closure: sandboxCommandTools,
    minimal_rootfs: relativeEvidencePath(sandboxRootfs),
  },
  dependencies: {
    archive: dependencyArchiveIdentity,
    inventory: dependencyInventoryIdentity,
    inventory_after: dependencyAfterFile,
    inventory_count: repositoryDependencyInventory.length,
    inventories_equal: true,
    clean_frozen_offline_install: dependencyInstallEvidence,
    special_member_count: 0,
    hardlink_member_count: 0,
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
};

if (manifest.artifact.datastore_files.length !== 0) throw new Error("artifact contains datastore/runtime files");
const manifestPath = join(evidenceRoot, "manifest.json");
if (candidateDigest() !== finalCandidateDigest) {
  throw new Error("source candidate changed after final freeze; evidence run is abandoned without a manifest");
}
assertOutputBinding();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
try {
  assertOutputBinding();
  if (candidateDigest() !== finalCandidateDigest) {
    throw new Error("source candidate changed while the manifest was written; evidence run is abandoned without a manifest");
  }
} catch (error) {
  rmSync(manifestPath, { force: true });
  throw error;
}
const manifestIdentity = fileIdentity(manifestPath);

process.stdout.write(`${JSON.stringify({
  output,
  manifest_path: join(output, relativeEvidencePath(manifestPath)),
  manifest_sha256: manifestIdentity.sha256,
  archive_path: join(output, relativeEvidencePath(artifactArchivePath)),
  archive_sha256: artifactArchiveIdentity.sha256,
  dependency_archive_sha256: dependencyArchiveIdentity.sha256,
  canonical_source_candidate_digest: finalCandidateDigest,
})}\n`);
